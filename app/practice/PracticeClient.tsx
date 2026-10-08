'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarClock, CheckCircle2, ChevronDown, Clock3, Headphones, Play, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { bookPracticeGroup, releasePracticeHold, reservePracticeGroup, verifyPracticeMember } from '@/lib/practice-public'
import { getYouTubeEmbedUrl } from '@/lib/practice-media'
import type { PracticeCatalog, PracticeIdentityInput, PublicPracticeBooking, PublicPracticeGroup } from '@/lib/practice-types'
import styles from './practice-public.module.css'

type Screen =
  | { kind: 'showcase' }
  | { kind: 'verify'; group: PublicPracticeGroup }
  | { kind: 'confirm'; identity: PracticeIdentityInput; group: PublicPracticeGroup; hold: { token: string; expiresAt: number } }
  | { kind: 'booked'; booking: PublicPracticeBooking; newlyCreated: boolean }

const emptyCatalog: PracticeCatalog = {
  server_now: new Date().toISOString(),
  booking_opens_at: null,
  booking_open: false,
  groups: [],
}

const HOLD_TTL_MS = 60 * 1000
const HOLD_STORAGE_KEY = 'xmumori-practice-hold'

type SavedHold = { token: string; expiresAt: number; groupId: string; identity: PracticeIdentityInput }

function readSavedHold(): SavedHold | null {
  try {
    const raw = sessionStorage.getItem(HOLD_STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as SavedHold
    if (!saved?.token || !saved.groupId || !saved.identity?.studentId || typeof saved.expiresAt !== 'number') return null
    return saved
  } catch {
    return null
  }
}

function clearSavedHold() {
  try { sessionStorage.removeItem(HOLD_STORAGE_KEY) } catch { /* storage unavailable */ }
}

function leadersText(names: string[]) {
  return names.length > 0 ? names.join(', ') : 'Not assigned yet'
}

function leadLabel(count: number) {
  return count > 1 ? 'Performance leads' : 'Performance lead'
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(Math.ceil(milliseconds / 1000), 0)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return {
    days,
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  }
}

function formatOpeningTime(value: string) {
  return new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(value))
}

function MediaToggle({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.mediaPanel}>
      <button
        type="button"
        className={styles.mediaLabel}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', justifyContent: 'space-between', font: 'inherit', color: 'inherit' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon} {label}</span>
        <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
      </button>
      {open && children}
    </div>
  )
}

function MediaEmbed({ group }: { group: PublicPracticeGroup }) {
  const videoEmbed = group.performance_video_url ? getYouTubeEmbedUrl(group.performance_video_url) : null
  const songEmbed = group.song?.type === 'youtube' ? getYouTubeEmbedUrl(group.song.url) : null
  if (!videoEmbed && !group.song) return null

  return (
    <div className={styles.mediaGrid}>
      {videoEmbed && (
        <MediaToggle label="Performance video" icon={<Play size={14} />}>
          <div className={styles.videoFrame}>
            <iframe
              src={videoEmbed}
              title={`Performance video for ${group.name}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </MediaToggle>
      )}
      {group.song && (
        <MediaToggle label="Song preview" icon={<Headphones size={14} />}>
          {songEmbed ? (
            <div className={styles.videoFrame}>
              <iframe src={songEmbed} title={`Song for ${group.name}`} allow="autoplay; encrypted-media" allowFullScreen />
            </div>
          ) : (
            <div className={styles.audioWrap}>
              <audio controls preload="none" src={group.song.url} aria-label={`Song audio for ${group.name}`} />
              {group.song.type === 'external' && <a href={group.song.url} target="_blank" rel="noreferrer">Open audio source</a>}
            </div>
          )}
        </MediaToggle>
      )}
    </div>
  )
}

export function PracticeClient({ initialCatalog = emptyCatalog }: { initialCatalog?: PracticeCatalog }) {
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [screen, setScreen] = useState<Screen>({ kind: 'showcase' })
  const [groups, setGroups] = useState(initialCatalog.groups)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [{ clientNow, serverOffset }] = useState(() => {
    const clientNow = Date.now()
    return {
      clientNow,
      serverOffset: new Date(initialCatalog.server_now).getTime() - clientNow,
    }
  })
  const [clock, setClock] = useState(clientNow)
  const submittingRef = useRef(false)
  const [holdRemainingMs, setHoldRemainingMs] = useState(HOLD_TTL_MS)
  const holdTokenRef = useRef<string | null>(null)
  const opensAt = initialCatalog.booking_opens_at ? new Date(initialCatalog.booking_opens_at).getTime() : null
  const authoritativeNow = clock + serverOffset
  const bookingOpen = initialCatalog.booking_open || (opensAt !== null && authoritativeNow >= opensAt)
  const countdown = opensAt === null ? null : formatCountdown(opensAt - authoritativeNow)

  useEffect(() => {
    if (bookingOpen || opensAt === null) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [bookingOpen, opensAt])

  // Restore an unexpired hold after a refresh.
  useEffect(() => {
    const saved = readSavedHold()
    if (!saved) return
    const group = initialCatalog.groups.find((g) => g.id === saved.groupId)
    if (!group || saved.expiresAt <= Date.now()) {
      releasePracticeHold(saved.token)
      clearSavedHold()
      return
    }
    holdTokenRef.current = saved.token
    /* eslint-disable react-hooks/set-state-in-effect -- sessionStorage is only readable after hydration */
    setStudentId(saved.identity.studentId)
    setEmail(saved.identity.email)
    setScreen({ kind: 'confirm', identity: saved.identity, group, hold: { token: saved.token, expiresAt: saved.expiresAt } })
    /* eslint-enable react-hooks/set-state-in-effect */
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Count down the hold on the confirm step; send the user back when it runs out.
  const confirmExpiresAt = screen.kind === 'confirm' ? screen.hold.expiresAt : null
  useEffect(() => {
    if (confirmExpiresAt === null) return
    const tick = () => {
      const remaining = Math.max(0, confirmExpiresAt - Date.now())
      setHoldRemainingMs(remaining)
      if (remaining > 0) return
      window.clearInterval(timer)
      expireHold()
    }
    const timer = window.setInterval(tick, 250)
    tick()
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmExpiresAt])

  function dropHold() {
    const token = holdTokenRef.current
    holdTokenRef.current = null
    clearSavedHold()
    if (token) releasePracticeHold(token)
  }

  async function expireHold() {
    const identity = screen.kind === 'confirm' ? screen.identity : null
    dropHold()
    clearIdentity()
    setError('Your 1-minute hold expired. Please choose your group again.')
    setScreen({ kind: 'showcase' })
    if (identity) {
      const refreshed = await verifyPracticeMember(identity)
      if (refreshed.data?.state === 'available') setGroups(refreshed.data.groups)
    }
  }

  function clearIdentity() {
    setStudentId('')
    setEmail('')
  }

  function chooseGroup(group: PublicPracticeGroup) {
    if (!bookingOpen || group.status !== 'open' || group.seats_left < 1) return
    setError(null)
    setScreen({ kind: 'verify', group })
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault()
    if (screen.kind !== 'verify' || submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setError(null)
    const identity = { studentId: studentId.trim(), email: email.trim() }
    const result = await verifyPracticeMember(identity)
    if (result.error || !result.data) {
      setBusy(false)
      submittingRef.current = false
      setError(result.error ?? 'Practice verification is temporarily unavailable.')
      return
    }
    if (result.data.state === 'booked') {
      setBusy(false)
      submittingRef.current = false
      clearIdentity()
      setScreen({ kind: 'booked', booking: result.data.booking, newlyCreated: false })
      return
    }
    setGroups(result.data.groups)
    const selected = result.data.groups.find((group) => group.id === screen.group.id)
    if (!selected || selected.status !== 'open' || selected.seats_left < 1) {
      setBusy(false)
      submittingRef.current = false
      setError('That practice group is no longer available.')
      setScreen({ kind: 'showcase' })
      return
    }
    const reserved = await reservePracticeGroup({ ...identity, groupId: selected.id })
    if (!reserved.data) {
      setError(reserved.error ?? 'The seat could not be held.')
      if (reserved.status === 409) setScreen({ kind: 'showcase' })
      setBusy(false)
      submittingRef.current = false
      return
    }
    const expiresAt = Date.now() + HOLD_TTL_MS
    holdTokenRef.current = reserved.data.token
    try {
      sessionStorage.setItem(HOLD_STORAGE_KEY, JSON.stringify({ token: reserved.data.token, expiresAt, groupId: selected.id, identity } satisfies SavedHold))
    } catch { /* storage unavailable; hold still works without refresh restore */ }
    setHoldRemainingMs(HOLD_TTL_MS)
    setBusy(false)
    submittingRef.current = false
    setScreen({ kind: 'confirm', identity, group: selected, hold: { token: reserved.data.token, expiresAt } })
  }

  async function handleConfirm() {
    if (screen.kind !== 'confirm' || submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setError(null)
    const { identity, group, hold } = screen
    const result = await bookPracticeGroup({ ...identity, groupId: group.id, holdToken: hold.token })
    if (result.data) {
      holdTokenRef.current = null
      clearSavedHold()
      clearIdentity()
      setScreen({ kind: 'booked', booking: result.data, newlyCreated: true })
      setBusy(false)
      submittingRef.current = false
      return
    }
    if (result.status === 409) {
      dropHold()
      const refreshed = await verifyPracticeMember(identity)
      if (refreshed.data?.state === 'booked') {
        clearIdentity()
        setScreen({ kind: 'booked', booking: refreshed.data.booking, newlyCreated: false })
      } else if (refreshed.data?.state === 'available') {
        setGroups(refreshed.data.groups)
        setScreen({ kind: 'showcase' })
      }
    }
    setError(result.error ?? 'The booking could not be completed.')
    setBusy(false)
    submittingRef.current = false
  }

  if (screen.kind === 'booked') {
    return (
      <section className={styles.bookingCard}>
        {screen.newlyCreated && <p className={styles.success}><CheckCircle2 size={17} /> Booking confirmed</p>}
        <h2>{screen.booking.group_name}</h2>
        <p className={styles.leadLine}>{leadLabel(screen.booking.leader_names?.length ?? 0)}: <strong>{leadersText(screen.booking.leader_names ?? [])}</strong></p>
      </section>
    )
  }

  if (screen.kind === 'verify') {
    return (
      <section className={styles.flowCard}>
        <button className={styles.backButton} type="button" onClick={() => setScreen({ kind: 'showcase' })}>← Back to performances</button>
        <div className={styles.flowEyebrow}><ShieldCheck size={15} /> Booking {screen.group.name}</div>
        <p className={styles.leadLine}>{leadLabel(screen.group.leaders.length)}: <strong>{leadersText(screen.group.leaders.map((leader) => leader.name))}</strong></p>
        <h2>Verify your details</h2>
        <p>Use your student ID and its matching <strong>@xmu.edu.my</strong> email.</p>
        <form className={styles.verifyForm} onSubmit={handleVerify}>
          <label>Student ID<input value={studentId} onChange={(event) => setStudentId(event.target.value)} required autoComplete="username" /></label>
          <label>University email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
          {error && <div className={styles.error} role="alert">{error}</div>}
          <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
        </form>
      </section>
    )
  }

  if (screen.kind === 'confirm') {
    return (
      <section className={styles.flowCard}>
        <div className={styles.flowEyebrow}><CheckCircle2 size={15} /> Final step</div>
        <h2>Confirm your group</h2>
        <div className={styles.holdTimer} role="timer" aria-label="Seat held for">
          <Clock3 size={15} aria-hidden="true" />
          <span>{Math.floor(Math.ceil(holdRemainingMs / 1000) / 60)}:{String(Math.ceil(holdRemainingMs / 1000) % 60).padStart(2, '0')}</span>
        </div>
        <p>Your group name: <strong>{screen.group.name}</strong></p>
        <p className={styles.leadLine}>{leadLabel(screen.group.leaders.length)}: <strong>{leadersText(screen.group.leaders.map((leader) => leader.name))}</strong></p>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <div className={styles.flowActions}>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => { dropHold(); setScreen({ kind: 'verify', group: screen.group }) }}>Back</button>
          <button className={styles.primaryButton} type="button" disabled={busy} onClick={handleConfirm}>{busy ? 'Booking…' : 'Confirm booking'}</button>
        </div>
      </section>
    )
  }

  return (
    <div className={styles.showcase}>
      {!bookingOpen && <section className={`${styles.releaseRibbon}`} aria-live="polite">
        <div className={styles.releaseIcon}>{bookingOpen ? <Sparkles size={22} /> : <Clock3 size={22} />}</div>
        <div>
          <span className={styles.releaseLabel}>{bookingOpen ? 'Booking is open' : 'Booking opens in'}</span>
          {!bookingOpen && countdown && <strong className={styles.countdown}>{countdown.days} {countdown.days === 1 ? 'day' : 'days'} {countdown.hours}:{countdown.minutes}:{countdown.seconds}</strong>}
          {!bookingOpen && opensAt !== null && <small><CalendarClock size={13} /> {formatOpeningTime(initialCatalog.booking_opens_at!)}</small>}
          {!bookingOpen && opensAt === null && <strong className={styles.countdown}>Opening time to be announced</strong>}
        </div>
      </section>}

      {error && <div className={styles.error} role="alert">{error}</div>}
      {groups.length === 0 ? <div className={styles.emptyState}>Performance groups will appear here once the committee publishes them.</div> : (
        <div className={styles.groupGrid}>
          {groups.map((group, index) => {
            const available = bookingOpen && group.status === 'open' && group.seats_left > 0
            return (
              <article className={styles.groupCard} key={group.id}>
                <div className={styles.cardIndex}>{String(index + 1).padStart(2, '0')}</div>
                <div className={styles.cardHeader}>
                  <div>
                    {group.performance_type && <span className={styles.typeBadge}>{group.performance_type}</span>}
                    <h3>{group.name}</h3>
                  </div>
                  {group.leaders.length > 0 && <div className={styles.leader}><UserRound size={15} /><span><small>{group.leaders.length > 1 ? 'Performance leaders' : 'Performance leader'}</small>{group.leaders.map((leader) => leader.name).join(', ')}</span></div>}
                </div>
                {group.songs ? <p className={styles.description}>{group.songs}</p> : group.description ? <p className={styles.description}>{group.description}</p> : null}
                <MediaEmbed group={group} />
                <footer className={styles.cardFooter}>
                  <div className={styles.capacitySplit} aria-label={`Remaining spaces for ${group.name}`}>
                    <span>{group.committee_seats_left} Committee {group.committee_seats_left === 1 ? 'space' : 'spaces'}</span>
                    <span>{group.faci_gm_seats_left} Faci/GM {group.faci_gm_seats_left === 1 ? 'space' : 'spaces'}</span>
                  </div>
                  <button
                    className={styles.primaryButton}
                    type="button"
                    disabled={!available}
                    aria-label={available ? `Choose ${group.name}` : undefined}
                    onClick={() => chooseGroup(group)}
                  >
                    {!bookingOpen ? 'Available when booking opens' : group.status === 'closed' ? 'Not available' : group.seats_left < 1 ? 'Full' : 'Choose this group'}
                  </button>
                </footer>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
