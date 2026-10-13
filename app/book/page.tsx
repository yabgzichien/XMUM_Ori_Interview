import type { Metadata } from 'next'
import { Suspense } from 'react'
import { BookClient } from '@/app/book/BookClient'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_ORIENTATION, DEFAULT_ORIENTATION_YEAR, isOrientation, type Orientation } from '@/lib/orientation'
import { BOOKABLE_TRACK } from '@/lib/tracks'
import type { AvailableSlot } from '@/lib/booking-helpers'
import type { BookingWindow } from '@/lib/booking-window'

export const metadata: Metadata = {
  title: 'Book Interview',
  description: 'Book an interview slot for the Action Team orientation position.',
}

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const initOrientation: Orientation = isOrientation(params.orientation)
    ? params.orientation
    : DEFAULT_ORIENTATION

  const supabase = await createClient()
  const [slotsRes, windowRes] = await Promise.all([
    supabase.rpc('available_slots', { p_track: BOOKABLE_TRACK, p_orientation: initOrientation, p_year: DEFAULT_ORIENTATION_YEAR }),
    supabase.rpc('booking_window', { p_track: BOOKABLE_TRACK, p_orientation: initOrientation, p_year: DEFAULT_ORIENTATION_YEAR }),
  ])

  const initialSlots = (slotsRes.data as AvailableSlot[] | null) ?? []
  const bookingWindow = ((windowRes.data as BookingWindow[] | null) ?? [])[0] ?? null

  return (
    <Suspense>
      <BookClient
        initialSlots={initialSlots}
        initialOrientation={initOrientation}
        bookingWindow={bookingWindow}
        serverTime={Date.now()}
      />
    </Suspense>
  )
}
