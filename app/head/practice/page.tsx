import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth'
import { HeadPracticeDashboard } from '@/app/head/practice/HeadPracticeDashboard'
import type { Orientation } from '@/lib/head'

type SearchParams = { [key: string]: string | string[] | undefined }

function isOrientation(value: string | string[] | undefined): value is Orientation {
  return value === 'february' || value === 'april' || value === 'december'
}

const ORIENTATIONS: { key: Orientation; label: string; icon: string }[] = [
  { key: 'february', label: 'February', icon: '🌸' },
  { key: 'april', label: 'April', icon: '🌿' },
  { key: 'december', label: 'December', icon: '❄️' },
]

import { createClient } from '@/lib/supabase/server'
import type { HeadPracticeGroup, CommitteeRosterEntry, CommitteePositionOption, MyGroup } from '@/lib/practice'

export default async function HeadPracticePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
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

  const params = await searchParams

  const orientation: Orientation = isOrientation(params.orientation) ? params.orientation : 'december'
  const orientationYear: number = params.year ? parseInt(String(params.year), 10) || 2026 : 2026

  const orientationLabel = ORIENTATIONS.find(o => o.key === orientation)?.label || 'February'

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
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px', color: 'var(--text-primary, #0F172A)' }}>{orientationLabel} {orientationYear} Practice Groups</h1>
          <p style={{ color: 'var(--text-muted, #64748B)', fontSize: '14.5px', margin: 0 }}>
            Create groups, assign performance leads, and track sessions. Facilitators and Game
            Masters practice together — groups aren&apos;t split by track.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {ORIENTATIONS.map(o => (
            <Link
              key={o.key}
              href={`/head/practice?orientation=${o.key}&year=${orientationYear}`}
              style={{
                padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 700,
                background: orientation === o.key ? 'var(--accent-subtle, #EFF4FF)' : 'var(--bg-card, #fff)',
                color: orientation === o.key ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #475569)',
                border: orientation === o.key ? '1px solid var(--accent-text, #2563EB)' : '1px solid var(--border-input, #E2E8F0)',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span>{o.icon}</span> {o.label}
            </Link>
          ))}
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
