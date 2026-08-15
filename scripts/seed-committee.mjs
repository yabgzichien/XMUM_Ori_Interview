// Seed demo committee-member accounts for testing performance practice
// groups (a committee member becomes eligible once an interview is approved
// and they're invited — this script skips straight to a ready-to-use
// account so you can test group creation/joining without running the full
// interview + bulk-invite flow).
//
// Run once migrations 0016-0019 are applied:
//   node --env-file=.env.local scripts/seed-committee.mjs
// (or `npm run seed:committee`)
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the env.
// Passwords come from env vars if set, else a temporary default (change them!).

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const TEMP_DEFAULT = 'ChangeMe!2026'
const ORIENTATION = process.env.SEED_COMMITTEE_ORIENTATION || 'december'

const ORIENTATION_YEAR = parseInt(process.env.SEED_COMMITTEE_YEAR || '2026', 10)

// Facilitators and Game Masters practice together in the same group, so this
// seeds committee members from both tracks to demonstrate that.
const accounts = [
  { email: 'committee1.facilitator@xmum.local', name: 'Alice Tan', track: 'facilitator', position: 'hof' },
  { email: 'committee2.facilitator@xmum.local', name: 'Ben Lim', track: 'facilitator', position: 'facilitator' },
  { email: 'committee3.facilitator@xmum.local', name: 'Chen Wei', track: 'facilitator', position: 'secretary' },
  { email: 'committee1.gm@xmum.local', name: 'Dinesh Kumar', track: 'game_master', position: 'game_master' },
  { email: 'committee2.gm@xmum.local', name: 'Emily Wong', track: 'game_master', position: 'hog' },
  { email: 'committee3.gm@xmum.local', name: 'Farah Aziz', track: 'game_master', position: 'treasurer' },
].map((a) => ({ ...a, password: process.env.SEED_COMMITTEE_PASSWORD || TEMP_DEFAULT }))

// Find an existing auth user by email (paginates through the admin list).
async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (match) return match
    if (data.users.length < 1000) break
  }
  return null
}

async function ensureAccount(acc) {
  let userId
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: acc.email,
    password: acc.password,
    email_confirm: true,
    user_metadata: { name: acc.name },
  })

  if (createErr) {
    const existing = await findUserByEmail(acc.email)
    if (!existing) throw createErr
    userId = existing.id
    console.log(`• ${acc.email} already exists — updating profile`)
  } else {
    userId = created.user.id
    console.log(`• created ${acc.email}`)
  }

  // The handle_new_user trigger creates the profile as 'applicant'; upsert the
  // correct role/track/orientation (upsert also covers reruns).
  const { error: upsertErr } = await admin.from('profiles').upsert(
    {
      id: userId,
      name: acc.name,
      email: acc.email,
      role: 'committee',
      track: acc.track,
      position: acc.position,
      orientation: ORIENTATION,
      orientation_year: ORIENTATION_YEAR,
    },
    { onConflict: 'id' },
  )
  if (upsertErr) throw upsertErr
  console.log(`  → committee (${acc.track}, ${acc.position}, ${ORIENTATION} ${ORIENTATION_YEAR})`)
}

async function main() {
  for (const acc of accounts) {
    await ensureAccount(acc)
  }
  console.log('\nSeed complete.')
  console.warn(
    `\n⚠  Accounts use the password "${process.env.SEED_COMMITTEE_PASSWORD || TEMP_DEFAULT}" ` +
      'unless SEED_COMMITTEE_PASSWORD is set. For testing only — do not reuse in production.',
  )
}

main().catch((err) => {
  console.error('Seed failed:', err.message ?? err)
  process.exit(1)
})
