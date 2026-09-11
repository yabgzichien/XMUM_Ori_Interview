'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getAvailableSlots, reserveSlot, releaseHold, type Track } from '@/lib/bookings'
import { confirmReservationAction } from '@/app/actions/bookingAction'
import { formatCountdown, formatDateHeading, formatTimeRange, toLocalDateIso, type AvailableSlot } from '@/lib/booking-helpers'
import {
  DEFAULT_ORIENTATION,
  ORIENTATIONS,
  isOrientation,
  type Orientation,
} from '@/lib/orientation'

const HOLD_STORAGE_KEY = 'xmumori-book-hold'
const HOLD_TTL_MS = 10 * 60 * 1000

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
  border: '1px solid var(--border-input, #E2E8F0)',
  borderRadius: '10px',
  fontSize: '15px',
  fontFamily: 'inherit',
  background: 'var(--bg-input, #fff)',
  color: 'var(--text-primary, #0F172A)',
  boxSizing: 'border-box',
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-secondary, #334155)',
  marginBottom: '6px',
  display: 'block',
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--text-muted, #64748B)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px',
  display: 'block',
}

function FieldError({ message }: { message: string }) {
  return <div style={{ fontSize: '12.5px', color: 'var(--badge-danger-text, #B91C1C)', fontWeight: 600, marginTop: '5px' }}>{message}</div>
}

type BookClientProps = {
  initialSlotsByTrack?: Record<Track, AvailableSlot[]>
  initialOrientation?: Orientation
  initialTrack?: Track
}

export function BookClient({
  initialSlotsByTrack,
  initialOrientation,
  initialTrack,
}: BookClientProps = {}) {
  const searchParams = useSearchParams()
  const initTrack: Track = initialTrack ?? (isTrack(searchParams.get('track')) ? (searchParams.get('track') as Track) : 'facilitator')
  const initOrientation: Orientation = initialOrientation ?? (isOrientation(searchParams.get('orientation'))
    ? (searchParams.get('orientation') as Orientation)
    : DEFAULT_ORIENTATION)

  const [orientation, setOrientation] = useState<Orientation>(initOrientation)
  const [track, setTrack] = useState<Track>(initTrack)
  const [step, setStep] = useState(1)

  // Both tracks are loaded together so each tab can show a truthful count
  // before you click it.
  const [slotsByTrack, setSlotsByTrack] = useState<Record<Track, AvailableSlot[]>>(
    initialSlotsByTrack ?? {
      facilitator: [],
      game_master: [],
    }
  )
  const [loading, setLoading] = useState(!initialSlotsByTrack)
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

  const [holdToken, setHoldToken] = useState<string | null>(null)
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const [reserving, setReserving] = useState(false)
  const [reserveError, setReserveError] = useState<string | null>(null)
  const [holdDead, setHoldDead] = useState(false)

  const slots = slotsByTrack[track]

  const [reloadToken, setReloadToken] = useState(0)
  const loadSlots = useCallback(() => setReloadToken((n) => n + 1), [])

  const isInitialMount = useRef(true)

  useEffect(() => {
    const raw = sessionStorage.getItem(HOLD_STORAGE_KEY)
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as {
        token: string
        expiresAt: number
        slotId: string
        track: Track
        orientation: Orientation
      }
      if (saved.expiresAt <= Date.now()) {
        sessionStorage.removeItem(HOLD_STORAGE_KEY)
        return
      }
      if (saved.orientation !== orientation) {
        // Restoring would require switching orientation, which re-triggers the
        // slot-loading effect and races the stray-slot bounce (and the pre-
        // existing setSelectedId(null) once that refetch resolves) against
        // stale data for the old orientation. Simplest safe path: don't
        // restore across an orientation mismatch — release the hold server-
        // side so the seat doesn't sit orphaned until it naturally expires.
        releaseHold(saved.token)
        sessionStorage.removeItem(HOLD_STORAGE_KEY)
        return
      }
      setHoldToken(saved.token)
      setHoldExpiresAt(saved.expiresAt)
      setTrack(saved.track)
      setSelectedId(saved.slotId)
      setStep(2)
    } catch {
      sessionStorage.removeItem(HOLD_STORAGE_KEY)
    }
    // Runs once on mount only — restoring a hold shouldn't re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (step !== 2 || !holdExpiresAt) {
      setRemainingMs(null)
      return
    }
    const tick = () => setRemainingMs(Math.max(0, holdExpiresAt - Date.now()))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [step, holdExpiresAt])

  // If a restored hold's slot no longer exists in the freshly loaded list
  // (e.g. an admin deleted it while the hold was active), don't strand the
  // applicant on a blank step 2 — bounce back to the picker.
  useEffect(() => {
    if (step === 2 && !loading && !slots.find((s) => s.id === selectedId)) {
      if (holdToken) releaseHold(holdToken)
      clearHold()
      setStep(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, loading, slots, selectedId, holdToken])

  const holdExpired = remainingMs !== null && remainingMs <= 0
  const holdLocked = holdExpired || holdDead

  function clearHold() {
    setHoldToken(null)
    setHoldExpiresAt(null)
    setRemainingMs(null)
    setHoldDead(false)
    sessionStorage.removeItem(HOLD_STORAGE_KEY)
  }

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      if (initialSlotsByTrack && (initialSlotsByTrack.facilitator.length > 0 || initialSlotsByTrack.game_master.length > 0)) {
        return
      }
    }

    let active = true

    async function run() {
      setLoading(true)
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
    (t: Track) => slotsByTrack[t].filter((s) => s.seats_left > 0).length,
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
    if (!selectedSlot || !holdToken) return
    setShowErrors(true)
    setSubmitError(null)
    if (formInvalid) return

    setSubmitting(true)
    let result: Awaited<ReturnType<typeof confirmReservationAction>>
    try {
      result = await confirmReservationAction(holdToken, {
        name: name.trim(),
        studentId: studentId.trim(),
        email: email.trim(),
        experiences: experiences.trim(),
        links: links.trim(),
      })
    } catch {
      setSubmitting(false)
      setSubmitError('Something went wrong. Please try again.')
      return
    }
    const { data, error } = result
    setSubmitting(false)

    if (data) {
      clearHold()
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

    // A duplicate email/student ID is user-fixable — the hold is still alive
    // (confirm_reservation only releases it on success), so let them retry.
    if (error?.includes('already has an active booking')) {
      setSubmitError(error)
      return
    }

    // Only these specific messages mean the hold itself is genuinely dead
    // (expired, or the slot/window changed under it) — anything else (a
    // transient failure, an unexpected message) shouldn't permanently lock
    // a form whose hold might still be perfectly live.
    const holdIsDead =
      error != null &&
      (error.includes('hold expired') ||
        error.includes('slot is not open') ||
        error.includes('booking window is closed'))

    if (holdIsDead) {
      setHoldDead(true)
      setSubmitError(null)
      return
    }

    setSubmitError(error ?? 'Something went wrong. Please try again.')
  }

  async function goBackToStep1() {
    if (holdToken) {
      await releaseHold(holdToken)
    }
    clearHold()
    setStep(1)
    setSubmitError(null)
    loadSlots()
  }

  async function reserveAndContinue() {
    if (!selectedSlot) return
    setReserving(true)
    setReserveError(null)
    const { data, error } = await reserveSlot(selectedSlot.id, holdToken)
    setReserving(false)

    if (!data) {
      setReserveError(error?.message ?? 'That slot was just taken — pick another.')
      loadSlots()
      return
    }

    const expiresAt = Date.now() + HOLD_TTL_MS
    setHoldToken(data.token)
    setHoldExpiresAt(expiresAt)
    sessionStorage.setItem(
      HOLD_STORAGE_KEY,
      JSON.stringify({ token: data.token, expiresAt, slotId: selectedSlot.id, track, orientation }),
    )
    setStep(2)
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
    clearHold()
    setStep(1)
    loadSlots()
  }

  return (
    <main className="scr book-page-main" style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '24px 24px 48px', boxSizing: 'border-box' }}>
      <style>{`
        .book-orientations {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          width: 100%;
          box-sizing: border-box;
        }
        .book-tracks {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 14px;
          width: 100%;
          box-sizing: border-box;
        }
        .book-orientation-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-radius: 14px;
          cursor: pointer;
          text-align: left;
          transition: all .15s;
          box-sizing: border-box;
          width: 100%;
        }
        .book-track-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-radius: 14px;
          cursor: pointer;
          text-align: left;
          transition: all .15s;
          box-sizing: border-box;
          width: 100%;
        }
        .book-orientation-sub {
          display: block;
        }
        @media (max-width: 640px) {
          .book-orientations {
            gap: 6px;
            margin-bottom: 10px;
          }
          .book-tracks {
            gap: 6px;
            margin-bottom: 12px;
          }
          .book-orientation-btn {
            padding: 8px 4px !important;
            gap: 6px !important;
            border-radius: 10px !important;
            justify-content: center !important;
            align-items: center !important;
            text-align: center !important;
          }
          .book-orientation-icon {
            font-size: 16px !important;
          }
          .book-orientation-title {
            font-size: 13px !important;
            white-space: nowrap !important;
          }
          .book-orientation-sub {
            display: none !important;
          }
          .book-track-btn {
            padding: 8px 10px !important;
            gap: 8px !important;
            border-radius: 10px !important;
            align-items: center !important;
          }
          .book-track-icon {
            font-size: 18px !important;
          }
          .book-track-title {
            font-size: 13px !important;
            white-space: nowrap !important;
          }
          .book-track-sub {
            font-size: 11px !important;
            white-space: nowrap !important;
          }
        }
        @media (max-width: 380px) {
          .book-orientation-btn {
            padding: 8px 2px !important;
            gap: 4px !important;
          }
          .book-orientation-title {
            font-size: 12px !important;
          }
          .book-track-btn {
            padding: 7px 6px !important;
            gap: 6px !important;
          }
          .book-track-title {
            font-size: 12.5px !important;
          }
          .book-track-sub {
            font-size: 10.5px !important;
          }
        }
      `}</style>

      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-.025em', margin: '0 0 4px', color: 'var(--text-primary, #0F172A)' }}>Book an interview</h1>
        <p style={{ color: 'var(--text-muted, #64748B)', fontSize: '14px', margin: 0 }}>
          Please fill in your details in 10 minutes. The slots will be open to others after the timer ends
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
              <div style={{ width: '26px', height: '26px', borderRadius: '99px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', fontWeight: 700, background: done ? '#16A34A' : active ? '#2563EB' : 'var(--bg-card-subtle, #EEF2F7)', color: done || active ? '#fff' : 'var(--text-muted, #94A3B8)', flexShrink: 0 }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: active || done ? 'var(--text-primary, #0F172A)' : 'var(--text-muted, #94A3B8)', whiteSpace: 'nowrap' }}>{labels[n]}</span>
              {n < 3 && <span className="stepper-divider" style={{ width: '26px', height: '2px', background: 'var(--border-input, #E2E8F0)', borderRadius: '2px' }} />}
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
                    className="book-orientation-btn"
                    style={{
                      border: `1.5px solid ${active ? 'var(--btn-active-border, #2563EB)' : 'var(--border-card, #EAEEF4)'}`,
                      background: active ? 'var(--btn-active-bg, #EFF4FF)' : 'var(--bg-card, #fff)',
                    }}
                  >
                    <span className="book-orientation-icon" style={{ fontSize: '20px', flexShrink: 0 }}>{o.icon}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                      <span className="book-orientation-title" style={{ fontWeight: 700, fontSize: '15px', color: active ? 'var(--btn-active-text, #2563EB)' : 'var(--text-primary, #0F172A)' }}>{o.label}</span>
                      <span className="book-orientation-sub" style={{ fontSize: '12.5px', color: active ? 'var(--btn-active-subtext, #3B82F6)' : 'var(--text-muted, #64748B)', fontWeight: 500 }}>Orientation</span>
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
                  className="book-track-btn"
                  style={{
                    border: `1.5px solid ${active ? 'var(--btn-active-border, #2563EB)' : 'var(--border-card, #EAEEF4)'}`,
                    background: active ? 'var(--btn-active-bg, #EFF4FF)' : 'var(--bg-card, #fff)',
                  }}
                >
                  <span className="book-track-icon" style={{ fontSize: '20px', flexShrink: 0 }}>{t.icon}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
                    <span className="book-track-title" style={{ fontWeight: 700, fontSize: '15px', color: active ? 'var(--btn-active-text, #2563EB)' : 'var(--text-primary, #0F172A)' }}>{t.title}</span>
                    <span className="book-track-sub" style={{ fontSize: '12.5px', color: active ? 'var(--btn-active-subtext, #3B82F6)' : 'var(--text-muted, #64748B)', fontWeight: 500 }}>
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
                    ? slots.some((s) => s.seats_left > 0)
                    : slots.some((s) => toLocalDateIso(s.starts_at) === option.value && s.seats_left > 0)
                  return (
                    <button
                      key={option.value || 'all'}
                      type="button"
                      onClick={() => { setFilterDate(option.value); setSelectedId(null) }}
                      style={{ padding: '8px 16px', borderRadius: '99px', border: `1.5px solid ${active ? 'var(--btn-active-border, #2563EB)' : 'var(--border-card, #EAEEF4)'}`, background: active ? 'var(--btn-active-bg, #EFF4FF)' : 'var(--bg-card, #fff)', color: active ? 'var(--btn-active-text, #2563EB)' : 'var(--text-secondary, #475569)', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s ease', opacity: hasOpen ? 1 : 0.65, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      {option.label}
                      {!hasOpen && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted, #94A3B8)' }}>(Full)</span>}
                    </button>
                  )
                })}
              </div>

              {filterDate && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px', background: 'var(--bg-card-subtle, #F8FAFC)', border: '1px solid var(--border-card, #EAEEF4)', borderRadius: '10px', padding: '6px 12px', width: 'fit-content' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>{getDayOfWeek(filterDate)}</span>
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--text-muted, #94A3B8)' }} />
                  {slots.some((s) => toLocalDateIso(s.starts_at) === filterDate && s.seats_left > 0) ? (
                    <span style={{ fontSize: '13px', color: 'var(--badge-success-text, #10B981)', fontWeight: 600 }}>Open interviews available</span>
                  ) : (
                    <span style={{ fontSize: '13px', color: 'var(--badge-warning-text, #F97316)', fontWeight: 600 }}>All interviews fully booked</span>
                  )}
                </div>
              )}
            </div>
          )}

          {loadError && (
            <div style={{ padding: '14px 16px', borderRadius: '12px', background: 'var(--badge-danger-bg, #FEF2F2)', border: '1px solid var(--badge-danger-border, #FECACA)', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '13.5px', fontWeight: 600, marginBottom: '14px' }}>
              Couldn’t load slots: {loadError}
            </div>
          )}

          <div className="slots-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
            {loading ? (
              <div style={{ gridColumn: '1 / -1', fontSize: '14px', color: 'var(--text-muted, #64748B)', padding: '20px' }}>Loading slots…</div>
            ) : filteredSlots.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted, #64748B)', fontSize: '14px', background: 'var(--bg-card-subtle, #F8FAFC)', borderRadius: '14px', border: '1px dashed var(--border-input, #E2E8F0)' }}>
                {slots.length === 0
                  ? 'No interview slots are open for this track yet. Check back soon.'
                  : 'No slots on that date. Try another date or clear the filter.'}
              </div>
            ) : (
              filteredSlots.map((sl) => {
                const seatsLeft = sl.seats_left
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
                      background: selected ? 'var(--btn-active-bg, #EFF4FF)' : 'var(--bg-card, #fff)',
                      border: `1.5px solid ${selected ? 'var(--btn-active-border, #2563EB)' : 'var(--border-card, #EAEEF4)'}`,
                      boxShadow: selected ? '0 8px 22px -12px rgba(37,99,235,.5)' : 'none',
                      transition: 'border-color .12s, box-shadow .12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-muted, #94A3B8)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '3px' }}>
                          {formatDateHeading(toLocalDateIso(sl.starts_at))}
                        </div>
                        <div style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '-.01em', color: 'var(--text-primary, #0F172A)' }}>
                          {formatTimeRange(sl.starts_at, sl.ends_at)}
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--text-muted, #64748B)', marginTop: '4px', fontWeight: 600 }}>
                          📍 {sl.venue?.trim() || 'Venue TBA'}
                        </div>
                      </div>
                      {status === 'open' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: 'var(--badge-success-bg, #ECFDF3)', color: 'var(--badge-success-text, #15803D)', border: '1px solid var(--badge-success-border, #BBF7D0)', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{seatsLeft} left</span>}
                      {status === 'few' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: 'var(--badge-warning-bg, #FFF7ED)', color: 'var(--badge-warning-text, #C2410C)', border: '1px solid var(--badge-warning-border, #FDE68A)', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{seatsLeft} left</span>}
                      {status === 'full' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: 'var(--badge-neutral-bg, #F1F5F9)', color: 'var(--badge-neutral-text, #94A3B8)', border: '1px solid var(--badge-neutral-border, #E2E8F0)', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>Full</span>}
                    </div>
                    {selected && (
                      <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-text, #2563EB)', fontSize: '13px', fontWeight: 700 }}>✓ Selected</div>
                    )}
                  </button>
                )
              })
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13.5px', color: selectedSlot ? 'var(--text-secondary, #334155)' : 'var(--text-muted, #94A3B8)', fontWeight: selectedSlot ? 600 : 400 }}>
              {selectedSlot
                ? `${formatDateHeading(toLocalDateIso(selectedSlot.starts_at))} · ${formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at)}`
                : 'Select a slot to continue'}
            </span>
            <button
              type="button"
              disabled={!selectedSlot || reserving}
              onClick={reserveAndContinue}
              style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: selectedSlot && !reserving ? 'var(--accent-primary, #2563EB)' : 'var(--btn-neutral-bg, #CBD5E1)', cursor: selectedSlot && !reserving ? 'pointer' : 'not-allowed', boxShadow: selectedSlot && !reserving ? '0 8px 18px -7px rgba(37,99,235,.5)' : 'none' }}
            >
              {reserving ? 'Holding your seat…' : 'Continue →'}
            </button>
          </div>

          {reserveError && (
            <div style={{ marginTop: '12px', padding: '11px 14px', borderRadius: '10px', background: 'var(--badge-danger-bg, #FEF2F2)', border: '1px solid var(--badge-danger-border, #FECACA)', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '13.5px', fontWeight: 600 }}>
              {reserveError}
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: details ───────────────────────────────────────────── */}
      {step === 2 && selectedSlot && (
        <div className="scr book-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr .7fr', gap: '16px', alignItems: 'start' }}>
          <div style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #EAEEF4)', borderRadius: '18px', padding: '20px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 14px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, letterSpacing: '-.01em', color: 'var(--text-primary, #0F172A)' }}>Your details</h2>
              {!holdLocked && remainingMs !== null && (
                <span style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: remainingMs < 30_000 ? 'var(--badge-danger-text, #B91C1C)' : 'var(--btn-accent-text, #2563EB)',
                  background: remainingMs < 30_000 ? 'var(--badge-danger-bg, #FEF2F2)' : 'var(--btn-accent-bg, #EFF4FF)',
                  border: `1px solid ${remainingMs < 30_000 ? 'var(--badge-danger-border, #FECACA)' : 'var(--btn-accent-border, #DBE6FF)'}`,
                  padding: '5px 10px',
                  borderRadius: '99px'
                }}>
                  Timer · {formatCountdown(remainingMs)}
                </span>
              )}
            </div>

            {holdLocked ? (
              <div>
                <div style={{ marginBottom: '16px', padding: '11px 14px', borderRadius: '10px', background: 'var(--badge-danger-bg, #FEF2F2)', border: '1px solid var(--badge-danger-border, #FECACA)', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '13.5px', fontWeight: 600 }}>
                  Time Exceeded
                </div>
                <button type="button" onClick={goBackToStep1} style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-secondary, #475569)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                  Choose another slot
                </button>
              </div>
            ) : (
              <>
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
                      Relevant links <span style={{ color: 'var(--text-muted, #94A3B8)', fontWeight: 500 }}>(optional)</span>
                    </label>
                    <input id="bk-links" value={links} onChange={(e) => setLinks(e.target.value)} placeholder="e.g. Portfolio, GitHub, LinkedIn" style={fieldStyle} />
                  </div>
                </div>

                {submitError && (
                  <div style={{ marginTop: '14px', padding: '11px 14px', borderRadius: '10px', background: 'var(--badge-danger-bg, #FEF2F2)', border: '1px solid var(--badge-danger-border, #FECACA)', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '13.5px', fontWeight: 600 }}>
                    {submitError}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', gap: '12px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={goBackToStep1} style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-secondary, #475569)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={confirmBooking}
                    disabled={submitting}
                    style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: submitting ? 'var(--btn-neutral-bg, #CBD5E1)' : 'var(--accent-primary, #2563EB)', cursor: submitting ? 'not-allowed' : 'pointer', boxShadow: submitting ? 'none' : '0 8px 18px -7px rgba(37,99,235,.45)' }}
                  >
                    {submitting ? 'Booking…' : 'Confirm booking'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #EAEEF4)', borderRadius: '18px', padding: '16px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', position: 'sticky', top: '80px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-muted, #94A3B8)', marginBottom: '10px' }}>Your slot</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: track === 'facilitator' ? 'var(--badge-facilitator-bg, #EFF4FF)' : 'var(--badge-gm-bg, #F3F0FF)', border: `1px solid ${track === 'facilitator' ? 'var(--badge-facilitator-border, #DBE6FF)' : 'var(--badge-gm-border, #DDD6FE)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>
                {track === 'facilitator' ? '🎯' : '🎮'}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary, #0F172A)' }}>{track === 'facilitator' ? 'Facilitator' : 'Game Master'}</div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted, #64748B)' }}>Interview track</div>
              </div>
            </div>
            <div style={{ borderTop: '1px dashed var(--border-input, #E2E8F0)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'Date', value: formatDateHeading(toLocalDateIso(selectedSlot.starts_at)) },
                { label: 'Time', value: formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at) },
                { label: 'Venue', value: selectedSlot.venue?.trim() || 'TBA' },
              ].map((row) => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted, #64748B)' }}>{row.label}</span>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, textAlign: 'right', color: 'var(--text-primary, #0F172A)' }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: confirmed ─────────────────────────────────────────── */}
      {step === 3 && confirmation && (
        <div className="scr" style={{ maxWidth: '560px', margin: '0 auto' }}>
          <div style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #EAEEF4)', borderRadius: '20px', padding: '28px 24px', textAlign: 'center', boxShadow: '0 14px 40px -18px rgba(16,24,40,.2)' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '99px', background: 'var(--badge-success-bg, #ECFDF3)', border: '1px solid var(--badge-success-border, #BBF7D0)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', animation: 'pop .4s ease' }}>
              <span style={{ fontSize: '30px', color: 'var(--badge-success-text, #16A34A)' }}>✓</span>
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px', color: 'var(--text-primary, #0F172A)' }}>You&apos;re booked!</h2>
            <p style={{ color: 'var(--text-muted, #64748B)', fontSize: '14px', margin: '0 0 18px', lineHeight: 1.55 }}>
              We&apos;ve emailed a confirmation to <strong style={{ color: 'var(--text-primary, #334155)' }}>{confirmation.email}</strong>. Bring your student ID on the day.
            </p>

            <div style={{ background: 'var(--bg-card-subtle, #F8FAFC)', border: '1px solid var(--border-card, #EAEEF4)', borderRadius: '14px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-muted, #94A3B8)', marginBottom: '6px' }}>Student ID</div>
              <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: '24px', fontWeight: 600, letterSpacing: '.06em', color: 'var(--accent-text, #2563EB)' }}>{confirmation.studentId}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #94A3B8)', marginTop: '6px' }}>Use this to look up your booking anytime at /my-booking.</div>
            </div>

            <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', textAlign: 'left', marginBottom: '18px' }}>
              {[
                { label: 'Track', value: confirmation.track === 'facilitator' ? 'Facilitator' : 'Game Master' },
                { label: 'Date', value: formatDateHeading(toLocalDateIso(confirmation.slot.starts_at)) },
                { label: 'Time', value: formatTimeRange(confirmation.slot.starts_at, confirmation.slot.ends_at) },
                { label: 'Venue', value: confirmation.slot.venue?.trim() || 'TBA' },
              ].map((row) => (
                <div key={row.label} style={{ background: 'var(--bg-card-subtle, #F8FAFC)', borderRadius: '12px', padding: '13px 15px' }}>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted, #94A3B8)', fontWeight: 600, marginBottom: '2px' }}>{row.label}</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>{row.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/my-booking" style={{ padding: '12px 18px', borderRadius: '11px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
                View my booking
              </a>
              <button type="button" onClick={bookAnother} style={{ padding: '12px 18px', borderRadius: '11px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-secondary, #1E293B)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                Book another
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
