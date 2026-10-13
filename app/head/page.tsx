import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { HeadDashboard } from '@/app/head/HeadDashboard'
import type { Orientation } from '@/lib/head'
import { BOOKABLE_TRACK } from '@/lib/tracks'
import { createClient } from '@/lib/supabase/server'
import type { HeadSlot, HeadBooking } from '@/lib/head'
import type { BookingWindow } from '@/lib/booking-window'

export const metadata: Metadata = {
  title: 'Orientation Dashboard',
  description: 'Manage interview slots, view candidate applications, and monitor booking capacity.',
}

export const maxDuration = 60

type SearchParams = { [key: string]: string | string[] | undefined }

function isOrientation(value: string | string[] | undefined): value is Orientation {
  return value === 'february' || value === 'april' || value === 'december'
}

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

  // Action Team is the only interview track now; admins manage it directly.
  const track = BOOKABLE_TRACK

  const orientation: Orientation = isRestricted && profile.orientation
    ? profile.orientation
    : isOrientation(params.orientation) ? params.orientation : 'december'

  const orientationYear: number = isRestricted && profile.orientation_year
    ? profile.orientation_year
    : (params.year ? parseInt(String(params.year), 10) || 2026 : 2026)

  // Server-side parallel pre-fetch for instant rendering
  const supabase = await createClient()
  const [slotsRes, bookingsRes, windowRes] = await Promise.all([
    supabase.rpc('head_slots', { p_track: track, p_orientation: orientation, p_year: orientationYear }),
    // All tracks, so admins can still see and clear past Facilitator / Game Master records.
    supabase.rpc('head_bookings', { p_orientation: orientation, p_year: orientationYear }),
    supabase.rpc('booking_window', { p_track: track, p_orientation: orientation, p_year: orientationYear }),
  ])
  const initialSlots = (slotsRes.data as HeadSlot[] | null) ?? []
  const initialBookings = (bookingsRes.data as HeadBooking[] | null) ?? []
  const initialWindow = ((windowRes.data as BookingWindow[] | null) ?? [])[0] ?? null

  const orientationLabel = orientation.charAt(0).toUpperCase() + orientation.slice(1)

  return (
    <main className="scr head-page-main" style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '32px 24px 48px', boxSizing: 'border-box' }}>
      <div className="head-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: 0, color: 'var(--text-primary, #0F172A)' }}>{orientationLabel} {orientationYear} Orientation Dashboard</h1>
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
        initialWindow={initialWindow}
      />
    </main>
  )
}
