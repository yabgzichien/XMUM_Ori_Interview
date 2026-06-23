'use client'

import { useCallback, useEffect, useState } from 'react'
import { WindowForm } from '@/app/head/WindowForm'
import { BulkCreateForm } from '@/app/head/BulkCreateForm'
import { SlotsTable } from '@/app/head/SlotsTable'
import { BookingsTable } from '@/app/head/BookingsTable'
import { getHeadSlots, getHeadBookings, type HeadBooking, type HeadSlot, type Track } from '@/lib/head'

type Props = {
  track: Track
  profileId: string
  isAdmin: boolean
}

export function HeadDashboard({ track, profileId }: Props) {
  const [slots, setSlots] = useState<HeadSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(true)
  const [slotsError, setSlotsError] = useState<string | null>(null)

  const [bookings, setBookings] = useState<HeadBooking[]>([])
  const [bookingsLoading, setBookingsLoading] = useState(true)
  const [bookingsError, setBookingsError] = useState<string | null>(null)

  // No synchronous setState before the await — safe to call from the effect.
  const loadSlots = useCallback(async () => {
    const { data, error } = await getHeadSlots(track)
    setSlotsLoading(false)
    if (error) {
      setSlotsError(error.message)
      setSlots([])
      return
    }
    setSlotsError(null)
    setSlots(data ?? [])
  }, [track])

  // No synchronous setState before the await — safe to call from the effect.
  const loadBookings = useCallback(async () => {
    const { data, error } = await getHeadBookings(track)
    setBookingsLoading(false)
    if (error) {
      setBookingsError(error.message)
      setBookings([])
      return
    }
    setBookingsError(null)
    setBookings(data ?? [])
  }, [track])

  useEffect(() => {
    // Fetch-on-mount/track-change; state is only set after the await inside loadSlots.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSlots()
  }, [loadSlots])

  useEffect(() => {
    // Fetch-on-mount/track-change; state is only set after the await inside loadBookings.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBookings()
  }, [loadBookings])

  function refreshSlots() {
    setSlotsLoading(true)
    loadSlots()
  }

  function refreshBookings() {
    setBookingsLoading(true)
    loadBookings()
  }

  return (
    <div className="flex flex-col gap-10">
      <WindowForm track={track} />

      <BulkCreateForm track={track} profileId={profileId} onCreated={refreshSlots} />

      <SlotsTable slots={slots} loading={slotsLoading} error={slotsError} onChanged={refreshSlots} />

      <BookingsTable
        bookings={bookings}
        loading={bookingsLoading}
        error={bookingsError}
        onChanged={refreshBookings}
      />
    </div>
  )
}
