'use client'

import { useEffect, useMemo, useState } from 'react'
import { generateSlotTimes } from '@/lib/slot-generation'
import { createSlots, type HeadSlot, type Track, type Orientation } from '@/lib/head'
import { formatDateHeading, toLocalDateIso } from '@/lib/booking-helpers'
import { MultiDatePicker } from '@/components/MultiDatePicker'

type Props = {
  track: Track
  orientation: Orientation
  orientationYear?: number
  profileId: string
  /** Slots that already exist for this track/orientation, used to flag clashes. */
  existingSlots: HeadSlot[]
  onCreated: () => void
}

type PlannedSlot = {
  starts_at: string
  ends_at: string
  conflict: boolean
  past: boolean
}

const DURATION_PRESETS = [10, 15, 20, 30, 45, 60]

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px',
  display: 'block',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #E2E8F0',
  borderRadius: '9px',
  fontSize: '14px',
  fontFamily: 'inherit',
  color: '#0F172A',
  background: '#fff',
  boxSizing: 'border-box',
}

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid #EAEEF4',
  paddingTop: '18px',
  marginTop: '18px',
}

function fieldError(message: string) {
  return (
    <div style={{ fontSize: '12.5px', color: '#B91C1C', fontWeight: 600, marginTop: '6px' }}>{message}</div>
  )
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function BulkCreateForm({
  track,
  orientation,
  orientationYear = 2026,
  profileId,
  existingSlots,
  onCreated,
}: Props) {
  const [dates, setDates] = useState<string[]>([])
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('12:00')
  const [intervalMinutes, setIntervalMinutes] = useState(15)
  const [capacity, setCapacity] = useState(1)
  const [venue, setVenue] = useState('')
  const [skipConflicts, setSkipConflicts] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdCount, setCreatedCount] = useState<number | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [touched, setTouched] = useState(false)

  // Dates that already carry slots, so the calendar can hint at them.
  const datesWithSlots = useMemo(
    () => new Set(existingSlots.map((s) => toLocalDateIso(s.starts_at))),
    [existingSlots],
  )

  const existingRanges = useMemo(
    () =>
      existingSlots.map((s) => ({
        start: new Date(s.starts_at).getTime(),
        end: new Date(s.ends_at).getTime(),
      })),
    [existingSlots],
  )

  // Ticking clock rather than a render-time Date.now(): the preview keeps
  // marking slots as "past" correctly even if the form is left open a while.
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])

  const timeRangeInvalid = Boolean(startTime && endTime && endTime <= startTime)
  const intervalInvalid = !Number.isFinite(intervalMinutes) || intervalMinutes < 1
  const capacityInvalid = !Number.isFinite(capacity) || capacity < 1
  const venueInvalid = !venue.trim()

  /** Every slot the current settings would produce, annotated with clashes. */
  const planned = useMemo<PlannedSlot[]>(() => {
    if (dates.length === 0 || !startTime || !endTime || timeRangeInvalid || intervalInvalid) return []

    const out: PlannedSlot[] = []
    for (const date of dates) {
      let times: ReturnType<typeof generateSlotTimes>
      try {
        times = generateSlotTimes({ date, startTime, endTime, intervalMinutes })
      } catch {
        continue
      }
      for (const t of times) {
        const start = new Date(t.starts_at).getTime()
        const end = new Date(t.ends_at).getTime()
        out.push({
          starts_at: t.starts_at,
          ends_at: t.ends_at,
          past: now > 0 && start <= now,
          conflict: existingRanges.some((r) => start < r.end && end > r.start),
        })
      }
    }
    return out.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  }, [dates, startTime, endTime, intervalMinutes, timeRangeInvalid, intervalInvalid, existingRanges, now])

  const pastCount = planned.filter((s) => s.past).length
  const conflictCount = planned.filter((s) => !s.past && s.conflict).length

  /** What actually gets written: never anything in the past, clashes optional. */
  const toCreate = useMemo(
    () => planned.filter((s) => !s.past && (!skipConflicts || !s.conflict)),
    [planned, skipConflicts],
  )

  const byDate = useMemo(() => {
    const groups = new Map<string, PlannedSlot[]>()
    for (const slot of planned) {
      const key = toLocalDateIso(slot.starts_at)
      const bucket = groups.get(key)
      if (bucket) bucket.push(slot)
      else groups.set(key, [slot])
    }
    return Array.from(groups.entries()).sort(([a], [b]) => (a < b ? -1 : 1))
  }, [planned])

  const slotsPerDay = dates.length > 0 ? Math.round(planned.length / dates.length) : 0
  const windowTooShort = dates.length > 0 && !timeRangeInvalid && !intervalInvalid && planned.length === 0

  function handleReview(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    setError(null)
    setCreatedCount(null)

    if (dates.length === 0 || timeRangeInvalid || intervalInvalid || capacityInvalid || venueInvalid) return
    if (windowTooShort) return
    if (toCreate.length === 0) {
      setError(
        conflictCount > 0 && skipConflicts
          ? 'Every slot in this range clashes with an existing one. Untick "skip" or change the times.'
          : 'These settings produce no slots to create.',
      )
      return
    }
    setShowConfirm(true)
  }

  async function handleConfirmCreate() {
    setError(null)
    setSubmitting(true)

    const rows = toCreate.map((t) => ({
      track,
      orientation,
      orientation_year: orientationYear,
      starts_at: t.starts_at,
      ends_at: t.ends_at,
      capacity,
      status: 'open' as const,
      created_by: profileId,
      venue: venue.trim(),
    }))

    const created = rows.length
    const { error: createError } = await createSlots(rows)
    setSubmitting(false)

    if (createError) {
      setError(createError.message)
      return
    }

    setCreatedCount(created)
    setShowConfirm(false)
    setDates([])
    setTouched(false)
    onCreated()
    setTimeout(() => setCreatedCount(null), 5000)
  }

  return (
    <div
      className="form-card"
      style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '26px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
    >
      <style>{`
        .bcf-split { display: grid; grid-template-columns: 300px 1fr; gap: 22px; align-items: start; }
        .bcf-times { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .bcf-meta { display: grid; grid-template-columns: 140px 1fr; gap: 12px; }
        @media (max-width: 900px) {
          .bcf-split { grid-template-columns: 1fr; }
        }
        @media (max-width: 560px) {
          .bcf-times, .bcf-meta { grid-template-columns: 1fr; }
        }
        .bcf-preset:hover { border-color: #2563EB !important; color: #2563EB !important; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#EFF4FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🗓️</div>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 2px', color: '#0F172A' }}>Add interview slots</h2>
          <p style={{ fontSize: '12.5px', color: '#64748B', margin: 0 }}>
            Pick the days, set one time window, and back-to-back slots are generated for every day at once.
          </p>
        </div>
      </div>

      {!showConfirm ? (
        <form onSubmit={handleReview}>
          {/* ── Step 1: dates ───────────────────────────────────────────── */}
          <div className="bcf-split">
            <div>
              <label style={labelStyle}>1 · Interview days</label>
              <MultiDatePicker value={dates} onChange={setDates} markedDates={datesWithSlots} />
              {touched && dates.length === 0 && fieldError('Pick at least one day.')}
            </div>

            <div>
              <label style={labelStyle}>Selected</label>
              {dates.length === 0 ? (
                <div style={{ border: '1px dashed #E2E8F0', borderRadius: '12px', padding: '18px', fontSize: '13px', color: '#94A3B8', background: '#FAFBFD' }}>
                  No days selected yet. Click dates in the calendar — an amber dot means that day already has slots.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {dates.map((d) => (
                    <span
                      key={d}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#EFF4FF', color: '#2563EB', padding: '5px 8px 5px 11px', borderRadius: '99px', fontSize: '12.5px', fontWeight: 700 }}
                    >
                      {formatDateHeading(d).replace(/, \d{4}$/, '')}
                      <button
                        type="button"
                        onClick={() => setDates((prev) => prev.filter((x) => x !== d))}
                        aria-label={`Remove ${d}`}
                        style={{ background: '#DBE6FF', border: 'none', color: '#2563EB', cursor: 'pointer', width: '16px', height: '16px', borderRadius: '99px', fontSize: '12px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* ── Step 2: time window ───────────────────────────────── */}
              <div style={sectionStyle}>
                <label style={labelStyle}>2 · Daily time window</label>
                <div className="bcf-times">
                  <div>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Starts</span>
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required style={inputStyle} />
                  </div>
                  <div>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Ends</span>
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required style={inputStyle} />
                  </div>
                  <div>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Slot length (min)</span>
                    <input
                      type="number"
                      min={1}
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                      required
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                  {DURATION_PRESETS.map((preset) => {
                    const active = intervalMinutes === preset
                    return (
                      <button
                        key={preset}
                        type="button"
                        className="bcf-preset"
                        onClick={() => setIntervalMinutes(preset)}
                        style={{
                          padding: '5px 12px',
                          borderRadius: '99px',
                          border: `1px solid ${active ? '#2563EB' : '#E2E8F0'}`,
                          background: active ? '#EFF4FF' : '#fff',
                          color: active ? '#2563EB' : '#64748B',
                          fontSize: '12.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all .12s',
                        }}
                      >
                        {preset} min
                      </button>
                    )
                  })}
                </div>

                {timeRangeInvalid && fieldError('The end time has to be after the start time.')}
                {!timeRangeInvalid && intervalInvalid && fieldError('Slot length must be at least 1 minute.')}
                {!timeRangeInvalid && !intervalInvalid && windowTooShort &&
                  fieldError('That window is shorter than one slot — widen it or shorten the slot length.')}
              </div>

              {/* ── Step 3: details ───────────────────────────────────── */}
              <div style={sectionStyle}>
                <label style={labelStyle}>3 · Slot details</label>
                <div className="bcf-meta">
                  <div>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Seats per slot</span>
                    <input
                      type="number"
                      min={1}
                      value={capacity}
                      onChange={(e) => setCapacity(Number(e.target.value))}
                      required
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>
                      Venue <span style={{ color: '#E11D48', fontWeight: 700 }}>*</span> <span style={{ color: '#94A3B8', fontWeight: 400 }}>— shown to applicants and emailed to them</span>
                    </span>
                    <input
                      type="text"
                      value={venue}
                      onChange={(e) => setVenue(e.target.value)}
                      placeholder="e.g. A1 #123"
                      required
                      style={inputStyle}
                    />
                    {touched && venueInvalid && fieldError('Venue is required.')}
                  </div>
                </div>
                {capacityInvalid && fieldError('Each slot needs at least one seat.')}
              </div>
            </div>
          </div>

          {/* ── Preview ─────────────────────────────────────────────────── */}
          {planned.length > 0 && (
            <div style={{ ...sectionStyle }}>
              <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '16px', border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <h3 style={{ fontSize: '13.5px', fontWeight: 700, margin: 0, color: '#0F172A' }}>
                    Preview — {toCreate.length} slot{toCreate.length === 1 ? '' : 's'} will be created
                  </h3>
                  <span style={{ fontSize: '12px', color: '#64748B' }}>
                    {slotsPerDay} per day × {dates.length} day{dates.length === 1 ? '' : 's'}
                  </span>
                </div>

                {(pastCount > 0 || conflictCount > 0) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '10px 0 12px' }}>
                    {pastCount > 0 && (
                      <div style={{ fontSize: '12.5px', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 10px' }}>
                        {pastCount} slot{pastCount === 1 ? '' : 's'} in this range {pastCount === 1 ? 'is' : 'are'} already in the past and will be skipped.
                      </div>
                    )}
                    {conflictCount > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={skipConflicts} onChange={(e) => setSkipConflicts(e.target.checked)} style={{ width: '14px', height: '14px', cursor: 'pointer' }} />
                        <span>
                          Skip {conflictCount} slot{conflictCount === 1 ? '' : 's'} that overlap{conflictCount === 1 ? 's' : ''} an existing slot
                        </span>
                      </label>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '260px', overflowY: 'auto' }}>
                  {byDate.map(([date, daySlots]) => (
                    <div key={date}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '5px' }}>
                        {formatDateHeading(date)}
                        <span style={{ color: '#94A3B8', fontWeight: 600 }}> · {daySlots.length} slot{daySlots.length === 1 ? '' : 's'}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {daySlots.map((slot) => {
                          const dropped = slot.past || (skipConflicts && slot.conflict)
                          const warn = slot.past || slot.conflict
                          return (
                            <span
                              key={slot.starts_at}
                              title={slot.past ? 'In the past — skipped' : slot.conflict ? 'Overlaps an existing slot' : undefined}
                              style={{
                                background: warn ? '#FFFBEB' : '#fff',
                                border: `1px solid ${warn ? '#FDE68A' : '#E2E8F0'}`,
                                borderRadius: '6px',
                                padding: '4px 8px',
                                fontSize: '11.5px',
                                color: warn ? '#92400E' : '#475569',
                                fontWeight: 600,
                                textDecoration: dropped ? 'line-through' : 'none',
                                opacity: dropped ? 0.7 : 1,
                              }}
                            >
                              {formatClock(slot.starts_at)}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
            <button
              type="submit"
              disabled={toCreate.length === 0}
              style={{
                padding: '10.5px 24px',
                borderRadius: '9px',
                background: toCreate.length === 0 ? '#CBD5E1' : '#2563EB',
                border: 'none',
                color: '#fff',
                fontWeight: 700,
                fontSize: '14px',
                cursor: toCreate.length === 0 ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              Review &amp; create{toCreate.length > 0 ? ` (${toCreate.length})` : ''}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '20px', border: '1px solid #E2E8F0' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', color: '#0F172A' }}>Confirm creation</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', color: '#475569' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px' }}>
                <span style={{ fontWeight: 600, color: '#334155' }}>Days</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {dates.map((d) => (
                    <span key={d} style={{ background: '#E2E8F0', padding: '2px 8px', borderRadius: '99px', fontSize: '12px', color: '#334155', fontWeight: 600 }}>
                      {formatDateHeading(d).replace(/, \d{4}$/, '')}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px' }}>
                <span style={{ fontWeight: 600, color: '#334155' }}>Window</span>
                <span>{startTime} – {endTime}, {intervalMinutes} min each</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px' }}>
                <span style={{ fontWeight: 600, color: '#334155' }}>Seats</span>
                <span>{capacity} per slot</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px' }}>
                <span style={{ fontWeight: 600, color: '#334155' }}>Venue</span>
                <span>{venue.trim()}</span>
              </div>

              {(pastCount > 0 || (skipConflicts && conflictCount > 0)) && (
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px' }}>
                  <span style={{ fontWeight: 600, color: '#334155' }}>Skipping</span>
                  <span style={{ color: '#92400E' }}>
                    {[
                      pastCount > 0 ? `${pastCount} in the past` : null,
                      skipConflicts && conflictCount > 0 ? `${conflictCount} overlapping` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px', marginTop: '4px', paddingTop: '12px', borderTop: '1px dashed #CBD5E1' }}>
                <span style={{ fontWeight: 700, color: '#0F172A' }}>Creating</span>
                <span style={{ fontWeight: 800, color: '#2563EB' }}>{toCreate.length} slots</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={submitting}
              style={{ padding: '10.5px 20px', borderRadius: '9px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: '14px', cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              Go back
            </button>
            <button
              type="button"
              onClick={handleConfirmCreate}
              disabled={submitting}
              style={{ padding: '10.5px 24px', borderRadius: '9px', background: '#2563EB', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? 'Creating…' : `Create ${toCreate.length} slots`}
            </button>
          </div>
        </div>
      )}

      {createdCount !== null && (
        <p style={{ marginTop: '16px', fontSize: '13px', color: '#166534', fontWeight: 600, padding: '12px', background: '#DCFCE7', borderRadius: '8px', border: '1px solid #BBF7D0' }}>
          ✓ Created {createdCount} slot{createdCount === 1 ? '' : 's'}. They&apos;re listed below and open for booking.
        </p>
      )}
      {error && (
        <p style={{ marginTop: '16px', fontSize: '13px', color: '#B91C1C', padding: '12px', background: '#FEE2E2', borderRadius: '8px', border: '1px solid #FECACA' }}>
          ⚠ {error}
        </p>
      )}
    </div>
  )
}
