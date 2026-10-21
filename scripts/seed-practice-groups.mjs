// Seed the December 2026 performance practice groups from the
// "Vortexa Performance" Drive folder: one group per folder, named after its
// performance leads, with the song list, performance video and song audio.
//
//   node --env-file=.env.local scripts/seed-practice-groups.mjs [--dry-run]
// (or `npm run seed:practice-groups`)
//
// Leaders must already be on committee_roster (matched by student ID). Safe to
// re-run: groups are matched by name, details are updated, leaders replaced.

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dryRun = process.argv.includes('--dry-run')

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const driveFile = (id) => `https://drive.google.com/file/d/${id}/view?usp=sharing`

// `leaders` are roster student IDs. A group with a `pending` reason is skipped
// and reported (use it when a lead can't be identified on the roster yet).
const groups = [
  {
    name: 'Way Rern + David',
    songs: ['All I Want For Christmas Is You', 'APT', 'Dream Is Power'],
    leaders: ['FIA2604004' /* Chang Way Rern */, 'MEG2609001' /* David Chong Kai Xiang */],
    videoId: '1UcjDVjg8Q4Hz29CyYi8wxpOZBQ_H_paH',
    audioId: '1JUKe1SfGhpOumeoMXolRzQNxtbZxFfzX',
  },
  {
    name: 'WenSuen + Darlene',
    songs: ['GOOD BOY', 'Blessed-Cursed', '4Walls', 'KISS N TELL', 'Super Shy', 'Bloody Paradise'],
    leaders: ['COS2504310' /* Loh Wen Suen */, 'ADT2409138' /* Darlene Brittany Gunawan */],
    videoId: '1kmneLklTssNnmAhcil67Sz6S3k30EUH_',
    audioId: '1DcOhosqbiKV4gZROshIIufUZ9Re43R0z',
  },
  {
    name: 'Richie + Zhen Liang + Jia Min',
    songs: ['Catch Catch', 'Ima- Even if the world ends tomorrow', 'Bye Bye Bye', 'Mr. Chu', 'Signal', "I'm gonna toesa", 'Surf'],
    leaders: ['IBU2409115' /* Dee Richie Johnson */, 'FIA2508268' /* Cheng Jia MIn */, 'TCM2609163' /* Siew Zhen Liang */],
    videoId: '1tsSk4wb2ZBT31hWeGBrKlzaQ6k9inE7f',
    audioId: '1KMdgMIs_hZNp3h642l1uRx0Qvzi_YkOl',
  },
  {
    name: 'Tyler + Xenxuan + Anna',
    songs: ['Killin it girl', 'Finesse', 'Fire', 'Tell me', 'Runaway baby', 'The greatest show'],
    leaders: ['COS2504099' /* Tyler Ting Hua Fonn */, 'FIN2609136' /* Chin Xen Xuan */, 'IBU2609133' /* Chin Huey Pin ("Anna" in the folder name) */],
    videoId: '1OjCBdBrDVpJb8VpZucz9P7yzlaAor3gG',
    audioId: '12uP9lTcIQClVSoS0SkHm-5IY_pACFi2I',
  },
]

async function adminProfileId() {
  const { data, error } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1)
  if (error) throw error
  if (!data?.length) throw new Error('No admin profile found; run `npm run seed` first.')
  return data[0].id
}

async function resolveLeaders(studentIds) {
  const { data, error } = await admin
    .from('committee_roster')
    .select('id, name, student_id, active')
    .in('student_id', studentIds)
  if (error) throw error
  const byStudentId = new Map((data ?? []).map((row) => [row.student_id, row]))
  return studentIds.map((studentId) => {
    const row = byStudentId.get(studentId)
    if (!row) throw new Error(`Roster has no member with student ID ${studentId}.`)
    if (!row.active) throw new Error(`${row.name} (${studentId}) is inactive on the roster.`)
    return row
  })
}

async function seedGroup(group, createdBy) {
  const leaders = await resolveLeaders(group.leaders)
  const fields = {
    songs: group.songs.join(' + '),
    performance_video_url: driveFile(group.videoId),
    song_source_type: 'external',
    song_url: driveFile(group.audioId),
    song_storage_path: null,
  }

  const { data: existing, error: lookupError } = await admin
    .from('practice_groups')
    .select('id')
    .eq('orientation', 'december')
    .eq('orientation_year', 2026)
    .eq('name', group.name)
    .maybeSingle()
  if (lookupError) throw lookupError

  const leaderNames = leaders.map((leader) => leader.name).join(', ')
  if (dryRun) {
    console.log(`• [dry run] would ${existing ? 'update' : 'create'} "${group.name}" — leaders: ${leaderNames}`)
    return
  }

  let groupId = existing?.id
  if (groupId) {
    const { error } = await admin.from('practice_groups').update(fields).eq('id', groupId)
    if (error) throw error
  } else {
    const { data, error } = await admin.from('practice_groups').insert({
      name: group.name,
      capacity: 2,
      committee_capacity: 1,
      faci_gm_capacity: 1,
      status: 'open',
      orientation: 'december',
      orientation_year: 2026,
      created_by: createdBy,
      ...fields,
    }).select('id').single()
    if (error) throw error
    groupId = data.id
  }

  const { error: clearError } = await admin.from('practice_group_leaders').delete().eq('group_id', groupId)
  if (clearError) throw clearError
  const { error: leaderError } = await admin
    .from('practice_group_leaders')
    .insert(leaders.map((leader) => ({ group_id: groupId, roster_member_id: leader.id })))
  if (leaderError) throw leaderError

  console.log(`• ${existing ? 'updated' : 'created'} "${group.name}" — leaders: ${leaderNames}`)
}

async function main() {
  const createdBy = await adminProfileId()
  for (const group of groups) {
    if (group.pending) {
      console.log(`• skipped "${group.name}" — ${group.pending}`)
      continue
    }
    await seedGroup(group, createdBy)
  }
  console.log(dryRun ? '\nDry run only; nothing was written.' : '\nPractice group seed complete.')
}

main().catch((err) => {
  console.error('Seed failed:', err.message ?? err)
  process.exit(1)
})
