'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TrackTabs } from '@/app/book/TrackTabs'
import { SlotList } from '@/app/book/SlotList'
import { getAvailableSlots, bookSlot, rescheduleBooking, type Track } from '@/lib/bookings'
import type { AvailableSlot } from '@/lib/booking-helpers'

function isTrack(value: string | null): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

export function BookClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const track: Track = isTrack(searchParams.get('track')) ? (searchParams.get('track') as Track) : 'facilitator'
  const rescheduleBookingId = searchParams.get('reschedule')

  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  // Note: no synchronous setState before the await, so this is safe to call
  // from the mount effect without triggering cascading renders.
  const loadSlots = useCallback(async () => {
    const { data, error } = await getAvailableSlots(track)
    setLoading(false)
    setConfirmation(null)
    if (error) {
      setLoadError(error.message)
      setSlots([])
      return
    }
    setLoadError(null)
    setSlots(data ?? [])
  }, [track])

  useEffect(() => {
    // Fetch-on-mount/track-change; state is only set after the await inside loadSlots.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSlots()
  }, [loadSlots])

  function refresh() {
    setLoading(true)
    loadSlots()
  }

  async function handleAction(slot: AvailableSlot) {
    setConfirmation(null)
    setPendingSlotId(slot.id)
    try {
      if (rescheduleBookingId) {
        const { error } = await rescheduleBooking(rescheduleBookingId, slot.id)
        if (error) throw new Error(error.message)
        router.push('/my-bookings')
        return
      }

      const { error } = await bookSlot(slot.id)
      if (error) throw new Error(error.message)
      await loadSlots()
      setConfirmation('Booked! See you then.')
    } finally {
      setPendingSlotId(null)
    }
  }

  return (
    <div>
      <TrackTabs active={track} />

      {rescheduleBookingId && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Choose a new slot to move your interview.
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh availability'}
        </Button>
        {confirmation && <p className="text-sm text-green-600">{confirmation}</p>}
      </div>

      {loadError && <p className="mt-4 text-sm text-destructive">{loadError}</p>}

      {loading ? (
        <p className="mt-10 text-sm text-zinc-500">Loading slots...</p>
      ) : (
        <SlotList
          slots={slots}
          onAction={handleAction}
          actionLabel={rescheduleBookingId ? 'Move here' : 'Book'}
          pendingSlotId={pendingSlotId}
        />
      )}
    </div>
  )
}
