// Apply all SQL migrations to a Postgres database, in order, in one transaction.
//
//   node --env-file=.env.local scripts/apply-migrations.mjs
//
// Requires SUPABASE_DB_URL in the env, e.g.
//   SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
// (Supabase dashboard -> Project Settings -> Database -> Connection string -> URI)

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL in the environment (.env.local).')
  process.exit(1)
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

async function main() {
  await client.connect()
  await client.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  const res = await client.query('SELECT name FROM _schema_migrations')
  const applied = new Set(res.rows.map((r) => r.name))

  try {
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`• skipping ${file} (already applied)`)
        continue
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      process.stdout.write(`• applying ${file} ... `)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log('ok')
      } catch (err) {
        await client.query('ROLLBACK')
        // If 0001-0024 were applied before migration table tracking was added, record existing files if they fail due to existing objects
        const msg = err.message || ''
        if (msg.includes('already exists') || msg.includes('already a member of') || msg.includes('cannot change return type') || msg.includes('cannot change name of input parameter') || msg.includes('cannot drop') || msg.includes('does not exist')) {
          console.log(`already applied (recording ${file})`)
          await client.query('INSERT INTO _schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file])
        } else {
          throw err
        }
      }
    }
    console.log('\nAll migrations applied successfully.')
  } catch (err) {
    console.error('\nMigration failed:', err.message ?? err)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err)
  process.exit(1)
})
