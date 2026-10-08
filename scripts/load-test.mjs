import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { createClient } from '@supabase/supabase-js'

import {
  LIVE_SITE_URL,
  LOAD_TEST_ACKNOWLEDGEMENT,
  validateLoadTestTarget,
} from '../load-tests/helpers.mjs'
import {
  assertNoExistingRunState,
  buildK6Environment,
  cleanupDemoRun,
  createChildSignalForwarders,
  runWithCleanup,
  seedDemoRun,
  validateRunnerEnvironment,
} from './load-test-runner.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const statePath = path.join(projectRoot, 'load-tests', '.state.json')
const resultsDirectory = path.join(projectRoot, 'load-tests', 'results')
const k6Script = path.join(projectRoot, 'load-tests', 'applicant-booking.js')
const mode = process.argv[2] || 'all'

const targetUrl = process.env.LOAD_TEST_TARGET || LIVE_SITE_URL
const acknowledgement = process.env.LOAD_TEST_ACKNOWLEDGEMENT

validateLoadTestTarget(targetUrl, acknowledgement)
validateRunnerEnvironment(process.env)

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

function requireSuccessful(result, operation) {
  if (result.error) {
    throw new Error(`${operation}: ${result.error.message}`)
  }
  return result.data
}

const database = {
  async insertSlots(rows) {
    const result = await admin.from('slots').insert(rows).select('id')
    return requireSuccessful(result, 'Could not seed load-test slots') || []
  },
  async deleteHolds(slotIds) {
    const result = await admin.from('slot_holds').delete().in('slot_id', slotIds)
    requireSuccessful(result, 'Could not delete load-test slot holds')
  },
  async deleteBookings(slotIds) {
    const result = await admin.from('bookings').delete().in('slot_id', slotIds)
    requireSuccessful(result, 'Could not delete load-test bookings')
  },
  async deleteSlots(slotIds) {
    const result = await admin.from('slots').delete().in('id', slotIds)
    requireSuccessful(result, 'Could not delete load-test slots')
  },
}

function ensureK6Installed() {
  const result = spawnSync('k6', ['version'], { stdio: 'ignore' })
  if (result.error?.code === 'ENOENT') {
    throw new Error(
      'k6 is not installed. Install it from https://grafana.com/docs/k6/latest/set-up/install-k6/',
    )
  }
  if (result.status !== 0) {
    throw new Error('k6 is installed but `k6 version` failed')
  }
}

async function saveState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    flag: 'wx',
  })
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('No seeded load-test state exists. Run `npm run loadtest:seed` first.')
    }
    throw error
  }
}

async function removeState() {
  await rm(statePath, { force: true })
}

async function ensureNoExistingStateFile() {
  try {
    await readFile(statePath, 'utf8')
    assertNoExistingRunState(true)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assertNoExistingRunState(false)
      return
    }
    throw error
  }
}

async function seed() {
  await ensureNoExistingStateFile()
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const state = await seedDemoRun({ database, runId })
  try {
    await saveState(state)
  } catch (error) {
    await cleanupDemoRun({ database, state })
    throw error
  }
  console.log(`Seeded ${state.slotIds.length} isolated demo slots for run ${runId}.`)
  return state
}

async function cleanup(state) {
  await cleanupDemoRun({ database, state })
  await removeState()
  console.log(`Removed demo slots, holds, and bookings for run ${state.runId}.`)
}

async function executeK6(state) {
  ensureK6Installed()
  await mkdir(resultsDirectory, { recursive: true })
  const summaryPath = path.join(resultsDirectory, `${state.runId}.json`)
  const childEnvironment = buildK6Environment(process.env, state)

  await new Promise((resolve, reject) => {
    const child = spawn(
      'k6',
      [
        'run',
        '--summary-mode=full',
        '--summary-export',
        summaryPath,
        k6Script,
      ],
      {
        cwd: projectRoot,
        env: childEnvironment,
        stdio: 'inherit',
      },
    )

    const { onSigint, onSigterm } = createChildSignalForwarders(child)
    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', onSigint)
      process.removeListener('SIGTERM', onSigterm)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`k6 failed (${signal || `exit ${code}`})`))
      }
    })
  })

  console.log(`Saved the aggregated k6 result to ${summaryPath}.`)
}

async function main() {
  if (!['all', 'seed', 'run', 'cleanup'].includes(mode)) {
    throw new Error('Usage: load-test.mjs [all|seed|run|cleanup]')
  }

  if (mode === 'seed') {
    await seed()
    return
  }

  if (mode === 'run') {
    await executeK6(await loadState())
    return
  }

  if (mode === 'cleanup') {
    await cleanup(await loadState())
    return
  }

  ensureK6Installed()
  await runWithCleanup({
    seed,
    execute: executeK6,
    cleanup,
  })
}

main().catch((error) => {
  console.error(`Load test failed: ${error.message}`)
  if (acknowledgement !== LOAD_TEST_ACKNOWLEDGEMENT) {
    console.error(
      `Set LOAD_TEST_ACKNOWLEDGEMENT=${LOAD_TEST_ACKNOWLEDGEMENT} to authorize the guarded production test.`,
    )
  }
  process.exitCode = 1
})
