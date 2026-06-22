'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  formatDateHeading,
  formatTimeRange,
  groupSlotsByDate,
  isBookable,
  type AvailableSlot,
} from '@/lib/booking-helpers'

type Props = {
  slots: AvailableSlot[]
  onAction: (slot: AvailableSlot) => Promise<void>
  actionLabel: string
  pendingSlotId: string | null
}

export function SlotList({ slots, onAction, actionLabel, pendingSlotId }: Props) {
  const groups = groupSlotsByDate(slots)

  if (groups.length === 0) {
    return (
      <p className="mt-10 text-sm text-zinc-500">
        No open slots for this track right now. Check back later.
      </p>
    )
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.date}>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {formatDateHeading(group.date)}
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {group.slots.map((slot) => (
              <SlotRow
                key={slot.id}
                slot={slot}
                onAction={onAction}
                actionLabel={actionLabel}
                pending={pendingSlotId === slot.id}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SlotRow({
  slot,
  onAction,
  actionLabel,
  pending,
}: {
  slot: AvailableSlot
  onAction: (slot: AvailableSlot) => Promise<void>
  actionLabel: string
  pending: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const bookable = isBookable(slot)

  async function handleClick() {
    setError(null)
    try {
      await onAction(slot)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg border border-border px-4 py-3',
        !bookable && 'opacity-50',
      )}
    >
      <div>
        <p className="text-sm font-medium">{formatTimeRange(slot.starts_at, slot.ends_at)}</p>
        <p className="text-xs text-zinc-500">
          {slot.seats_left} of {slot.capacity} left
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <Button
        type="button"
        size="sm"
        disabled={!bookable || pending}
        onClick={handleClick}
      >
        {pending ? 'Working...' : actionLabel}
      </Button>
    </div>
  )
}
