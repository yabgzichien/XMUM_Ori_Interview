'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, RotateCcw } from 'lucide-react'
import { savePracticeOpeningAction } from '@/app/actions/practiceAdminActions'
import { DateTimeField } from './DateTimeField'
import styles from './practice-admin.module.css'

function toMalaysiaInput(value: string | null) {
  if (!value) return ''
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

const malaysiaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h12',
})

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(Math.ceil(milliseconds / 1000), 0)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = String(Math.floor((totalSeconds % 86_400) / 3_600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3_600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${days > 0 ? `${days} ${days === 1 ? 'day' : 'days'} ` : ''}${hours}:${minutes}:${seconds}`
}

function ReleaseClock({ opensAt }: { opensAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  const target = opensAt ? new Date(opensAt).getTime() : null
  const locked = target !== null && target > now

  useEffect(() => {
    if (!locked) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [locked])

  if (locked) {
    return (
      <div className={styles.releaseClock} role="timer" aria-live="off">
        <strong>{formatCountdown(target - now)}</strong>
        <span>Opens {malaysiaTime.format(new Date(target))} · groups stay visible for preview</span>
      </div>
    )
  }
  return (
    <div className={styles.releaseClock} role="timer" aria-live="off">
      <strong>00:00:00</strong>
      <span>{target !== null ? `Open since ${malaysiaTime.format(new Date(target))}` : 'Open now (no opening time set)'}</span>
    </div>
  )
}

export function PracticeReleaseManager({ opensAt }: { opensAt: string | null }) {
  const [value, setValue] = useState(() => toMalaysiaInput(opensAt))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function save(next: string | null) {
    setBusy(true)
    setMessage(null)
    const result = await savePracticeOpeningAction({ opensAt: next })
    setBusy(false)
    setIsError(Boolean(result.error))
    setMessage(result.error ?? (next ? 'Opening time saved.' : 'Opening time cleared. Preview Mode will remain active.'))
    if (!result.error && next === null) setValue('')
  }

  return (
    <section className={styles.releasePanel} aria-labelledby="release-heading">
      <div className={styles.releaseCopy}>
        <span className={styles.releaseIcon}><CalendarClock size={19} /></span>
        <div>
          <h2 id="release-heading">Booking release</h2>
          <ReleaseClock opensAt={opensAt} />
        </div>
      </div>
      <div className={styles.releaseControls}>
        <DateTimeField label="Booking opens at (Malaysia time)" value={value} onChange={setValue} />
        <div className={styles.buttonRow}>
          <button className={`${styles.button} ${styles.primaryButton}`} type="button" disabled={!value || busy} onClick={() => save(value)}><CheckCircle2 size={15} /> Save opening time</button>
          <button className={`${styles.button} ${styles.secondaryButton}`} type="button" disabled={busy} onClick={() => save(null)}><RotateCcw size={15} /> Clear opening time</button>
        </div>
      </div>
      {message && <div className={`${styles.notice} ${isError ? styles.noticeError : ''}`} role={isError ? 'alert' : 'status'}>{message}</div>}
    </section>
  )
}
