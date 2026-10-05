'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarClock, CheckCircle2, Clock3, Headphones, Play, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { bookPracticeGroup, verifyPracticeMember } from '@/lib/practice-public'
import { getYouTubeEmbedUrl } from '@/lib/practice-media'
import type { PracticeCatalog, PracticeIdentityInput, PublicPracticeBooking, PublicPracticeGroup } from '@/lib/practice-types'
import styles from './practice-public.module.css'

type Screen =
  | { kind: 'showcase' }
  | { kind: 'verify'; group: PublicPracticeGroup }
  | { kind: 'confirm'; identity: PracticeIdentityInput; group: PublicPracticeGroup }
  | { kind: 'booked'; booking: PublicPracticeBooking; newlyCreated: boolean }

const emptyCatalog: PracticeCatalog = {
  server_now: new Date().toISOString(),
  booking_opens_at: null,
  booking_open: false,
  groups: [],
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

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(value))
}

function MediaEmbed({ group }: { group: PublicPracticeGroup }) {
  const videoEmbed = group.performance_video_url ? getYouTubeEmbedUrl(group.performance_video_url) : null
  const songEmbed = group.song?.type === 'youtube' ? getYouTubeEmbedUrl(group.song.url) : null
  if (!videoEmbed && !group.song) return null

  return (
    <div className={styles.mediaGrid}>
      {videoEmbed && (
        <div className={styles.mediaPanel}>
          <div className={styles.mediaLabel}><Play size={14} /> Performance video</div>
          <div className={styles.videoFrame}>
            <iframe
              src={videoEmbed}
              title={`Performance video for ${group.name}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
      {group.song && (
        <div className={styles.mediaPanel}>
          <div className={styles.mediaLabel}><Headphones size={14} /> Song preview</div>
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
        </div>
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
  const opensAt = initialCatalog.booking_opens_at ? new Date(initialCatalog.booking_opens_at).getTime() : null
  const authoritativeNow = clock + serverOffset
  const bookingOpen = initialCatalog.booking_open || (opensAt !== null && authoritativeNow >= opensAt)
  const countdown = opensAt === null ? null : formatCountdown(opensAt - authoritativeNow)

  useEffect(() => {
    if (bookingOpen || opensAt === null) return
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [bookingOpen, opensAt])

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
    setBusy(false)
    submittingRef.current = false
    if (result.error || !result.data) {
      setError(result.error ?? 'Practice verification is temporarily unavailable.')
      return
    }
    if (result.data.state === 'booked') {
      clearIdentity()
      setScreen({ kind: 'booked', booking: result.data.booking, newlyCreated: false })
      return
    }
    setGroups(result.data.groups)
    const selected = result.data.groups.find((group) => group.id === screen.group.id)
    if (!selected || selected.status !== 'open' || selected.seats_left < 1) {
      setError('That practice group is no longer available.')
      setScreen({ kind: 'showcase' })
      return
    }
    setScreen({ kind: 'confirm', identity, group: selected })
  }

  async function handleConfirm() {
    if (screen.kind !== 'confirm' || submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setError(null)
    const { identity, group } = screen
    const result = await bookPracticeGroup({ ...identity, groupId: group.id })
    if (result.data) {
      clearIdentity()
      setScreen({ kind: 'booked', booking: result.data, newlyCreated: true })
      setBusy(false)
      submittingRef.current = false
      return
    }
    if (result.status === 409) {
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
        <p className={styles.muted}>Your performance-practice group</p>
        <h3>Practice sessions</h3>
        {screen.booking.sessions.length === 0 ? <p className={styles.muted}>No sessions have been scheduled yet.</p> : (
          <ul className={styles.sessionList}>
            {screen.booking.sessions.map((session) => (
              <li key={session.id}>
                <strong>{formatSessionTime(session.starts_at)} – {formatSessionTime(session.ends_at)}</strong>
                <span>{session.location || 'Location to be confirmed'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  if (screen.kind === 'verify') {
    return (
      <section className={styles.flowCard}>
        <button className={styles.backButton} type="button" onClick={() => setScreen({ kind: 'showcase' })}>← Back to performances</button>
        <div className={styles.flowEyebrow}><ShieldCheck size={15} /> Booking {screen.group.name}</div>
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
        <p>You are booking <strong>{screen.group.name}</strong>. Only an admin can change or remove this booking later.</p>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <div className={styles.flowActions}>
          <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => setScreen({ kind: 'verify', group: screen.group })}>Back</button>
          <button className={styles.primaryButton} type="button" disabled={busy} onClick={handleConfirm}>{busy ? 'Booking…' : 'Confirm booking'}</button>
        </div>
      </section>
    )
  }

  return (
    <div className={styles.showcase}>
      <section className={`${styles.releaseRibbon} ${bookingOpen ? styles.releaseOpen : ''}`} aria-live="polite">
        <div className={styles.releaseIcon}>{bookingOpen ? <Sparkles size={22} /> : <Clock3 size={22} />}</div>
        <div>
          <span className={styles.releaseLabel}>{bookingOpen ? 'Booking is open' : 'Booking opens in'}</span>
          {!bookingOpen && countdown && <strong className={styles.countdown}>{countdown.days} {countdown.days === 1 ? 'day' : 'days'} {countdown.hours}:{countdown.minutes}:{countdown.seconds}</strong>}
          {!bookingOpen && opensAt !== null && <small><CalendarClock size={13} /> {formatOpeningTime(initialCatalog.booking_opens_at!)}</small>}
          {!bookingOpen && opensAt === null && <strong className={styles.countdown}>Opening time to be announced</strong>}
          {bookingOpen && <strong className={styles.countdown}>Choose your performance while spaces remain.</strong>}
        </div>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.sectionHeading}>
        <span>December 2026 programme</span>
        <h2>Meet the performances</h2>
        <p>Watch, listen, and find the group that feels right for you.</p>
      </div>

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
                  {group.leader && <div className={styles.leader}><UserRound size={15} /><span><small>Performance leader</small>{group.leader.name}</span></div>}
                </div>
                {group.description && <p className={styles.description}>{group.description}</p>}
                <MediaEmbed group={group} />
                <footer className={styles.cardFooter}>
                  <span>{bookingOpen ? `${group.seats_left} ${group.seats_left === 1 ? 'space' : 'spaces'} remaining` : 'Preview mode'}</span>
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
