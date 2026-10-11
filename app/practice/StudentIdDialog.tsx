'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ShieldCheck, UserRoundCheck, X } from 'lucide-react'
import { verifyPracticeMember } from '@/lib/practice-public'
import type { VerifiedIdentity } from '@/lib/practice-verified-identity'
import type { PracticeLookupResult } from '@/lib/practice-types'
import styles from './practice-public.module.css'

type Props = {
  onClose: () => void
  /** Called only after the student confirms the roster entry shown back to them is theirs. */
  onVerified: (identity: VerifiedIdentity, lookup: PracticeLookupResult) => void
}

type Pending = { identity: VerifiedIdentity; lookup: PracticeLookupResult }

export function StudentIdDialog({ onClose, onVerified }: Props) {
  const titleId = useId()
  const [studentId, setStudentId] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const closeRef = useRef(onClose)

  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) closeRef.current()
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setError(null)
    const input = { studentId: studentId.trim() }
    const result = await verifyPracticeMember(input)
    submittingRef.current = false
    setBusy(false)
    if (result.error || !result.data) {
      setError(result.error ?? 'Practice verification is temporarily unavailable.')
      return
    }
    const member = result.data.member
    setPending({ identity: member ? { studentId: input.studentId, member } : { studentId: input.studentId }, lookup: result.data })
  }

  const member = pending?.identity.member

  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className={styles.dialogPanel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button className={styles.dialogClose} type="button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button>
        {pending ? (
          <>
            <div className={styles.flowEyebrow}><UserRoundCheck size={15} /> Confirm identity</div>
            <h2 id={titleId}>Is this you?</h2>
            <dl className={styles.memberSummary}>
              <div><dt>Name</dt><dd>{member?.name ?? '—'}</dd></div>
              <div><dt>Student ID</dt><dd>{member?.student_id ?? pending.identity.studentId.toUpperCase()}</dd></div>
              <div><dt>Position</dt><dd>{member?.position_label ?? '—'}</dd></div>
            </dl>
            <div className={styles.flowActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => setPending(null)}>No, re-enter</button>
              <button className={styles.primaryButton} type="button" autoFocus onClick={() => onVerified(pending.identity, pending.lookup)}>Yes, continue</button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.flowEyebrow}><ShieldCheck size={15} /> Committee check</div>
            <h2 id={titleId}>Verify your details</h2>
            <p className={styles.dialogText}>Enter the student ID</p>
            <form className={styles.verifyForm} onSubmit={submit}>
              <label>Student ID<input value={studentId} onChange={(event) => setStudentId(event.target.value)} required autoFocus autoComplete="username" placeholder="ABC1234567" /></label>
              {error && <div className={styles.error} role="alert">{error}</div>}
              <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
