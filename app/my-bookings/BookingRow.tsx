'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { canModifyBooking, formatDateHeading, formatTimeRange, toLocalDateIso } from '@/lib/booking-helpers'
import { cancelBooking, type BookingWithSlot } from '@/lib/bookings'

const TRACK_LABELS: Record<string, string> = {
  facilitator: 'Facilitator',
  game_master: 'Game Master',
}

type Props = {
  booking: BookingWithSlot
  cutoffHours: number
  onChanged: () => void
}

export function BookingRow({ booking, cutoffHours, onChanged }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const slot = booking.slots
  if (!slot) return null

  const modifiable = canModifyBooking(slot.starts_at, cutoffHours)

  async function handleCancel() {
    if (!window.confirm('Cancel this booking?')) return
    setError(null)
    setBusy(true)
    const { error: cancelError } = await cancelBooking(booking.id)
    setBusy(false)
    if (cancelError) {
      setError(cancelError.message)
      return
    }
    onChanged()
  }

  function handleReschedule() {
    router.push(`/book?track=${booking.track}&reschedule=${booking.id}`)
  }

  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{TRACK_LABELS[booking.track] ?? booking.track}</p>
          <p className="text-xs text-zinc-500">{formatDateHeading(toLocalDateIso(slot.starts_at))}</p>
          <p className="text-xs text-zinc-500">{formatTimeRange(slot.starts_at, slot.ends_at)}</p>
        </div>

        <div className="flex items-center gap-2">
          {modifiable ? (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={handleReschedule}>
                Reschedule
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={handleCancel}>
                {busy ? 'Cancelling...' : 'Cancel'}
              </Button>
            </>
          ) : (
            <span className="text-xs text-zinc-400">Locked (past cutoff)</span>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
