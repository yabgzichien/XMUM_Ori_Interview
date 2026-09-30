'use client'

import { useState } from 'react'
import {
  assignPracticeMemberAction,
  createPracticeGroupAction,
  deletePracticeGroupAction,
  deletePracticeSessionAction,
  movePracticeMemberAction,
  removePracticeBookingAction,
  savePracticeSessionAction,
  updatePracticeGroupAction,
} from '@/app/actions/practiceAdminActions'
import type { AdminPracticeBooking, AdminPracticeGroup, AdminRosterMember, PracticeSession } from '@/lib/practice-types'

type AdminSession = PracticeSession & { group_id: string }
type Props = { groups: AdminPracticeGroup[]; roster: AdminRosterMember[]; bookings: AdminPracticeBooking[]; sessions: AdminSession[] }
type SessionDraft = { id?: string; startsAt: string; endsAt: string; location: string }

const fieldStyle = { padding: '8px 9px', border: '1px solid #dbe2ea', borderRadius: '8px' }
const buttonStyle = { padding: '7px 10px', border: '1px solid #dbe2ea', borderRadius: '8px', background: '#fff', cursor: 'pointer' }
const emptySession: SessionDraft = { startsAt: '', endsAt: '', location: '' }

function localDateTime(value: string) {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function PracticeGroupManager({ groups, roster, bookings, sessions }: Props) {
  const [newName, setNewName] = useState('')
  const [newCapacity, setNewCapacity] = useState(1)
  const [groupDrafts, setGroupDrafts] = useState<Record<string, { name: string; capacity: number }>>({})
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, SessionDraft>>({})
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [moves, setMoves] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run(operation: () => Promise<{ error: string | null }>, success: string) {
    setBusy(true)
    setMessage(null)
    const result = await operation()
    setBusy(false)
    setIsError(Boolean(result.error))
    setMessage(result.error ?? success)
    return !result.error
  }

  async function createGroup(event: React.FormEvent) {
    event.preventDefault()
    const success = await run(() => createPracticeGroupAction({ name: newName, capacity: newCapacity }), 'Group created.')
    if (success) { setNewName(''); setNewCapacity(1) }
  }

  async function updateGroup(group: AdminPracticeGroup, status = group.status) {
    const draft = groupDrafts[group.id] ?? { name: group.name, capacity: group.capacity }
    await run(() => updatePracticeGroupAction({ id: group.id, name: draft.name, capacity: draft.capacity, status }), 'Group updated.')
  }

  async function saveSession(group: AdminPracticeGroup) {
    const draft = sessionDrafts[group.id] ?? emptySession
    const success = await run(() => savePracticeSessionAction({
      ...(draft.id ? { id: draft.id } : {}), groupId: group.id, startsAt: draft.startsAt, endsAt: draft.endsAt, location: draft.location,
    }), draft.id ? 'Session updated.' : 'Session added.')
    if (success) setSessionDrafts((current) => ({ ...current, [group.id]: emptySession }))
  }

  const unbooked = roster.filter((member) => member.active && !member.booking_id)

  return (
    <section aria-labelledby="groups-heading">
      <h2 id="groups-heading">Practice groups and schedules</h2>
      <form onSubmit={createGroup} style={{ display: 'flex', gap: '9px', alignItems: 'end', flexWrap: 'wrap', marginBottom: '18px' }}>
        <label>New group name<input aria-label="New group name" required value={newName} onChange={(event) => setNewName(event.target.value)} style={{ ...fieldStyle, display: 'block' }} /></label>
        <label>Capacity<input aria-label="New group capacity" type="number" min="1" required value={newCapacity} onChange={(event) => setNewCapacity(Number(event.target.value))} style={{ ...fieldStyle, display: 'block', width: '90px' }} /></label>
        <button type="submit" disabled={busy} style={buttonStyle}>Create group</button>
      </form>
      {message && <p role={isError ? 'alert' : 'status'}>{message}</p>}
      {groups.length === 0 && <p>No practice groups yet.</p>}
      <div style={{ display: 'grid', gap: '16px' }}>{groups.map((group) => {
        const groupBookings = bookings.filter((booking) => booking.group_id === group.id)
        const groupSessions = sessions.filter((session) => session.group_id === group.id)
        const groupDraft = groupDrafts[group.id] ?? { name: group.name, capacity: group.capacity }
        const sessionDraft = sessionDrafts[group.id] ?? emptySession
        return (
          <article key={group.id} style={{ border: '1px solid #e1e7ef', borderRadius: '14px', padding: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'end', flexWrap: 'wrap' }}>
              <label>Group name<input aria-label={`Group name for ${group.name}`} value={groupDraft.name} onChange={(event) => setGroupDrafts((current) => ({ ...current, [group.id]: { ...groupDraft, name: event.target.value } }))} style={{ ...fieldStyle, display: 'block' }} /></label>
              <label>Capacity<input aria-label={`Capacity for ${group.name}`} type="number" min="1" value={groupDraft.capacity} onChange={(event) => setGroupDrafts((current) => ({ ...current, [group.id]: { ...groupDraft, capacity: Number(event.target.value) } }))} style={{ ...fieldStyle, display: 'block', width: '85px' }} /></label>
              <button type="button" disabled={busy} onClick={() => updateGroup(group)} style={buttonStyle}>Save {group.name}</button>
              <button type="button" disabled={busy} aria-label={`${group.status === 'open' ? 'Close' : 'Open'} ${group.name}`} onClick={() => updateGroup(group, group.status === 'open' ? 'closed' : 'open')} style={buttonStyle}>{group.status === 'open' ? 'Close' : 'Open'}</button>
              <button type="button" disabled={busy} aria-label={`Delete ${group.name}`} onClick={() => run(() => deletePracticeGroupAction(group.id), 'Group deleted.')} style={buttonStyle}>Delete</button>
              <span>{group.booking_count}/{group.capacity} members · {group.status}</span>
            </div>

            <h3>Sessions</h3>
            {groupSessions.map((session) => <div key={session.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
              <span>{new Date(session.starts_at).toLocaleString()} – {session.location || 'Location not set'}</span>
              <button type="button" aria-label={`Edit session ${session.location}`} onClick={() => setSessionDrafts((current) => ({ ...current, [group.id]: { id: session.id, startsAt: localDateTime(session.starts_at), endsAt: localDateTime(session.ends_at), location: session.location } }))} style={buttonStyle}>Edit</button>
              <button type="button" aria-label={`Delete session ${session.location}`} onClick={() => run(() => deletePracticeSessionAction(session.id), 'Session deleted.')} style={buttonStyle}>Delete</button>
            </div>)}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'end', flexWrap: 'wrap' }}>
              <label>Start<input aria-label={`Session start for ${group.name}`} type="datetime-local" value={sessionDraft.startsAt} onChange={(event) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, startsAt: event.target.value } }))} style={{ ...fieldStyle, display: 'block' }} /></label>
              <label>End<input aria-label={`Session end for ${group.name}`} type="datetime-local" value={sessionDraft.endsAt} onChange={(event) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, endsAt: event.target.value } }))} style={{ ...fieldStyle, display: 'block' }} /></label>
              <label>Location<input aria-label={`Session location for ${group.name}`} value={sessionDraft.location} onChange={(event) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, location: event.target.value } }))} style={{ ...fieldStyle, display: 'block' }} /></label>
              <button type="button" aria-label={`${sessionDraft.id ? 'Save session for' : 'Add session to'} ${group.name}`} onClick={() => saveSession(group)} style={buttonStyle}>{sessionDraft.id ? 'Save session' : 'Add session'}</button>
            </div>

            <h3>Members</h3>
            {groupBookings.map((booking) => <div key={booking.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '7px 0', flexWrap: 'wrap' }}>
              <span>{booking.member_name} ({booking.student_id})</span>
              <select aria-label={`Move ${booking.student_id}`} value={moves[booking.id] ?? group.id} onChange={(event) => setMoves((current) => ({ ...current, [booking.id]: event.target.value }))} style={fieldStyle}>
                {groups.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
              <button type="button" aria-label={`Move ${booking.student_id}`} disabled={!moves[booking.id] || moves[booking.id] === group.id} onClick={async () => {
                const destination = moves[booking.id]
                const success = await run(() => movePracticeMemberAction(booking.id, destination), 'Member moved.')
                if (success) setMoves((current) => ({ ...current, [booking.id]: destination }))
              }} style={buttonStyle}>Move</button>
              <button type="button" aria-label={`Remove ${booking.student_id}`} onClick={() => run(() => removePracticeBookingAction(booking.id), 'Booking removed.')} style={buttonStyle}>Remove</button>
            </div>)}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select aria-label={`Assign member to ${group.name}`} value={assignments[group.id] ?? ''} onChange={(event) => setAssignments((current) => ({ ...current, [group.id]: event.target.value }))} style={fieldStyle}>
                <option value="">Select an active unbooked member</option>
                {unbooked.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.student_id})</option>)}
              </select>
              <button type="button" aria-label={`Assign to ${group.name}`} disabled={!assignments[group.id]} onClick={async () => {
                const memberId = assignments[group.id]
                const success = await run(() => assignPracticeMemberAction(memberId, group.id), 'Member assigned.')
                if (success) setAssignments((current) => ({ ...current, [group.id]: '' }))
              }} style={buttonStyle}>Assign</button>
            </div>
          </article>
        )
      })}</div>
    </section>
  )
}
