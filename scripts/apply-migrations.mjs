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
  await client.query('begin')
  try {
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      process.stdout.write(`• applying ${file} ... `)
      await client.query(sql)
      console.log('ok')
    }
    await client.query('commit')
    console.log('\nAll migrations applied successfully.')
  } catch (err) {
    await client.query('rollback')
    console.error('\nMigration failed (rolled back):', err.message ?? err)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err)
  process.exit(1)
})
