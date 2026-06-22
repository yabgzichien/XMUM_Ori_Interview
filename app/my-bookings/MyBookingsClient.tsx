'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { BookingRow } from '@/app/my-bookings/BookingRow'
import {
  getMyActiveBookings,
  getTrackSettings,
  type BookingWithSlot,
  type Track,
} from '@/lib/bookings'

const DEFAULT_CUTOFF_HOURS = 2

export function MyBookingsClient() {
  const [bookings, setBookings] = useState<BookingWithSlot[]>([])
  const [cutoffByTrack, setCutoffByTrack] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // No synchronous setState before the await — safe to call from the effect.
  const load = useCallback(async () => {
    const [bookingsRes, settingsRes] = await Promise.all([
      getMyActiveBookings(),
      getTrackSettings(),
    ])
    setLoading(false)

    if (bookingsRes.error) {
      setError(bookingsRes.error.message)
      setBookings([])
      return
    }
    setError(null)
    setBookings(bookingsRes.data ?? [])

    const cutoffs: Record<string, number> = {}
    for (const s of settingsRes.data ?? []) {
      cutoffs[s.track] = s.reschedule_cutoff_hours
    }
    setCutoffByTrack(cutoffs)
  }, [])

  useEffect(() => {
    // Fetch-on-mount; state is only set after the await inside load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  if (loading) {
    return <p className="mt-10 text-sm text-zinc-500">Loading your bookings...</p>
  }

  if (error) {
    return <p className="mt-10 text-sm text-destructive">{error}</p>
  }

  if (bookings.length === 0) {
    return (
      <div className="mt-10 text-sm text-zinc-500">
        <p>You have no active bookings.</p>
        <Link href="/book" className={buttonVariants({ variant: 'default', size: 'sm' })}>
          Book an interview
        </Link>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {bookings.map((booking) => (
        <BookingRow
          key={booking.id}
          booking={booking}
          cutoffHours={cutoffByTrack[booking.track as Track] ?? DEFAULT_CUTOFF_HOURS}
          onChanged={load}
        />
      ))}
    </div>
  )
}
