import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth'
import { HeadDashboard } from '@/app/head/HeadDashboard'
import type { Track, Orientation } from '@/lib/head'

export const maxDuration = 60

type SearchParams = { [key: string]: string | string[] | undefined }

function isTrack(value: string | string[] | undefined): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

function isOrientation(value: string | string[] | undefined): value is Orientation {
  return value === 'february' || value === 'april' || value === 'december'
}

import { createClient } from '@/lib/supabase/server'
import type { HeadSlot, HeadBooking } from '@/lib/head'

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

  if (profile.role === 'committee' || profile.role === 'performance_lead') {
    redirect('/practice')
  }

  const isAdmin = profile.role === 'admin'
  const isRestricted = !isAdmin && !!profile.orientation
  const params = await searchParams

  let track: Track
  if (profile.role === 'head_facilitator') {
    track = 'facilitator'
  } else if (profile.role === 'head_gm') {
    track = 'game_master'
  } else {
    track = isTrack(params.track) ? params.track : 'facilitator'
  }

  const orientation: Orientation = isRestricted && profile.orientation
    ? profile.orientation
    : isOrientation(params.orientation) ? params.orientation : 'december'

  const orientationYear: number = isRestricted && profile.orientation_year
    ? profile.orientation_year
    : (params.year ? parseInt(String(params.year), 10) || 2026 : 2026)

  // Server-side parallel pre-fetch for instant rendering
  const supabase = await createClient()
  const [slotsRes, bookingsRes] = await Promise.all([
    supabase.rpc('head_slots', { p_track: track, p_orientation: orientation, p_year: orientationYear }),
    supabase.rpc('head_bookings', { p_orientation: orientation, p_year: orientationYear }),
  ])
  const initialSlots = (slotsRes.data as HeadSlot[] | null) ?? []
  const initialBookings = (bookingsRes.data as HeadBooking[] | null) ?? []

  const orientationLabel = orientation.charAt(0).toUpperCase() + orientation.slice(1)

  return (
    <main className="scr head-page-main" style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '32px 24px 48px', boxSizing: 'border-box' }}>
      <div className="head-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: 0, color: 'var(--text-primary, #0F172A)' }}>{orientationLabel} {orientationYear} Orientation Dashboard</h1>
        </div>
        <div className="head-header-controls" style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
          {/* Track Tabs (Admin only) */}
          {isAdmin && (
            <div className="track-toggle-group" style={{ display: 'flex', gap: '8px' }}>
              <Link
                href={`/head?orientation=${orientation}&track=facilitator&year=${orientationYear}`}
                style={{
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 700,
                  background: track === 'facilitator' ? 'var(--text-primary, #0F172A)' : 'var(--bg-card, #fff)',
                  color: track === 'facilitator' ? 'var(--bg-card, #fff)' : 'var(--text-secondary, #475569)',
                  border: track === 'facilitator' ? '1px solid var(--text-primary, #0F172A)' : '1px solid var(--border-input, #E2E8F0)',
                  transition: 'all 0.15s'
                }}
              >
                Facilitator
              </Link>
              <Link
                href={`/head?orientation=${orientation}&track=game_master&year=${orientationYear}`}
                style={{
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 700,
                  background: track === 'game_master' ? 'var(--text-primary, #0F172A)' : 'var(--bg-card, #fff)',
                  color: track === 'game_master' ? 'var(--bg-card, #fff)' : 'var(--text-secondary, #475569)',
                  border: track === 'game_master' ? '1px solid var(--text-primary, #0F172A)' : '1px solid var(--border-input, #E2E8F0)',
                  transition: 'all 0.15s'
                }}
              >
                Game Master
              </Link>
            </div>
          )}
        </div>
      </div>

      <HeadDashboard
        track={track}
        orientation={orientation}
        orientationYear={orientationYear}
        profileId={profile.id}
        isAdmin={isAdmin}
        initialSlots={initialSlots}
        initialBookings={initialBookings}
      />
    </main>
  )
}
