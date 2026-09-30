'use client'

import { useRef, useState } from 'react'
import { bookPracticeGroup, verifyPracticeMember } from '@/lib/practice-public'
import type { PracticeIdentityInput, PublicPracticeBooking, PublicPracticeGroup } from '@/lib/practice-types'

type Screen =
  | { kind: 'verify' }
  | { kind: 'available'; identity: PracticeIdentityInput; groups: PublicPracticeGroup[] }
  | { kind: 'confirm'; identity: PracticeIdentityInput; group: PublicPracticeGroup; groups: PublicPracticeGroup[] }
  | { kind: 'booked'; booking: PublicPracticeBooking; newlyCreated: boolean }

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #EAEEF4)',
  borderRadius: '18px', padding: '24px', boxShadow: '0 1px 2px rgba(16,24,40,.04)',
}
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '11px 12px',
  border: '1px solid var(--border-input, #CBD5E1)', borderRadius: '10px',
  background: 'var(--bg-input, #fff)', color: 'var(--text-primary, #0F172A)', fontSize: '14px',
}
const primaryButton: React.CSSProperties = {
  border: 0, borderRadius: '10px', padding: '11px 18px',
  background: 'linear-gradient(100deg, rgba(0, 210, 220, .9), #7C3AED, #EC4899)',
  color: '#fff', fontWeight: 750, cursor: 'pointer',
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(value))
}

export function PracticeClient() {
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [screen, setScreen] = useState<Screen>({ kind: 'verify' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return
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
      setStudentId('')
      setEmail('')
      setScreen({ kind: 'booked', booking: result.data.booking, newlyCreated: false })
      return
    }
    setScreen({ kind: 'available', identity, groups: result.data.groups })
  }

  async function handleConfirm() {
    if (screen.kind !== 'confirm' || submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setError(null)
    const { identity, group } = screen
    const result = await bookPracticeGroup({ ...identity, groupId: group.id })
    if (result.data) {
      setStudentId('')
      setEmail('')
      setScreen({ kind: 'booked', booking: result.data, newlyCreated: true })
      setBusy(false)
      submittingRef.current = false
      return
    }
    if (result.status === 409) {
      const refreshed = await verifyPracticeMember(identity)
      if (refreshed.data?.state === 'booked') {
        setStudentId('')
        setEmail('')
        setScreen({ kind: 'booked', booking: refreshed.data.booking, newlyCreated: false })
      } else if (refreshed.data?.state === 'available') {
        setScreen({ kind: 'available', identity, groups: refreshed.data.groups })
      }
    }
    setError(result.error ?? 'The booking could not be completed.')
    setBusy(false)
    submittingRef.current = false
  }

  if (screen.kind === 'verify') {
    return (
      <form onSubmit={handleVerify} style={{ ...cardStyle, maxWidth: '560px' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '19px' }}>Verify committee membership</h2>
        <p style={{ margin: '0 0 20px', color: 'var(--text-muted, #64748B)', lineHeight: 1.5 }}>
          Use your student ID and its matching <strong>@xmu.edu.my</strong> email.
        </p>
        <div style={{ display: 'grid', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '6px', fontWeight: 650, fontSize: '13px' }}>
            Student ID
            <input value={studentId} onChange={(event) => setStudentId(event.target.value)} required autoComplete="username" style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: '6px', fontWeight: 650, fontSize: '13px' }}>
            University email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" style={inputStyle} />
          </label>
          {error && <div role="alert" style={{ color: '#B91C1C', background: '#FEF2F2', borderRadius: '9px', padding: '10px 12px' }}>{error}</div>}
          <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? .65 : 1 }}>
            {busy ? 'Verifying…' : 'Verify and continue'}
          </button>
        </div>
      </form>
    )
  }

  if (screen.kind === 'available') {
    return (
      <section aria-labelledby="available-groups-title" style={{ display: 'grid', gap: '14px' }}>
        <div>
          <h2 id="available-groups-title" style={{ margin: 0, fontSize: '20px' }}>Choose your practice group</h2>
          <p style={{ color: 'var(--text-muted, #64748B)', margin: '5px 0 0' }}>Your booking cannot be changed without an admin.</p>
        </div>
        {error && <div role="alert" style={{ color: '#B91C1C', background: '#FEF2F2', borderRadius: '9px', padding: '10px 12px' }}>{error}</div>}
        {screen.groups.length === 0 && <div style={cardStyle}>No practice groups are open yet.</div>}
        {screen.groups.map((group) => (
          <article key={group.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: '17px' }}>{group.name}</h3>
              <span style={{ color: 'var(--text-muted, #64748B)', fontSize: '13px' }}>
                {group.seats_left} {group.seats_left === 1 ? 'space' : 'spaces'} remaining
              </span>
            </div>
            <button
              type="button" aria-label={`Choose ${group.name}`} disabled={group.seats_left < 1 || busy}
              onClick={() => { setError(null); setScreen({ kind: 'confirm', identity: screen.identity, group, groups: screen.groups }) }}
              style={{ ...primaryButton, opacity: group.seats_left < 1 ? .45 : 1 }}
            >
              {group.seats_left < 1 ? 'Full' : 'Choose group'}
            </button>
          </article>
        ))}
      </section>
    )
  }

  if (screen.kind === 'confirm') {
    return (
      <section style={{ ...cardStyle, maxWidth: '560px' }}>
        <h2 style={{ margin: '0 0 8px' }}>Confirm your group</h2>
        <p style={{ color: 'var(--text-muted, #64748B)', lineHeight: 1.5 }}>
          You are booking <strong>{screen.group.name}</strong>. Only an admin can change or remove this booking later.
        </p>
        {error && <div role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button type="button" disabled={busy} onClick={() => setScreen({ kind: 'available', identity: screen.identity, groups: screen.groups })} style={{ ...primaryButton, background: '#E2E8F0', color: '#334155' }}>Back</button>
          <button type="button" disabled={busy} onClick={handleConfirm} style={{ ...primaryButton, opacity: busy ? .65 : 1 }}>
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section style={{ ...cardStyle, maxWidth: '680px' }}>
      {screen.newlyCreated && <p style={{ color: '#15803D', fontWeight: 800, margin: '0 0 8px' }}>Booking confirmed</p>}
      <h2 style={{ margin: '0 0 6px' }}>{screen.booking.group_name}</h2>
      <p style={{ color: 'var(--text-muted, #64748B)', margin: '0 0 20px' }}>Your performance-practice group</p>
      <h3 style={{ fontSize: '15px', marginBottom: '10px' }}>Practice sessions</h3>
      {screen.booking.sessions.length === 0 ? (
        <p style={{ color: 'var(--text-muted, #64748B)' }}>No sessions have been scheduled yet.</p>
      ) : (
        <ul style={{ display: 'grid', gap: '10px', padding: 0, listStyle: 'none' }}>
          {screen.booking.sessions.map((session) => (
            <li key={session.id} style={{ padding: '12px', borderRadius: '10px', background: 'var(--bg-card-subtle, #F8FAFC)' }}>
              <div style={{ fontWeight: 700 }}>{formatSessionTime(session.starts_at)} – {formatSessionTime(session.ends_at)}</div>
              <div style={{ color: 'var(--text-muted, #64748B)', marginTop: '3px' }}>{session.location || 'Location to be confirmed'}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
