// Seed demo committee roster rows for December 2026 practice booking.
// These people do not get logins. The only accounts are the three created
// by scripts/seed.mjs.
//
//   node --env-file=.env.local scripts/seed-committee.mjs
// (or `npm run seed:committee`)

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const members = [
  { name: 'Alice Tan', student_id: 'DSC2404101', position: 'designer' },
  { name: 'Ben Lim', student_id: 'DSC2404102', position: 'facilitator' },
  { name: 'Chen Wei', student_id: 'DSC2404103', position: 'secretary' },
  { name: 'Dinesh Kumar', student_id: 'DSC2404104', position: 'game_master' },
  { name: 'Emily Wong', student_id: 'DSC2404105', position: 'facilitator' },
  { name: 'Farah Aziz', student_id: 'DSC2404106', position: 'treasurer' },
]

async function ensureMember(member) {
  const { data: existing, error: lookupError } = await admin
    .from('committee_roster')
    .select('id')
    .eq('student_id', member.student_id)
    .maybeSingle()
  if (lookupError) throw lookupError

  if (existing) {
    const { error } = await admin.from('committee_roster').update({
      name: member.name,
      position: member.position,
      active: true,
    }).eq('id', existing.id)
    if (error) throw error
    console.log(`• ${member.student_id} already on the roster — updated`)
    return
  }

  const { error } = await admin.from('committee_roster').insert({ ...member, active: true })
  if (error) throw error
  console.log(`• added ${member.name} (${member.student_id}, ${member.position})`)
}

async function main() {
  for (const member of members) {
    await ensureMember(member)
  }
  console.log('\nRoster seed complete. No login accounts were created.')
}

main().catch((err) => {
  console.error('Seed failed:', err.message ?? err)
  process.exit(1)
})
