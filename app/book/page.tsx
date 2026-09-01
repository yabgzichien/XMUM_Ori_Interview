import { Suspense } from 'react'
import { BookClient } from '@/app/book/BookClient'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_ORIENTATION, isOrientation, type Orientation } from '@/lib/orientation'
import type { Track } from '@/lib/bookings'
import type { AvailableSlot } from '@/lib/booking-helpers'

type SearchParams = { [key: string]: string | string[] | undefined }

function isTrack(value: string | string[] | undefined): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const initTrack: Track = isTrack(params.track) ? params.track : 'facilitator'
  const initOrientation: Orientation = isOrientation(params.orientation)
    ? params.orientation
    : DEFAULT_ORIENTATION

  const supabase = await createClient()
  const [fac, gm] = await Promise.all([
    supabase.rpc('available_slots', { p_track: 'facilitator', p_orientation: initOrientation, p_year: 2026 }),
    supabase.rpc('available_slots', { p_track: 'game_master', p_orientation: initOrientation, p_year: 2026 }),
  ])

  const initialSlotsByTrack: Record<Track, AvailableSlot[]> = {
    facilitator: (fac.data as AvailableSlot[] | null) ?? [],
    game_master: (gm.data as AvailableSlot[] | null) ?? [],
  }

  return (
    <Suspense>
      <BookClient
        initialSlotsByTrack={initialSlotsByTrack}
        initialOrientation={initOrientation}
        initialTrack={initTrack}
      />
    </Suspense>
  )
}
