import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth'
import { HeadDashboard } from '@/app/head/HeadDashboard'
import type { Track, Orientation } from '@/lib/head'

type SearchParams = { [key: string]: string | string[] | undefined }

function isTrack(value: string | string[] | undefined): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

function isOrientation(value: string | string[] | undefined): value is Orientation {
  return value === 'february' || value === 'april' || value === 'december'
}

const ORIENTATIONS: { key: Orientation; label: string; icon: string }[] = [
  { key: 'february', label: 'February', icon: '🌸' },
  { key: 'april', label: 'April', icon: '🌿' },
  { key: 'december', label: 'December', icon: '❄️' },
]

export default async function HeadPage({
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

  const isAdmin = profile.role === 'admin'
  const params = await searchParams

  let track: Track
  if (profile.role === 'head_facilitator') {
    track = 'facilitator'
  } else if (profile.role === 'head_gm') {
    track = 'game_master'
  } else {
    track = isTrack(params.track) ? params.track : 'facilitator'
  }

  const orientation: Orientation = isOrientation(params.orientation) ? params.orientation : 'february'

  const orientationLabel = ORIENTATIONS.find(o => o.key === orientation)?.label || 'February'

  return (
    <main className="scr head-page-main" style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 16px 48px' }}>
      <div className="head-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>{orientationLabel} Orientation Dashboard</h1>
          <p style={{ color: '#64748B', fontSize: '14.5px', margin: 0 }}>Manage interview slots and review applicants.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
          {/* Orientation Tabs */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {ORIENTATIONS.map(o => (
              <Link
                key={o.key}
                href={`/head?orientation=${o.key}&track=${track}`}
                style={{
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 700,
                  background: orientation === o.key ? '#EFF4FF' : '#fff',
                  color: orientation === o.key ? '#2563EB' : '#475569',
                  border: orientation === o.key ? '1px solid #2563EB' : '1px solid #E2E8F0',
                  transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                <span>{o.icon}</span> {o.label}
              </Link>
            ))}
          </div>
          {/* Track Tabs (Admin only) */}
          {isAdmin && (
            <div className="track-toggle-group" style={{ display: 'flex', gap: '8px' }}>
              <Link
                href={`/head?orientation=${orientation}&track=facilitator`}
                style={{
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 700,
                  background: track === 'facilitator' ? '#0F172A' : '#fff',
                  color: track === 'facilitator' ? '#fff' : '#475569',
                  border: track === 'facilitator' ? '1px solid #0F172A' : '1px solid #E2E8F0',
                  transition: 'all 0.15s'
                }}
              >
                Facilitator
              </Link>
              <Link
                href={`/head?orientation=${orientation}&track=game_master`}
                style={{
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 700,
                  background: track === 'game_master' ? '#0F172A' : '#fff',
                  color: track === 'game_master' ? '#fff' : '#475569',
                  border: track === 'game_master' ? '1px solid #0F172A' : '1px solid #E2E8F0',
                  transition: 'all 0.15s'
                }}
              >
                Game Master
              </Link>
            </div>
          )}
        </div>
      </div>

      <HeadDashboard track={track} orientation={orientation} profileId={profile.id} isAdmin={isAdmin} />
    </main>
  )
}
