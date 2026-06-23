'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { generateSlotTimes } from '@/lib/slot-generation'
import { createSlots, type Track } from '@/lib/head'

type Props = {
  track: Track
  profileId: string
  onCreated: () => void
}

export function BulkCreateForm({ track, profileId, onCreated }: Props) {
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [intervalMinutes, setIntervalMinutes] = useState(15)
  const [capacity, setCapacity] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdCount, setCreatedCount] = useState<number | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCreatedCount(null)

    let times: ReturnType<typeof generateSlotTimes>
    try {
      times = generateSlotTimes({ date, startTime, endTime, intervalMinutes })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid input')
      return
    }

    if (times.length === 0) {
      setError('No slots fit in that time range.')
      return
    }

    // Slots in the past won't appear in the public Book tab, so block them here.
    if (new Date(times[0].starts_at).getTime() <= Date.now()) {
      setError('That date/time is in the past. Pick a future time.')
      return
    }

    setSubmitting(true)
    const rows = times.map((t) => ({
      track,
      starts_at: t.starts_at,
      ends_at: t.ends_at,
      capacity,
      status: 'open' as const,
      created_by: profileId,
    }))
    const { error: createError } = await createSlots(rows)
    setSubmitting(false)

    if (createError) {
      setError(createError.message)
      return
    }

    setCreatedCount(times.length)
    onCreated()
  }

  return (
    <section>
      <h2 className="text-lg font-medium">Bulk-create slots</h2>

      <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Start time
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          End time
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Interval (min)
          <input
            type="number"
            min={1}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            required
            className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Capacity
          <input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            required
            className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create slots'}
        </Button>
      </form>

      {createdCount !== null && (
        <p className="mt-2 text-sm text-green-600">Created {createdCount} slot(s).</p>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
