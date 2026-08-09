'use client'

import { useState } from 'react'
import { generateSlotTimes } from '@/lib/slot-generation'
import { createSlots, type Track, type Orientation } from '@/lib/head'

type Props = {
  track: Track
  orientation: Orientation
  orientationYear?: number
  profileId: string
  onCreated: () => void
}

export function BulkCreateForm({ track, orientation, orientationYear = 2026, profileId, onCreated }: Props) {
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

    if (new Date(times[0].starts_at).getTime() <= Date.now()) {
      setError('That date/time is in the past. Pick a future time.')
      return
    }

    setSubmitting(true)
    const rows = times.map((t) => ({
      track,
      orientation,
      orientation_year: orientationYear,
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
    setTimeout(() => setCreatedCount(null), 3000)
  }

  return (
    <div className="form-card" style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '26px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>➕</div>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 2px' }}>Add slots</h2>
          <p style={{ fontSize: '12.5px', color: '#64748B', margin: 0 }}>Create back-to-back interview slots.</p>
        </div>
      </div>
      
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="bulk-form-row-1" style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1.5 }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Start</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>End</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
            />
          </div>
        </div>
        
        <div className="bulk-form-row-2" style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Interval (min)</label>
            <input
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Capacity</label>
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
            />
          </div>
          <button type="submit" disabled={submitting} style={{ padding: '10.5px 18px', borderRadius: '9px', border: '1px solid #E2E8F0', background: '#fff', color: '#0F172A', fontWeight: 700, fontSize: '14px', cursor: 'pointer', transition: 'all 0.15s', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
      
      {createdCount !== null && (
        <p style={{ marginTop: '14px', fontSize: '13px', color: '#16A34A', fontWeight: 600 }}>Created {createdCount} slot(s) successfully.</p>
      )}
      {error && <p style={{ marginTop: '14px', fontSize: '13px', color: '#B91C1C' }}>{error}</p>}
    </div>
  )
}
