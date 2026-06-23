'use client'

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
  selectedSlotId: string | null
  onSelect: (slot: AvailableSlot) => void
}

export function SlotList({ slots, selectedSlotId, onSelect }: Props) {
  const groups = groupSlotsByDate(slots)

  if (groups.length === 0) {
    return (
      <p className="mt-8 text-sm text-zinc-500">
        No open slots for this track right now. Check back later.
      </p>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.date}>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {formatDateHeading(group.date)}
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {group.slots.map((slot) => {
              const bookable = isBookable(slot)
              const selected = selectedSlotId === slot.id
              return (
                <div
                  key={slot.id}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-4 py-3',
                    selected ? 'border-primary ring-1 ring-primary' : 'border-border',
                    !bookable && 'opacity-50',
                  )}
                >
                  <div>
                    <p className="text-sm font-medium">
                      {formatTimeRange(slot.starts_at, slot.ends_at)}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {Math.max(0, slot.seats_left)} of {slot.capacity} left
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    disabled={!bookable}
                    onClick={() => onSelect(slot)}
                  >
                    {selected ? 'Selected' : 'Select'}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
