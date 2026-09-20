'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getAvailableSlots, reserveSlot, releaseHold, type Track } from '@/lib/bookings'
import { confirmReservationAction } from '@/app/actions/bookingAction'
import { formatCountdown, formatDateHeading, formatTimeRange, toLocalDateIso, type AvailableSlot } from '@/lib/booking-helpers'
import {
  DEFAULT_ORIENTATION,
  Orientation,
  isOrientation,
} from '@/lib/orientation'

const HOLD_STORAGE_KEY = 'xmumori-book-hold'
const HOLD_TTL_MS = 10 * 60 * 1000

const TRACKS: { key: Track; title: string; icon: string }[] = [
  { key: 'facilitator', title: 'Facilitator', icon: '🎯' },
  { key: 'game_master', title: 'Game Master', icon: '🎮' },
]

function isTrack(value: string | null): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function isSchoolEmail(value: string): boolean {
  return /^[^\s@]+@xmu\.edu\.my$/i.test(value.trim())
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
  const [contactNumber, setContactNumber] = useState('')
  const [filterDate, setFilterDate] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const [holdToken, setHoldToken] = useState<string | null>(null)
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const [reserving, setReserving] = useState(false)
  const [reserveError, setReserveError] = useState<string | null>(null)
  const [holdDead, setHoldDead] = useState(false)

  const holdTokenRef = useRef<string | null>(null)
  const stepRef = useRef(step)
  useEffect(() => {
    stepRef.current = step
  }, [step])

  const slots = slotsByTrack[track]

  const [reloadToken, setReloadToken] = useState(0)
  const loadSlots = useCallback(() => setReloadToken((n) => n + 1), [])

  const isInitialMount = useRef(true)

  useEffect(() => {
    const raw = sessionStorage.getItem(HOLD_STORAGE_KEY)
    if (!raw) {
      if (typeof window !== 'undefined' && !window.history.state?.bookStep) {
        window.history.replaceState({ bookStep: 1 }, '')
      }
      return
    }
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
        if (typeof window !== 'undefined' && !window.history.state?.bookStep) {
          window.history.replaceState({ bookStep: 1 }, '')
        }
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
        if (typeof window !== 'undefined' && !window.history.state?.bookStep) {
          window.history.replaceState({ bookStep: 1 }, '')
        }
        return
      }
      holdTokenRef.current = saved.token
      setHoldToken(saved.token)
      setHoldExpiresAt(saved.expiresAt)
      setTrack(saved.track)
      setSelectedId(saved.slotId)
      setStep(3)
      if (typeof window !== 'undefined') {
        window.history.replaceState({ bookStep: 3 }, '')
      }
    } catch {
      sessionStorage.removeItem(HOLD_STORAGE_KEY)
      if (typeof window !== 'undefined' && !window.history.state?.bookStep) {
        window.history.replaceState({ bookStep: 1 }, '')
      }
    }
    // Runs once on mount only — restoring a hold shouldn't re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handlePopState = async () => {
      // If the user was on Step 3 (Your details) and navigated back:
      if (stepRef.current === 3) {
        const token = holdTokenRef.current
        if (token) {
          await releaseHold(token)
        }
        clearHold()
        setStep(2)
        setSubmitError(null)
        loadSlots()
      } else if (stepRef.current === 2) {
        // If the user was on Step 2 (Choose slot) and navigated back:
        setStep(1)
        setSelectedId(null)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [loadSlots])

  useEffect(() => {
    if (step !== 3 || !holdExpiresAt) {
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
  // applicant on a blank step 3 — bounce back to the picker.
  useEffect(() => {
    if (
      step === 3 &&
      !loading &&
      selectedId &&
      !slotsByTrack.facilitator.some((s) => s.id === selectedId) &&
      !slotsByTrack.game_master.some((s) => s.id === selectedId)
    ) {
      const token = holdTokenRef.current || holdToken
      if (token) releaseHold(token)
      clearHold()
      setStep(2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, loading, slotsByTrack, selectedId, holdToken])

  const holdExpired = remainingMs !== null && remainingMs <= 0
  const holdLocked = holdExpired || holdDead

  function clearHold() {
    holdTokenRef.current = null
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
      if (stepRef.current === 1) {
        setSelectedId(null)
      }
      setLoading(false)
    }

    run()
    return () => {
      active = false
    }
  }, [orientation, reloadToken])


  const availableDates = useMemo(
    () => Array.from(new Set(slots.map((s) => toLocalDateIso(s.starts_at)))).sort(),
    [slots],
  )

  useEffect(() => {
    if (availableDates.length > 0 && (!filterDate || !availableDates.includes(filterDate))) {
      setFilterDate(availableDates[0])
    }
  }, [availableDates, filterDate])

  const filteredSlots = useMemo(
    () => (filterDate ? slots.filter((s) => toLocalDateIso(s.starts_at) === filterDate) : slots),
    [slots, filterDate],
  )

  const openSlots = useMemo(() => filteredSlots.filter((s) => s.seats_left > 0), [filteredSlots])
  const fullSlots = useMemo(() => filteredSlots.filter((s) => s.seats_left <= 0), [filteredSlots])

  const selectedSlot = slots.find((s) => s.id === selectedId) ?? null

  const nameError = !name.trim() ? 'Tell us your full name.' : null
  const studentIdError = !studentId.trim() ? 'Your student ID is how you look this booking up later.' : null
  const emailTrimmed = email.trim()
  const emailParts = emailTrimmed.split('@')
  const domainPart = emailParts.length === 2 ? emailParts[1].toLowerCase() : ''
  const isTypingSchoolEmail = domainPart.length > 0 && 'xmu.edu.my'.startsWith(domainPart)

  const emailError = !emailTrimmed
    ? 'Please enter your school email.'
    : !looksLikeEmail(emailTrimmed)
      ? 'That doesn’t look like a valid email address.'
      : !isSchoolEmail(emailTrimmed)
        ? 'Only @xmu.edu.my email is accepted. Please use your school email.'
        : null

  const shouldNudgeEmail = Boolean(
    emailTrimmed &&
    !isSchoolEmail(emailTrimmed) &&
    ((looksLikeEmail(emailTrimmed) && !isTypingSchoolEmail) || (emailTrimmed.includes('@') && !isTypingSchoolEmail && domainPart.length > 0))
  )
  const showEmailError = Boolean((showErrors || shouldNudgeEmail || (emailTouched && emailTrimmed)) && emailError)
  const contactError = !contactNumber.trim() ? 'Please provide a contact number.' : null
  const formInvalid = Boolean(nameError || studentIdError || emailError || contactError)

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
        contactNumber: contactNumber.trim(),
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
      if (typeof window !== 'undefined') {
        window.history.replaceState({ bookStep: 4 }, '')
      }
      setStep(4)
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

  function proceedToStep2() {
    if (typeof window !== 'undefined') {
      window.history.pushState({ bookStep: 2 }, '')
    }
    setStep(2)
  }

  function goBackToStep1() {
    if (typeof window !== 'undefined' && window.history.state?.bookStep === 2) {
      window.history.back()
      return
    }
    setStep(1)
    setSelectedId(null)
  }

  async function goBackToStep2() {
    if (typeof window !== 'undefined' && window.history.state?.bookStep === 3) {
      window.history.back()
      return
    }
    const token = holdTokenRef.current || holdToken
    if (token) {
      await releaseHold(token)
    }
    clearHold()
    setStep(2)
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
    holdTokenRef.current = data.token
    setHoldToken(data.token)
    setHoldExpiresAt(expiresAt)
    sessionStorage.setItem(
      HOLD_STORAGE_KEY,
      JSON.stringify({ token: data.token, expiresAt, slotId: selectedSlot.id, track, orientation }),
    )
    if (typeof window !== 'undefined') {
      window.history.pushState({ bookStep: 3 }, '')
    }
    setStep(3)
  }

  function renderSlotCard(sl: AvailableSlot) {
    const seatsLeft = sl.seats_left
    const status = seatsLeft <= 0 ? 'full' : seatsLeft <= 2 ? 'few' : 'open'
    const selected = sl.id === selectedId
    const full = status === 'full'
    const dateHeading = formatDateHeading(toLocalDateIso(sl.starts_at))
    const [cardDay, ...cardRest] = dateHeading.split(',')
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
              <span style={{ fontSize: '14px', fontWeight: 800, color: selected ? 'var(--btn-active-text, #2563EB)' : 'var(--text-primary, #0F172A)' }}>
                {cardDay}
              </span>
              <span>,{cardRest.join(',')}</span>
            </div>
            <div style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '-.01em', color: 'var(--text-primary, #0F172A)' }}>
              {formatTimeRange(sl.starts_at, sl.ends_at)}
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
            padding: 10px 14px !important;
            gap: 8px !important;
            border-radius: 10px !important;
            align-items: center !important;
          }
          .book-track-icon {
            font-size: 20px !important;
          }
          .book-track-title {
            font-size: 14px !important;
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
            padding: 8px 10px !important;
            gap: 6px !important;
          }
          .book-track-title {
            font-size: 13px !important;
          }
        }
      `}</style>

      <div style={{ marginBottom: '16px' }}>
        <h1 className="font-title" style={{ fontSize: '32px', fontWeight: 700, letterSpacing: '-.015em', margin: '0 0 4px', color: 'var(--text-primary, #0F172A)' }}>Book an Interview</h1>
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '22px', flexWrap: 'wrap' }}>
        {[1, 2, 3, 4].map((n) => {
          const labels: Record<number, string> = { 1: 'Choose position', 2: 'Choose slot', 3: 'Your details', 4: 'Confirmed' }
          const done = step > n
          const active = step === n
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '26px', height: '26px', borderRadius: '99px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', fontWeight: 700, background: done ? '#16A34A' : active ? '#2563EB' : 'var(--bg-card-subtle, #EEF2F7)', color: done || active ? '#fff' : 'var(--text-muted, #94A3B8)', flexShrink: 0 }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: active || done ? 'var(--text-primary, #0F172A)' : 'var(--text-muted, #94A3B8)', whiteSpace: 'nowrap' }}>{labels[n]}</span>
              {n < 4 && <span className="stepper-divider" style={{ width: '26px', height: '2px', background: 'var(--border-input, #E2E8F0)', borderRadius: '2px' }} />}
            </div>
          )
        })}
      </div>

      {/* ── Step 1: choose position ───────────────────────────────────── */}
      {step === 1 && (
        <div className="scr">
          <div style={{ marginBottom: '22px' }}>
            <h2 className="font-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.015em', color: 'var(--text-primary, #0F172A)' }}>
              Select your desired position
            </h2>
            <p className="font-subtitle" style={{ fontSize: '16px', color: 'var(--text-secondary, #475569)', margin: 0 }}>
              Choose whether you are applying as an Orientation Facilitator or a Game Master.
            </p>
          </div>

          <div className="book-tracks" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            {TRACKS.map((t) => {
              const active = track === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTrack(t.key)
                    setSelectedId(null)
                    setFilterDate('')
                  }}
                  className="book-track-btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '18px 20px',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all .15s ease',
                    border: `2px solid ${active ? 'var(--btn-active-border, #2563EB)' : 'var(--border-card, #EAEEF4)'}`,
                    background: active ? 'var(--btn-active-bg, #EFF4FF)' : 'var(--bg-card, #fff)',
                    boxShadow: active ? '0 10px 25px -8px rgba(37,99,235,.25)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="book-track-icon" style={{ fontSize: '26px', lineHeight: 1 }}>{t.icon}</span>
                    <span className="book-track-title" style={{ fontWeight: 800, fontSize: '18px', color: active ? 'var(--btn-active-text, #2563EB)' : 'var(--text-primary, #0F172A)' }}>
                      {t.title}
                    </span>
                  </div>
                  <div style={{ width: '22px', height: '22px', borderRadius: '50%', border: `2px solid ${active ? '#2563EB' : 'var(--border-input, #CBD5E1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? '#2563EB' : 'transparent', flexShrink: 0 }}>
                    {active && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} />}
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
            <button
              type="button"
              onClick={proceedToStep2}
              style={{
                padding: '14px 28px',
                borderRadius: '12px',
                border: 'none',
                color: '#fff',
                fontWeight: 700,
                fontSize: '15px',
                background: 'linear-gradient(100deg, rgba(0, 255, 255, 0.74), #a855f7, #FE06AB)',
                cursor: 'pointer',
                boxShadow: '0 8px 20px -6px rgba(37,99,235,.5)',
              }}
            >
              Continue to Select Slot →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: pick a slot ───────────────────────────────────────── */}
      {step === 2 && (
        <div className="scr">
          <div style={{ marginBottom: '18px' }}>
            <h2 className="font-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 6px', letterSpacing: '-.015em', color: 'var(--text-primary, #0F172A)' }}>
              Select an interview slot
            </h2>
            <p className="font-subtitle" style={{ fontSize: '16px', color: 'var(--text-secondary, #475569)', margin: 0 }}>
              Slots are available on a first-come, first-served basis.
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted, #64748B)' }}>Position:</span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '8px',
                background: track === 'game_master' ? 'var(--badge-gm-bg, #F3F0FF)' : 'var(--badge-facilitator-bg, #EFF4FF)',
                color: track === 'game_master' ? 'var(--badge-gm-text, #7C3AED)' : 'var(--badge-facilitator-text, #2563EB)',
                border: `1px solid ${track === 'game_master' ? 'var(--badge-gm-border, #DDD6FE)' : 'var(--badge-facilitator-border, #DBE6FF)'}`,
                fontWeight: 700,
                fontSize: '13.5px',
              }}>
                <span>{track === 'game_master' ? '🎮' : '🎯'}</span>
                <span>{track === 'game_master' ? 'Game Master' : 'Facilitator'}</span>
              </span>
            </div>
            <button
              type="button"
              onClick={goBackToStep1}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-secondary, #475569)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              ← Change position
            </button>
          </div>

          {/* Date filter */}
          {availableDates.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <label style={sectionLabelStyle}>Filter by date</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {availableDates.map((d) => {
                  const label = formatDateHeading(d).replace(/, \d{4}$/, '')
                  const [dayOfWeek, ...restParts] = label.split(',')
                  const dateRest = restParts.join(',')
                  const active = filterDate === d
                  const hasOpen = slots.some((s) => toLocalDateIso(s.starts_at) === d && s.seats_left > 0)
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { setFilterDate(d); setSelectedId(null) }}
                      style={{ padding: '8px 16px', borderRadius: '99px', border: `1.5px solid ${active ? 'var(--btn-active-border, #2563EB)' : 'var(--border-card, #EAEEF4)'}`, background: active ? 'var(--btn-active-bg, #EFF4FF)' : 'var(--bg-card, #fff)', color: active ? 'var(--btn-active-text, #2563EB)' : 'var(--text-secondary, #475569)', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease', opacity: hasOpen ? 1 : 0.65, display: 'inline-flex', alignItems: 'baseline', gap: '2px' }}
                    >
                      <span style={{ fontSize: '15.5px', fontWeight: 800 }}>{dayOfWeek}</span>
                      <span>,{dateRest}</span>
                      {!hasOpen && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted, #94A3B8)', marginLeft: '4px' }}>(Full)</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {loadError && (
            <div style={{ padding: '14px 16px', borderRadius: '12px', background: 'var(--badge-danger-bg, #FEF2F2)', border: '1px solid var(--badge-danger-border, #FECACA)', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '13.5px', fontWeight: 600, marginBottom: '14px' }}>
              Couldn’t load slots: {loadError}
            </div>
          )}

          {loading ? (
            <div style={{ fontSize: '14px', color: 'var(--text-muted, #64748B)', padding: '20px' }}>Loading slots…</div>
          ) : filteredSlots.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted, #64748B)', fontSize: '14px', background: 'var(--bg-card-subtle, #F8FAFC)', borderRadius: '14px', border: '1px dashed var(--border-input, #E2E8F0)' }}>
              {slots.length === 0
                ? 'No interview slots are open for this track yet. Check back soon.'
                : 'No slots on that date. Try another date or clear the filter.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Available slots */}
              <div>
                <label style={sectionLabelStyle}>Available slots ({openSlots.length})</label>
                {openSlots.length > 0 ? (
                  <div className="slots-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                    {openSlots.map(renderSlotCard)}
                  </div>
                ) : (
                  <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-muted, #64748B)', fontSize: '13.5px', background: 'var(--bg-card-subtle, #F8FAFC)', borderRadius: '14px', border: '1px dashed var(--border-input, #E2E8F0)' }}>
                    No available slots on this date.
                  </div>
                )}
              </div>

              {/* Full slots */}
              {fullSlots.length > 0 && (
                <div>
                  <label style={sectionLabelStyle}>Full slots ({fullSlots.length})</label>
                  <div className="slots-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                    {fullSlots.map(renderSlotCard)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={goBackToStep1}
              style={{ padding: '12px 20px', borderRadius: '11px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-secondary, #334155)', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
            >
              ← Back
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13.5px', color: selectedSlot ? 'var(--text-secondary, #334155)' : 'var(--text-muted, #94A3B8)', fontWeight: selectedSlot ? 600 : 400 }}>
                {selectedSlot
                  ? `${formatDateHeading(toLocalDateIso(selectedSlot.starts_at))} · ${formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at)}`
                  : 'Select a slot to continue'}
              </span>
              <button
                type="button"
                disabled={!selectedSlot || reserving}
                onClick={reserveAndContinue}
                style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: selectedSlot && !reserving ? 'linear-gradient(100deg, rgba(0, 255, 255, 0.74), #a855f7, #FE06AB)' : 'var(--btn-neutral-bg, #CBD5E1)', cursor: selectedSlot && !reserving ? 'pointer' : 'not-allowed', boxShadow: selectedSlot && !reserving ? '0 8px 18px -7px rgba(37,99,235,.5)' : 'none' }}
              >
                {reserving ? 'Holding your seat…' : 'Continue →'}
              </button>
            </div>
          </div>

          {reserveError && (
            <div style={{ marginTop: '12px', padding: '11px 14px', borderRadius: '10px', background: 'var(--badge-danger-bg, #FEF2F2)', border: '1px solid var(--badge-danger-border, #FECACA)', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '13.5px', fontWeight: 600 }}>
              {reserveError}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: details ───────────────────────────────────────────── */}
      {step === 3 && selectedSlot && (
        <div className="scr book-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr .7fr', gap: '16px', alignItems: 'start' }}>
          <div style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #EAEEF4)', borderRadius: '18px', padding: '20px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 14px' }}>
              <h2 className="font-title" style={{ fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-.01em', color: 'var(--text-primary, #0F172A)' }}>Your details</h2>
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
                <button type="button" onClick={goBackToStep2} style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-secondary, #475569)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                  Choose another slot
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={fieldLabelStyle} htmlFor="bk-name">
                      Full name <span style={{ color: 'var(--text-muted, #94A3B8)', fontWeight: 500 }}>(according to your student ID)</span>
                    </label>
                    <input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Yang Zi Chien" style={fieldStyle} />
                    {showErrors && nameError && <FieldError message={nameError} />}
                  </div>
                  <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                      <label style={fieldLabelStyle} htmlFor="bk-student-id">Student ID</label>
                      <input id="bk-student-id" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="AC22XXXXX" style={fieldStyle} />
                      {showErrors && studentIdError && <FieldError message={studentIdError} />}
                    </div>
                    <div>
                      <label style={fieldLabelStyle} htmlFor="bk-email">
                        Email <span style={{ color: 'var(--text-muted, #94A3B8)', fontWeight: 500 }}>(school email)</span>
                      </label>
                      <input
                        id="bk-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => setEmailTouched(true)}
                        placeholder="you@xmu.edu.my"
                        style={{
                          ...fieldStyle,
                          borderColor: showEmailError ? 'var(--badge-danger-border, #FECACA)' : 'var(--border-input, #E2E8F0)',
                        }}
                      />
                      {showEmailError && <FieldError message={emailError!} />}
                    </div>
                  </div>
                  <div>
                    <label style={fieldLabelStyle} htmlFor="bk-contact">Contact number</label>
                    <input
                      id="bk-contact"
                      type="tel"
                      value={contactNumber}
                      onChange={(e) => setContactNumber(e.target.value)}
                      placeholder="e.g. 012-3456789"
                      style={fieldStyle}
                    />
                    {showErrors && contactError && <FieldError message={contactError} />}
                  </div>
                </div>

                {submitError && (
                  <div style={{ marginTop: '14px', padding: '11px 14px', borderRadius: '10px', background: 'var(--badge-danger-bg, #FEF2F2)', border: '1px solid var(--badge-danger-border, #FECACA)', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '13.5px', fontWeight: 600 }}>
                    {submitError}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', gap: '12px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={goBackToStep2} style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-secondary, #475569)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                    ← Back to slots
                  </button>
                  <button
                    type="button"
                    onClick={confirmBooking}
                    disabled={submitting}
                    style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: submitting ? 'var(--btn-neutral-bg, #CBD5E1)' : 'linear-gradient(100deg, rgba(0, 255, 255, 0.74), #a855f7, #FE06AB)', cursor: submitting ? 'not-allowed' : 'pointer', boxShadow: submitting ? 'none' : '0 8px 18px -7px rgba(37,99,235,.45)' }}
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

      {/* ── Step 4: confirmed ─────────────────────────────────────────── */}
      {step === 4 && confirmation && (
        <div className="scr" style={{ maxWidth: '560px', margin: '0 auto' }}>
          <div style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #EAEEF4)', borderRadius: '20px', padding: '28px 24px', textAlign: 'center', boxShadow: '0 14px 40px -18px rgba(16,24,40,.2)' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '99px', background: 'var(--badge-success-bg, #ECFDF3)', border: '1px solid var(--badge-success-border, #BBF7D0)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', animation: 'pop .4s ease' }}>
              <span style={{ fontSize: '30px', color: 'var(--badge-success-text, #16A34A)' }}>✓</span>
            </div>
            <h2 className="font-title" style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 18px', color: 'var(--text-primary, #0F172A)' }}>Booked!</h2>

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

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <a href="/my-booking" style={{ padding: '12px 18px', borderRadius: '11px', border: 'none', background: 'linear-gradient(100deg, rgba(0, 255, 255, 0.74), #a855f7, #FE06AB)', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
                View my booking
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
