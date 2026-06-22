'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Track } from '@/lib/bookings'

const TRACKS: { value: Track; label: string }[] = [
  { value: 'facilitator', label: 'Facilitator' },
  { value: 'game_master', label: 'Game Master' },
]

export function TrackTabs({ active }: { active: Track }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function selectTrack(track: Track) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('track', track)
    // Switching tracks invalidates any in-progress reschedule selection.
    params.delete('reschedule')
    router.push(`/book?${params.toString()}`)
  }

  return (
    <div className="mt-6 inline-flex rounded-lg border border-border p-1">
      {TRACKS.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => selectTrack(t.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            active === t.value
              ? 'bg-primary text-primary-foreground'
              : 'text-zinc-500 hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
