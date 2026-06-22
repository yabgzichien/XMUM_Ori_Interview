'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatDateHeading, formatTimeRange, toLocalDateIso } from '@/lib/booking-helpers'
import { deleteSlot, updateSlot, type HeadSlot } from '@/lib/head'

type Props = {
  slots: HeadSlot[]
  loading: boolean
  error: string | null
  onChanged: () => void
}

function SlotRow({ slot, onChanged }: { slot: HeadSlot; onChanged: () => void }) {
  const [capacity, setCapacity] = useState(slot.capacity)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSaveCapacity() {
    if (capacity < slot.booked_count) {
      setError(`Capacity can't be below current bookings (${slot.booked_count}).`)
      return
    }
    setBusy(true)
    setError(null)
    const { error: saveError } = await updateSlot(slot.id, { capacity })
    setBusy(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    onChanged()
  }

  async function handleClose() {
    setBusy(true)
    setError(null)
    const { error: closeError } = await updateSlot(slot.id, { status: 'closed' })
    setBusy(false)
    if (closeError) {
      setError(closeError.message)
      return
    }
    onChanged()
  }

  async function handleDelete() {
    // Slots with bookings can't be deleted (the FK rejects it). Heads should
    // Close such slots instead; the button is disabled in that case.
    if (slot.booked_count > 0) return
    if (!window.confirm('Delete this slot?')) return

    setBusy(true)
    setError(null)
    const { error: deleteError } = await deleteSlot(slot.id)
    setBusy(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    onChanged()
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-3 text-sm">{formatDateHeading(toLocalDateIso(slot.starts_at))}</td>
      <td className="py-2 pr-3 text-sm">{formatTimeRange(slot.starts_at, slot.ends_at)}</td>
      <td className="py-2 pr-3 text-sm">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <Button type="button" variant="outline" size="xs" disabled={busy} onClick={handleSaveCapacity}>
            Save
          </Button>
        </div>
      </td>
      <td className="py-2 pr-3 text-sm">{slot.booked_count}</td>
      <td className="py-2 pr-3 text-sm capitalize">{slot.status}</td>
      <td className="py-2 pr-3 text-sm">
        <div className="flex items-center gap-2">
          {slot.status === 'open' && (
            <Button type="button" variant="outline" size="xs" disabled={busy} onClick={handleClose}>
              Close
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            size="xs"
            disabled={busy || slot.booked_count > 0}
            title={slot.booked_count > 0 ? 'Has bookings — Close it instead' : undefined}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  )
}

export function SlotsTable({ slots, loading, error, onChanged }: Props) {
  return (
    <section>
      <h2 className="text-lg font-medium">Slots</h2>

      {loading && <p className="mt-3 text-sm text-zinc-500">Loading...</p>}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {!loading && !error && slots.length === 0 && (
        <p className="mt-3 text-sm text-zinc-500">No slots yet.</p>
      )}

      {!loading && !error && slots.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-xs text-zinc-500">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 font-medium">Capacity</th>
                <th className="py-2 pr-3 font-medium">Booked</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <SlotRow key={slot.id} slot={slot} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
