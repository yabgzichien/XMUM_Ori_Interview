import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { HeadPracticeDashboard } from '@/app/head/practice/HeadPracticeDashboard'
import type { Orientation } from '@/lib/head'
import { createClient } from '@/lib/supabase/server'
import type { HeadPracticeGroup, CommitteeRosterEntry, CommitteePositionOption, MyGroup } from '@/lib/practice'

export const metadata: Metadata = {
  title: 'Performance Practice',
  description: 'Manage orientation performance practice groups, leaders, and rosters.',
}

export default async function HeadPracticePage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login')
  }

  if (profile.role === 'applicant') {
    redirect('/book')
  }

  if (profile.role !== 'admin') {
    redirect('/practice')
  }

  const orientation: Orientation = 'december'
  const orientationYear = 2026
  const orientationLabel = 'December'

  // Pre-fetch practice data in parallel on the server
  const supabase = await createClient()
  const [groupsRes, rosterRes, myGroupRes, positionsRes] = await Promise.all([
    supabase.rpc('head_practice_groups', { p_orientation: orientation, p_year: orientationYear }),
    supabase.rpc('head_committee_roster', { p_orientation: orientation, p_year: orientationYear }),
    supabase.rpc('my_practice_group'),
    supabase.from('committee_positions').select('value, label').order('label'),
  ])

  const initialGroups = (groupsRes.data as HeadPracticeGroup[] | null) ?? []
  const initialRoster = (rosterRes.data as CommitteeRosterEntry[] | null) ?? []
  const myGroupRows = (myGroupRes.data as MyGroup[] | null) ?? []
  const initialMyGroup = myGroupRows && myGroupRows.length > 0 ? myGroupRows[0] : null
  const initialPositions = (positionsRes.data as CommitteePositionOption[] | null) ?? []

  return (
    <main className="scr head-page-main" style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '32px 24px 48px', boxSizing: 'border-box' }}>
      <div className="head-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: 0, color: 'var(--text-primary, #0F172A)' }}>{orientationLabel} {orientationYear} Practice Groups</h1>
        </div>
      </div>

      <HeadPracticeDashboard
        orientation={orientation}
        orientationYear={orientationYear}
        isAdmin
        currentUserId={profile.id}
        initialGroups={initialGroups}
        initialRoster={initialRoster}
        initialMyGroup={initialMyGroup}
        initialPositions={initialPositions}
      />
    </main>
  )
}
