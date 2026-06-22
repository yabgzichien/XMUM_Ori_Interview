// Seed the admin + the two Head accounts.
//
// Run once a Supabase project exists and migrations are applied:
//   node --env-file=.env.local scripts/seed.mjs
// (or `npm run seed`, which passes --env-file=.env.local)
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

const accounts = [
  {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@xmum.local',
    password: process.env.SEED_ADMIN_PASSWORD || TEMP_DEFAULT,
    name: 'Orientation Admin',
    role: 'admin',
  },
  {
    email: process.env.SEED_HEAD_FACILITATOR_EMAIL || 'head.facilitator@xmum.local',
    password: process.env.SEED_HEAD_FACILITATOR_PASSWORD || TEMP_DEFAULT,
    name: 'Head of Facilitators',
    role: 'head_facilitator',
  },
  {
    email: process.env.SEED_HEAD_GM_EMAIL || 'head.gm@xmum.local',
    password: process.env.SEED_HEAD_GM_PASSWORD || TEMP_DEFAULT,
    name: 'Head of Game Masters',
    role: 'head_gm',
  },
]

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
    // Likely already exists — look it up so we can still set the role.
    const existing = await findUserByEmail(acc.email)
    if (!existing) throw createErr
    userId = existing.id
    console.log(`• ${acc.email} already exists — updating role`)
  } else {
    userId = created.user.id
    console.log(`• created ${acc.email}`)
  }

  // The handle_new_user trigger creates the profile as 'applicant'; upsert the
  // correct role + name (upsert covers the rare case the trigger didn't run).
  const { error: upsertErr } = await admin.from('profiles').upsert(
    { id: userId, name: acc.name, email: acc.email, role: acc.role },
    { onConflict: 'id' },
  )
  if (upsertErr) throw upsertErr
  console.log(`  → role set to ${acc.role}`)
}

async function main() {
  const usingDefaults = accounts.some(
    (a) => a.password === TEMP_DEFAULT,
  )
  for (const acc of accounts) {
    await ensureAccount(acc)
  }
  console.log('\nSeed complete.')
  if (usingDefaults) {
    console.warn(
      `\n⚠  Some accounts use the temporary password "${TEMP_DEFAULT}". ` +
        'Set SEED_*_PASSWORD env vars or change the passwords after first login.',
    )
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message ?? err)
  process.exit(1)
})
