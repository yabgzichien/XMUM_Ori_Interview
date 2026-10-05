'use client'

import { useState } from 'react'
import { CalendarClock, CheckCircle2, RotateCcw } from 'lucide-react'
import { savePracticeOpeningAction } from '@/app/actions/practiceAdminActions'
import styles from './practice-admin.module.css'

function toMalaysiaInput(value: string | null) {
  if (!value) return ''
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
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
          <p>Everyone can preview the performances now. Booking unlocks automatically at this shared time.</p>
        </div>
      </div>
      <div className={styles.releaseControls}>
        <label className={styles.label}>Booking opens at (Malaysia time)
          <input className={styles.input} type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <div className={styles.buttonRow}>
          <button className={`${styles.button} ${styles.primaryButton}`} type="button" disabled={!value || busy} onClick={() => save(value)}><CheckCircle2 size={15} /> Save opening time</button>
          <button className={`${styles.button} ${styles.secondaryButton}`} type="button" disabled={busy} onClick={() => save(null)}><RotateCcw size={15} /> Clear opening time</button>
        </div>
      </div>
      {message && <div className={`${styles.notice} ${isError ? styles.noticeError : ''}`} role={isError ? 'alert' : 'status'}>{message}</div>}
    </section>
  )
}
