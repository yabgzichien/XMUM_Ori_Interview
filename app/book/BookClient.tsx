'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TrackTabs } from '@/app/book/TrackTabs'
import { SlotList } from '@/app/book/SlotList'
import { getAvailableSlots, bookSlotPublic, type Track } from '@/lib/bookings'
import { formatDateHeading, formatTimeRange, toLocalDateIso, type AvailableSlot } from '@/lib/booking-helpers'

function isTrack(value: string | null): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

const trackLabels: Record<Track, string> = {
  facilitator: 'Facilitator',
  game_master: 'Game Master',
}

type Confirmation = {
  reference: string
  name: string
  track: Track
  slot: AvailableSlot
}

export function BookClient() {
  const searchParams = useSearchParams()
  const track: Track = isTrack(searchParams.get('track'))
    ? (searchParams.get('track') as Track)
    : 'facilitator'

  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AvailableSlot | null>(null)

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [experiences, setExperiences] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  // No synchronous setState before the await, so this is safe to call from the
  // mount/track-change effect. Selection is cleared after the fetch resolves.
  const loadSlots = useCallback(async () => {
    const { data, error } = await getAvailableSlots(track)
    setLoading(false)
    setSelected(null)
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

  function resetForm() {
    setName('')
    setStudentId('')
    setEmail('')
    setExperiences('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) {
      setError('Please select a time slot first.')
      return
    }
    setError(null)
    setSubmitting(true)
    const { data, error } = await bookSlotPublic(selected.id, { name, studentId, email, experiences })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    if (data) {
      setConfirmation({
        reference: data.id.slice(0, 8).toUpperCase(),
        name: data.applicant_name,
        track,
        slot: selected,
      })
      resetForm()
    }
  }

  function bookAnother() {
    setConfirmation(null)
    refresh()
  }

  if (confirmation) {
    return (
      <div className="mt-8 rounded-xl border border-green-300 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950">
        <h2 className="text-lg font-semibold text-green-900 dark:text-green-200">
          Booking confirmed
        </h2>
        <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="text-zinc-500">Reference</dt>
          <dd className="font-mono font-medium">{confirmation.reference}</dd>
          <dt className="text-zinc-500">Name</dt>
          <dd>{confirmation.name}</dd>
          <dt className="text-zinc-500">Track</dt>
          <dd>{trackLabels[confirmation.track]}</dd>
          <dt className="text-zinc-500">Date</dt>
          <dd>{formatDateHeading(toLocalDateIso(confirmation.slot.starts_at))}</dd>
          <dt className="text-zinc-500">Time</dt>
          <dd>{formatTimeRange(confirmation.slot.starts_at, confirmation.slot.ends_at)}</dd>
        </dl>
        <p className="mt-4 text-xs text-green-800 dark:text-green-300">
          Please keep your reference. To change or cancel, contact the organisers.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={bookAnother}>
          Book another interview
        </Button>
      </div>
    )
  }

  return (
    <div>
      <TrackTabs active={track} />

      <div className="mt-4 flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh availability'}
        </Button>
      </div>

      {loadError && <p className="mt-4 text-sm text-destructive">{loadError}</p>}

      {loading ? (
        <p className="mt-10 text-sm text-zinc-500">Loading slots...</p>
      ) : (
        <SlotList
          slots={slots}
          selectedSlotId={selected?.id ?? null}
          onSelect={(slot) => setSelected(slot)}
        />
      )}

      {!loading && slots.length > 0 && (
        <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-4 border-t border-border pt-8">
          <div>
            <h2 className="text-lg font-medium">Your details</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {selected
                ? `Selected: ${formatTimeRange(selected.starts_at, selected.ends_at)} on ${formatDateHeading(toLocalDateIso(selected.starts_at))}`
                : 'Select a time slot above, then fill in your details.'}
            </p>
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Full name
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Student ID
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Experiences
            <textarea
              rows={4}
              value={experiences}
              onChange={(e) => setExperiences(e.target.value)}
              placeholder="Briefly tell us about any relevant experience."
              className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={submitting || !selected} className="w-fit">
            {submitting ? 'Booking...' : 'Book interview'}
          </Button>
        </form>
      )}
    </div>
  )
}
