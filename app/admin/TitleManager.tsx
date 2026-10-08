'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addCommitteePosition, deleteCommitteePosition } from '@/lib/practice'
import { AlertCircle, CheckCircle2, Tags } from 'lucide-react'
import { positionToneClass } from './practice/position-tone'
import styles from './practice/practice-admin.module.css'

type Position = { value: string; label: string }

export function TitleManager({ positions }: { positions: Position[] }) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [messageKind, setMessageKind] = useState<'error' | 'success' | null>(null)
  const [busy, setBusy] = useState(false)

  async function addTitle(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    setMessageKind(null)
    const { error } = await addCommitteePosition(label)
    setBusy(false)
    if (error) {
      setMessageKind('error')
      setMessage(error.message)
      return
    }
    setLabel('')
    setMessageKind('success')
    setMessage('Title added.')
    router.refresh()
  }

  async function removeTitle(position: Position) {
    if (!window.confirm(`Remove the "${position.label}" title? Anyone currently holding it must be reassigned first.`)) return
    setBusy(true)
    setMessage(null)
    setMessageKind(null)
    const { error } = await deleteCommitteePosition(position.value)
    setBusy(false)
    if (error) {
      setMessageKind('error')
      setMessage(error.message.includes('violates foreign key')
        ? 'Someone currently holds this title — reassign them first.'
        : error.message)
      return
    }
    setMessageKind('success')
    setMessage(`Removed ${position.label}.`)
    router.refresh()
  }

  return (
    <section className={styles.section} aria-labelledby="titles-heading">
      <header className={styles.sectionHeader}>
        <div>
          <h2 id="titles-heading">Roster titles</h2>
        </div>
        <span className={styles.intakeBadge}><Tags size={14} /> {positions.length} titles</span>
      </header>

      <form className={styles.formPanel} onSubmit={addTitle}>
        <h3 className={styles.formHeading}>Add a title</h3>
        <div className={styles.formGrid}>
          <label className={styles.label}>Title
            <input
              className={styles.input}
              aria-label="New title"
              placeholder="e.g. Marketing Lead"
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <div className={styles.buttonRow}>
            <button className={`${styles.button} ${styles.primaryButton}`} type="submit" disabled={busy}>Add title</button>
          </div>
        </div>
      </form>

      {message && (
        <div className={`${styles.notice} ${messageKind === 'error' ? styles.noticeError : ''}`} role={messageKind === 'error' ? 'alert' : 'status'}>
          {messageKind === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{message}</span>
        </div>
      )}

      <div className={styles.titleList}>
        {positions.map((position) => (
          <span key={position.value} className={`${styles.positionBadge} ${styles[positionToneClass(position.value)]}`}>
            {position.label}
            <button
              type="button"
              aria-label={`Remove ${position.label}`}
              onClick={() => removeTitle(position)}
              disabled={busy}
              className={styles.chipRemove}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </section>
  )
}
