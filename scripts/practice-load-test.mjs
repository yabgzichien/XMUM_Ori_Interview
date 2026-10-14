// Seeds isolated roster members and practice groups, runs the k6 practice
// booking test, and removes every seeded row (plus its holds and bookings)
// afterwards — even when k6 fails. Audit-log entries stay: that table is append-only.
//
//   LOAD_TEST_ACKNOWLEDGEMENT=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION \
//   PRACTICE_TARGET_URL=https://<deployment>.vercel.app \
//     node --env-file=.env.local scripts/practice-load-test.mjs [all|seed|run|cleanup]
//
// Seeded rows are tagged: student IDs start with LT26, names and groups start
// with "LOADTEST". State (row IDs only, no secrets) lives in
// load-tests/.practice-state.json so `cleanup` can recover an interrupted run.

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

import { LOAD_TEST_ACKNOWLEDGEMENT } from '../load-tests/helpers.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const statePath = path.join(projectRoot, 'load-tests', '.practice-state.json')
const resultsDirectory = path.join(projectRoot, 'load-tests', 'results')
const k6Script = path.join(projectRoot, 'load-tests', 'practice-booking.js')
const mode = process.argv[2] || 'all'

const USERS = Number(process.env.PRACTICE_USERS || 114)
const GROUPS = Number(process.env.PRACTICE_GROUPS || 12)
const COMMITTEE_SHARE = 49 / 115 // matches the live roster's split
const COMMITTEE_SEATS = Number(process.env.PRACTICE_COMMITTEE_SEATS || 5)
const FACI_GM_SEATS = Number(process.env.PRACTICE_FACI_GM_SEATS || 6)
const COMMITTEE_POSITIONS = ['secretary', 'logistic', 'tech_team', 'designer', 'public_relations', 'event_planner']
const FACI_GM_POSITIONS = ['facilitator', 'game_master']

if (process.env.LOAD_TEST_ACKNOWLEDGEMENT !== LOAD_TEST_ACKNOWLEDGEMENT) {
  throw new Error(`Set LOAD_TEST_ACKNOWLEDGEMENT=${LOAD_TEST_ACKNOWLEDGEMENT}`)
}
if (!process.env.SUPABASE_DB_URL) throw new Error('Missing SUPABASE_DB_URL')

async function withDatabase(work) {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

async function seed() {
  try {
    await readFile(statePath, 'utf8')
    throw new Error('A practice load-test run already exists. Run `cleanup` first.')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const runId = Date.now().toString(36).toUpperCase()
  const startedAt = new Date().toISOString()
  const state = await withDatabase(async (db) => {
    await db.query('BEGIN')
    try {
      const { rows: [admin] } = await db.query(
        "SELECT id FROM profiles WHERE role = 'admin' LIMIT 1",
      )
      if (!admin) throw new Error('No admin profile to own the seeded groups')

      const committeeCount = Math.round(USERS * COMMITTEE_SHARE)
      const users = Array.from({ length: USERS }, (_, index) => {
        const committee = index < committeeCount
        const positions = committee ? COMMITTEE_POSITIONS : FACI_GM_POSITIONS
        return {
          studentId: `LT26${runId}${String(index + 1).padStart(3, '0')}`,
          name: `LOADTEST ${runId} member ${index + 1}`,
          position: positions[index % positions.length],
        }
      })
      // Interleave so VU numbers do not map to one category.
      users.sort(() => Math.random() - 0.5)

      const { rows: roster } = await db.query(
        `INSERT INTO committee_roster (name, student_id, position)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
         RETURNING id`,
        [users.map((u) => u.name), users.map((u) => u.studentId), users.map((u) => u.position)],
      )

      const groupNames = Array.from({ length: GROUPS }, (_, index) => `LOADTEST ${runId} group ${String(index + 1).padStart(2, '0')}`)
      const { rows: groups } = await db.query(
        `INSERT INTO practice_groups (name, capacity, committee_capacity, faci_gm_capacity, created_by, songs)
         SELECT name, $2::int + $3::int, $2::int, $3::int, $4::uuid, 'Load test group' FROM unnest($1::text[]) AS name
         RETURNING id, name`,
        [groupNames, COMMITTEE_SEATS, FACI_GM_SEATS, admin.id],
      )
      groups.sort((a, b) => a.name.localeCompare(b.name))
      await db.query('COMMIT')
      return {
        runId,
        startedAt,
        users,
        rosterIds: roster.map((r) => r.id),
        groupIds: groups.map((g) => g.id),
      }
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    }
  })

  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
  console.log(`Seeded ${state.users.length} roster members and ${state.groupIds.length} groups for run ${state.runId}.`)
  return state
}

async function cleanup(state) {
  await withDatabase(async (db) => {
    await db.query('BEGIN')
    try {
      const { rows: bookings } = await db.query(
        'DELETE FROM practice_group_bookings WHERE roster_member_id = ANY($1::uuid[]) OR group_id = ANY($2::uuid[]) RETURNING id',
        [state.rosterIds, state.groupIds],
      )
      const holds = await db.query(
        'DELETE FROM practice_group_holds WHERE roster_member_id = ANY($1::uuid[]) OR group_id = ANY($2::uuid[])',
        [state.rosterIds, state.groupIds],
      )
      await db.query('DELETE FROM practice_groups WHERE id = ANY($1::uuid[])', [state.groupIds])
      await db.query('DELETE FROM committee_roster WHERE id = ANY($1::uuid[])', [state.rosterIds])
      // audit_log is append-only by design (0029), so the run's entries stay;
      // every one of them names a LOADTEST row.
      // Rate-limit reservations left behind by requests that died mid-flight.
      // Practice booking is not live on production, so no real rows exist here.
      const attempts = await db.query(
        "DELETE FROM practice_verification_failures WHERE attempted_at >= $1::timestamptz - interval '1 minute'",
        [state.startedAt],
      )
      await db.query('COMMIT')
      console.log(
        `Removed ${bookings.length} bookings, ${holds.rowCount} holds, ${state.groupIds.length} groups, `
        + `${state.rosterIds.length} roster members, ${attempts.rowCount} rate-limit rows.`,
      )
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    }
  })
  await rm(statePath, { force: true })
}

async function executeK6(state) {
  const targetUrl = process.env.PRACTICE_TARGET_URL
  if (!targetUrl) throw new Error('Missing PRACTICE_TARGET_URL')
  const k6 = process.env.K6_BIN || 'k6'
  await mkdir(resultsDirectory, { recursive: true })
  const summaryPath = path.join(resultsDirectory, `practice-${state.runId}.json`)

  await new Promise((resolve, reject) => {
    const child = spawn(k6, ['run', '--summary-export', summaryPath, k6Script], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TARGET_URL: targetUrl,
        VERCEL_AUTOMATION_BYPASS_SECRET: process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '',
        PRACTICE_USERS: JSON.stringify(state.users.map((u) => ({ studentId: u.studentId }))),
        PRACTICE_GROUP_IDS: JSON.stringify(state.groupIds),
        START_JITTER_SECONDS: process.env.START_JITTER_SECONDS || '2',
        THINK_SCALE: process.env.THINK_SCALE || '1',
      },
    })
    process.once('SIGINT', () => child.kill('SIGINT'))
    child.once('error', reject)
    // k6 exits 99 when thresholds fail; that is a result, not a crash.
    child.once('exit', (code) => (code === 0 || code === 99 ? resolve(code) : reject(new Error(`k6 exited ${code}`))))
  })

  const report = await withDatabase(async (db) => {
    const { rows } = await db.query(
      `SELECT g.name, g.committee_capacity, g.faci_gm_capacity,
              count(b.id) FILTER (WHERE practice_capacity_category(r.position) = 'committee')::int AS committee_booked,
              count(b.id) FILTER (WHERE practice_capacity_category(r.position) = 'faci_gm')::int AS faci_gm_booked
       FROM practice_groups g
       LEFT JOIN practice_group_bookings b ON b.group_id = g.id
       LEFT JOIN committee_roster r ON r.id = b.roster_member_id
       WHERE g.id = ANY($1::uuid[])
       GROUP BY g.id ORDER BY g.name`,
      [state.groupIds],
    )
    const { rows: [dupes] } = await db.query(
      `SELECT count(*)::int AS n FROM (
         SELECT roster_member_id FROM practice_group_bookings WHERE roster_member_id = ANY($1::uuid[])
         GROUP BY 1 HAVING count(*) > 1) d`,
      [state.rosterIds],
    )
    return { rows, duplicateMembers: dupes.n }
  })
  const oversold = report.rows.filter((g) => g.committee_booked > g.committee_capacity || g.faci_gm_booked > g.faci_gm_capacity)
  const total = report.rows.reduce((sum, g) => sum + g.committee_booked + g.faci_gm_booked, 0)
  console.log('\nDatabase integrity after the run:')
  console.table(report.rows)
  console.log(`Total bookings: ${total}/${state.users.length}. Oversold groups: ${oversold.length}. Members booked twice: ${report.duplicateMembers}.`)
  console.log(`Saved the k6 summary to ${summaryPath}.`)
}

async function main() {
  if (mode === 'seed') return void (await seed())
  if (mode === 'cleanup') return void (await cleanup(JSON.parse(await readFile(statePath, 'utf8'))))
  if (mode === 'run') return void (await executeK6(JSON.parse(await readFile(statePath, 'utf8'))))
  if (mode !== 'all') throw new Error('Usage: practice-load-test.mjs [all|seed|run|cleanup]')

  const state = await seed()
  try {
    await executeK6(state)
  } finally {
    await cleanup(state)
  }
}

main().catch((error) => {
  console.error(`Practice load test failed: ${error.message}`)
  process.exitCode = 1
})
