'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getAvailableSlots, type Track } from '@/lib/bookings'
import { bookSlotAction } from '@/app/actions/bookingAction'
import { formatDateHeading, formatTimeRange, toLocalDateIso, type AvailableSlot } from '@/lib/booking-helpers'
import {
  DEFAULT_ORIENTATION,
  ORIENTATIONS,
  isOrientation,
  type Orientation,
} from '@/lib/orientation'

const TRACKS: { key: Track; title: string; icon: string; blurb: string }[] = [
  { key: 'facilitator', title: 'Facilitator', icon: '🎯', blurb: 'Guide new students through orientation week.' },
  { key: 'game_master', title: 'Game Master', icon: '🎮', blurb: 'Run the games, energy & icebreaker stations.' },
]

function isTrack(value: string | null): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

type Confirmation = {
  name: string
  studentId: string
  email: string
  track: Track
  slot: AvailableSlot
}

function getDayOfWeek(dateStr: string): string {
  if (!dateStr) return ''
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'long' })
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 13px',
  border: '1px solid #E2E8F0',
  borderRadius: '10px',
  fontSize: '15px',
  fontFamily: 'inherit',
  background: '#fff',
  color: '#0F172A',
  boxSizing: 'border-box',
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#334155',
  marginBottom: '6px',
  display: 'block',
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px',
  display: 'block',
}

function FieldError({ message }: { message: string }) {
  return <div style={{ fontSize: '12.5px', color: '#B91C1C', fontWeight: 600, marginTop: '5px' }}>{message}</div>
}

export function BookClient() {
  const searchParams = useSearchParams()
  const initTrack: Track = isTrack(searchParams.get('track')) ? (searchParams.get('track') as Track) : 'facilitator'
  const initOrientation: Orientation = isOrientation(searchParams.get('orientation'))
    ? (searchParams.get('orientation') as Orientation)
    : DEFAULT_ORIENTATION

  const [orientation, setOrientation] = useState<Orientation>(initOrientation)
  const [track, setTrack] = useState<Track>(initTrack)
  const [step, setStep] = useState(1)

  // Both tracks are loaded together so each tab can show a truthful count
  // before you click it.
  const [slotsByTrack, setSlotsByTrack] = useState<Record<Track, AvailableSlot[]>>({
    facilitator: [],
    game_master: [],
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [experiences, setExperiences] = useState('')
  const [links, setLinks] = useState('')
  const [filterDate, setFilterDate] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const slots = slotsByTrack[track]

  const [reloadToken, setReloadToken] = useState(0)
  const loadSlots = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    let active = true

    async function run() {
      const [fac, gm] = await Promise.all([
        getAvailableSlots('facilitator', orientation),
        getAvailableSlots('game_master', orientation),
      ])
      if (!active) return
      setSlotsByTrack({ facilitator: fac.data ?? [], game_master: gm.data ?? [] })
      setLoadError(fac.error?.message ?? gm.error?.message ?? null)
      setSelectedId(null)
      setLoading(false)
    }

    run()
    return () => {
      active = false
    }
  }, [orientation, reloadToken])

  const openCount = useCallback(
    (t: Track) => slotsByTrack[t].filter((s) => s.capacity - s.booked_count > 0).length,
    [slotsByTrack],
  )

  const availableDates = useMemo(
    () => Array.from(new Set(slots.map((s) => toLocalDateIso(s.starts_at)))).sort(),
    [slots],
  )

  const filteredSlots = useMemo(
    () => (filterDate ? slots.filter((s) => toLocalDateIso(s.starts_at) === filterDate) : slots),
    [slots, filterDate],
  )

  const selectedSlot = slots.find((s) => s.id === selectedId) ?? null

  const nameError = !name.trim() ? 'Tell us your full name.' : null
  const studentIdError = !studentId.trim() ? 'Your student ID is how you look this booking up later.' : null
  const emailError = !email.trim()
    ? 'We send your confirmation here.'
    : !looksLikeEmail(email)
      ? 'That doesn’t look like a valid email address.'
      : null
  const experiencesError = !experiences.trim() ? 'A sentence or two is enough.' : null
  const formInvalid = Boolean(nameError || studentIdError || emailError || experiencesError)

  async function confirmBooking() {
    if (!selectedSlot) return
    setShowErrors(true)
    setSubmitError(null)
    if (formInvalid) return

    setSubmitting(true)
    const { data, error } = await bookSlotAction(selectedSlot.id, {
      name: name.trim(),
      studentId: studentId.trim(),
      email: email.trim(),
      experiences: experiences.trim(),
      links: links.trim(),
    })
    setSubmitting(false)

    if (data) {
      setConfirmation({
        name: data.applicant_name,
        studentId: studentId.trim(),
        email: email.trim(),
        track,
        slot: selectedSlot,
      })
      setStep(3)
      return
    }
    setSubmitError(error ?? 'Something went wrong. Please try again.')
    // The slot may have filled while the form was open — refresh the list so
    // the applicant sees the real state instead of a stale "seats left".
    loadSlots()
  }

  function bookAnother() {
    setConfirmation(null)
    setName('')
    setStudentId('')
    setEmail('')
    setExperiences('')
    setLinks('')
    setFilterDate('')
    setShowErrors(false)
    setSubmitError(null)
    setStep(1)
    loadSlots()
  }

  return (
    <main className="scr" style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 16px 48px' }}>
      <style>{`
        .book-orientations { display: flex; gap: 10px; }
        .book-tracks { display: flex; gap: 10px; margin-bottom: 14px; }
        @media (max-width: 560px) {
          .book-orientations, .book-tracks { flex-direction: column; }
        }
      `}</style>

      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-.025em', margin: '0 0 4px' }}>Book an interview</h1>
        <p style={{ color: '#64748B', fontSize: '14px', margin: 0 }}>
          Choose your track, pick a time that works, and tell us a little about you.
        </p>
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {[1, 2, 3].map((n) => {
          const labels: Record<number, string> = { 1: 'Choose slot', 2: 'Your details', 3: 'Confirmed' }
          const done = step > n
          const active = step === n
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '26px', height: '26px', borderRadius: '99px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', fontWeight: 700, background: done ? '#16A34A' : active ? '#2563EB' : '#EEF2F7', color: done || active ? '#fff' : '#94A3B8' }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: active || done ? '#0F172A' : '#94A3B8' }}>{labels[n]}</span>
              {n < 3 && <span style={{ width: '26px', height: '2px', background: '#E2E8F0', borderRadius: '2px' }} />}
            </div>
          )
        })}
      </div>

      {/* ── Step 1: pick a slot ───────────────────────────────────────── */}
      {step === 1 && (
        <div className="scr">
          <div style={{ marginBottom: '14px' }}>
            <label style={sectionLabelStyle}>Select orientation</label>
            <div className="book-orientations">
              {ORIENTATIONS.map((o) => {
                const active = orientation === o.key
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => { setOrientation(o.key); setFilterDate('') }}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '15px 18px', borderRadius: '14px', cursor: 'pointer', textAlign: 'left', transition: 'all .15s', border: `1.5px solid ${active ? '#2563EB' : '#EAEEF4'}`, background: active ? '#EFF4FF' : '#fff' }}
                  >
                    <span style={{ fontSize: '20px' }}>{o.icon}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                      <span style={{ fontWeight: 700, fontSize: '15px' }}>{o.label}</span>
                      <span style={{ fontSize: '12.5px', color: '#64748B', fontWeight: 500 }}>Orientation</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="book-tracks">
            {TRACKS.map((t) => {
              const active = track === t.key
              const count = openCount(t.key)
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setTrack(t.key); setSelectedId(null); setFilterDate('') }}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '15px 18px', borderRadius: '14px', cursor: 'pointer', textAlign: 'left', transition: 'all .15s', border: `1.5px solid ${active ? '#2563EB' : '#EAEEF4'}`, background: active ? '#EFF4FF' : '#fff' }}
                >
                  <span style={{ fontSize: '20px' }}>{t.icon}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>{t.title}</span>
                    <span style={{ fontSize: '12.5px', color: '#64748B', fontWeight: 500 }}>
                      {loading ? 'Loading…' : count === 0 ? 'No slots open' : `${count} slot${count === 1 ? '' : 's'} open`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* Date filter */}
          {availableDates.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <label style={sectionLabelStyle}>Filter by date</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {[{ value: '', label: 'All dates' }, ...availableDates.map((d) => ({ value: d, label: formatDateHeading(d).replace(/, \d{4}$/, '') }))].map((option) => {
                  const active = filterDate === option.value
                  const hasOpen = option.value === ''
                    ? slots.some((s) => s.capacity - s.booked_count > 0)
                    : slots.some((s) => toLocalDateIso(s.starts_at) === option.value && s.capacity - s.booked_count > 0)
                  return (
                    <button
                      key={option.value || 'all'}
                      type="button"
                      onClick={() => { setFilterDate(option.value); setSelectedId(null) }}
                      style={{ padding: '8px 16px', borderRadius: '99px', border: `1.5px solid ${active ? '#2563EB' : '#EAEEF4'}`, background: active ? '#EFF4FF' : '#fff', color: active ? '#2563EB' : '#475569', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s ease', opacity: hasOpen ? 1 : 0.65, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      {option.label}
                      {!hasOpen && <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8' }}>(Full)</span>}
                    </button>
                  )
                })}
              </div>

              {filterDate && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px', background: '#F8FAFC', border: '1px solid #EAEEF4', borderRadius: '10px', padding: '6px 12px', width: 'fit-content' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>{getDayOfWeek(filterDate)}</span>
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#94A3B8' }} />
                  {slots.some((s) => toLocalDateIso(s.starts_at) === filterDate && s.capacity - s.booked_count > 0) ? (
                    <span style={{ fontSize: '13px', color: '#10B981', fontWeight: 600 }}>Open interviews available</span>
                  ) : (
                    <span style={{ fontSize: '13px', color: '#F97316', fontWeight: 600 }}>All interviews fully booked</span>
                  )}
                </div>
              )}
            </div>
          )}

          {loadError && (
            <div style={{ padding: '14px 16px', borderRadius: '12px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '13.5px', fontWeight: 600, marginBottom: '14px' }}>
              Couldn’t load slots: {loadError}
            </div>
          )}

          <div className="slots-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {loading ? (
              <div style={{ gridColumn: 'span 2', fontSize: '14px', color: '#64748B', padding: '20px' }}>Loading slots…</div>
            ) : filteredSlots.length === 0 ? (
              <div style={{ gridColumn: 'span 2', padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px', background: '#F8FAFC', borderRadius: '14px', border: '1px dashed #E2E8F0' }}>
                {slots.length === 0
                  ? 'No interview slots are open for this track yet. Check back soon.'
                  : 'No slots on that date. Try another date or clear the filter.'}
              </div>
            ) : (
              filteredSlots.map((sl) => {
                const seatsLeft = sl.capacity - sl.booked_count
                const status = seatsLeft <= 0 ? 'full' : seatsLeft <= 2 ? 'few' : 'open'
                const selected = sl.id === selectedId
                const full = status === 'full'
                return (
                  <button
                    key={sl.id}
                    type="button"
                    disabled={full}
                    onClick={() => setSelectedId(sl.id)}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      padding: '16px',
                      borderRadius: '14px',
                      cursor: full ? 'not-allowed' : 'pointer',
                      opacity: full ? 0.55 : 1,
                      background: selected ? '#EFF4FF' : '#fff',
                      border: `1.5px solid ${selected ? '#2563EB' : '#EAEEF4'}`,
                      boxShadow: selected ? '0 8px 22px -12px rgba(37,99,235,.5)' : 'none',
                      transition: 'border-color .12s, box-shadow .12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '3px' }}>
                          {formatDateHeading(toLocalDateIso(sl.starts_at))}
                        </div>
                        <div style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '-.01em', color: '#0F172A' }}>
                          {formatTimeRange(sl.starts_at, sl.ends_at)}
                        </div>
                        <div style={{ fontSize: '12.5px', color: '#64748B', marginTop: '4px', fontWeight: 600 }}>
                          📍 {sl.venue?.trim() || 'Venue TBA'}
                        </div>
                      </div>
                      {status === 'open' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: '#ECFDF3', color: '#15803D', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{seatsLeft} left</span>}
                      {status === 'few' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: '#FFF7ED', color: '#C2410C', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{seatsLeft} left</span>}
                      {status === 'full' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: '#F1F5F9', color: '#94A3B8', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>Full</span>}
                    </div>
                    {selected && (
                      <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: '#2563EB', fontSize: '13px', fontWeight: 700 }}>✓ Selected</div>
                    )}
                  </button>
                )
              })
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13.5px', color: selectedSlot ? '#334155' : '#94A3B8', fontWeight: selectedSlot ? 600 : 400 }}>
              {selectedSlot
                ? `${formatDateHeading(toLocalDateIso(selectedSlot.starts_at))} · ${formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at)}`
                : 'Select a slot to continue'}
            </span>
            <button
              type="button"
              disabled={!selectedSlot}
              onClick={() => setStep(2)}
              style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: selectedSlot ? '#2563EB' : '#CBD5E1', cursor: selectedSlot ? 'pointer' : 'not-allowed', boxShadow: selectedSlot ? '0 8px 18px -7px rgba(37,99,235,.5)' : 'none' }}
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: details ───────────────────────────────────────────── */}
      {step === 2 && selectedSlot && (
        <div className="scr book-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr .7fr', gap: '16px', alignItems: 'start' }}>
          <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '20px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 14px', letterSpacing: '-.01em' }}>Your details</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={fieldLabelStyle} htmlFor="bk-name">Full name</label>
                <input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aisha Rahman" style={fieldStyle} />
                {showErrors && nameError && <FieldError message={nameError} />}
              </div>
              <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={fieldLabelStyle} htmlFor="bk-student-id">Student ID</label>
                  <input id="bk-student-id" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="AC22XXXXX" style={fieldStyle} />
                  {showErrors && studentIdError && <FieldError message={studentIdError} />}
                </div>
                <div>
                  <label style={fieldLabelStyle} htmlFor="bk-email">Email</label>
                  <input id="bk-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@xmu.edu.my" style={fieldStyle} />
                  {showErrors && emailError && <FieldError message={emailError} />}
                </div>
              </div>
              <div>
                <label style={fieldLabelStyle} htmlFor="bk-experience">Relevant experience</label>
                <textarea
                  id="bk-experience"
                  value={experiences}
                  onChange={(e) => setExperiences(e.target.value)}
                  placeholder="Clubs, events, leadership, gaming, or anything you'd like us to know."
                  rows={4}
                  style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }}
                />
                {showErrors && experiencesError && <FieldError message={experiencesError} />}
              </div>
              <div>
                <label style={fieldLabelStyle} htmlFor="bk-links">
                  Relevant links <span style={{ color: '#94A3B8', fontWeight: 500 }}>(optional)</span>
                </label>
                <input id="bk-links" value={links} onChange={(e) => setLinks(e.target.value)} placeholder="e.g. Portfolio, GitHub, LinkedIn" style={fieldStyle} />
              </div>
            </div>

            {submitError && (
              <div style={{ marginTop: '14px', padding: '11px 14px', borderRadius: '10px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '13.5px', fontWeight: 600 }}>
                {submitError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', gap: '12px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setStep(1)} style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                ← Back
              </button>
              <button
                type="button"
                onClick={confirmBooking}
                disabled={submitting}
                style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: submitting ? '#CBD5E1' : '#16A34A', cursor: submitting ? 'not-allowed' : 'pointer', boxShadow: submitting ? 'none' : '0 8px 18px -7px rgba(22,163,74,.45)' }}
              >
                {submitting ? 'Booking…' : 'Confirm booking'}
              </button>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '16px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', position: 'sticky', top: '80px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: '10px' }}>Your slot</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: track === 'facilitator' ? '#EFF4FF' : '#F3F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>
                {track === 'facilitator' ? '🎯' : '🎮'}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>{track === 'facilitator' ? 'Facilitator' : 'Game Master'}</div>
                <div style={{ fontSize: '12.5px', color: '#64748B' }}>Interview track</div>
              </div>
            </div>
            <div style={{ borderTop: '1px dashed #E2E8F0', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'Date', value: formatDateHeading(toLocalDateIso(selectedSlot.starts_at)) },
                { label: 'Time', value: formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at) },
                { label: 'Venue', value: selectedSlot.venue?.trim() || 'TBA' },
              ].map((row) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#64748B' }}>{row.label}</span>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, textAlign: 'right' }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: confirmed ─────────────────────────────────────────── */}
      {step === 3 && confirmation && (
        <div className="scr" style={{ maxWidth: '560px', margin: '0 auto' }}>
          <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '20px', padding: '28px 24px', textAlign: 'center', boxShadow: '0 14px 40px -18px rgba(16,24,40,.2)' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '99px', background: '#ECFDF3', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', animation: 'pop .4s ease' }}>
              <span style={{ fontSize: '30px', color: '#16A34A' }}>✓</span>
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>You&apos;re booked!</h2>
            <p style={{ color: '#64748B', fontSize: '14px', margin: '0 0 18px', lineHeight: 1.55 }}>
              We&apos;ve emailed a confirmation to <strong style={{ color: '#334155' }}>{confirmation.email}</strong>. Bring your student ID on the day.
            </p>

            <div style={{ background: '#F8FAFC', border: '1px solid #EAEEF4', borderRadius: '14px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: '6px' }}>Student ID</div>
              <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: '24px', fontWeight: 600, letterSpacing: '.06em', color: '#2563EB' }}>{confirmation.studentId}</div>
              <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '6px' }}>Use this to look up your booking anytime at /my-booking.</div>
            </div>

            <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', textAlign: 'left', marginBottom: '18px' }}>
              {[
                { label: 'Track', value: confirmation.track === 'facilitator' ? 'Facilitator' : 'Game Master' },
                { label: 'Date', value: formatDateHeading(toLocalDateIso(confirmation.slot.starts_at)) },
                { label: 'Time', value: formatTimeRange(confirmation.slot.starts_at, confirmation.slot.ends_at) },
                { label: 'Venue', value: confirmation.slot.venue?.trim() || 'TBA' },
              ].map((row) => (
                <div key={row.label} style={{ background: '#F8FAFC', borderRadius: '12px', padding: '13px 15px' }}>
                  <div style={{ fontSize: '11.5px', color: '#94A3B8', fontWeight: 600, marginBottom: '2px' }}>{row.label}</div>
                  <div style={{ fontSize: '14px', fontWeight: 700 }}>{row.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/my-booking" style={{ padding: '12px 18px', borderRadius: '11px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
                View my booking
              </a>
              <button type="button" onClick={bookAnother} style={{ padding: '12px 18px', borderRadius: '11px', border: '1px solid #E2E8F0', background: '#fff', color: '#1E293B', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                Book another
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
