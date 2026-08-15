// Regenerate supabase/all_migrations.sql from supabase/migrations/*.sql.
//
//   npm run build:migrations
//
// The bundle is what the README tells a new operator to paste into the
// Supabase SQL editor, so it has to be a faithful, in-order concatenation of
// the migration files. Hand-editing it drifted once already (the copy of 0020
// lost its DROP FUNCTION statements, which made a fresh install fail on
// `auth_committee_scope()` — CREATE OR REPLACE cannot change a return type).
// Generating it removes that whole class of problem.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const outFile = join(root, 'supabase', 'all_migrations.sql')

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const header = `-- GENERATED FILE — do not edit by hand.
-- Rebuild with: npm run build:migrations
--
-- Every migration in supabase/migrations, concatenated in order. Paste the
-- whole file into the Supabase SQL editor to build a database from scratch.
-- Applying it to an existing database is safe to re-run only if that database
-- is already at the same revision; use scripts/apply-migrations.mjs for
-- incremental upgrades instead.
`

const body = files
  .map((file) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf8').replace(/\s+$/, '')
    return [
      '-- ==========================================',
      `-- MIGRATION: ${file}`,
      '-- ==========================================',
      '',
      sql,
      '',
    ].join('\n')
  })
  .join('\n')

writeFileSync(outFile, `${header}\n${body}`)
console.log(`Wrote ${outFile} from ${files.length} migrations.`)
