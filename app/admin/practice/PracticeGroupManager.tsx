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
import { AlertCircle, ArrowRightLeft, CalendarClock, CheckCircle2, Clock3, Layers3, MapPin, Pencil, Plus, Trash2, UserRoundPlus, UsersRound } from 'lucide-react'
import styles from './practice-admin.module.css'

type AdminSession = PracticeSession & { group_id: string }
type Props = { groups: AdminPracticeGroup[]; roster: AdminRosterMember[]; bookings: AdminPracticeBooking[]; sessions: AdminSession[] }
type SessionDraft = { id?: string; startsAt: string; endsAt: string; location: string }

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
    <section className={styles.section} aria-labelledby="groups-heading">
      <header className={styles.sectionHeader}>
        <div>
          <h2 id="groups-heading">Practice groups and schedules</h2>
          <p>Set capacity first, then add sessions and place members. Closed groups stay visible to admins but cannot receive public bookings.</p>
        </div>
        <span className={styles.intakeBadge}><Layers3 size={14} /> {groups.filter((group) => group.status === 'open').length} open</span>
      </header>

      <form className={styles.createPanel} onSubmit={createGroup}>
        <h3 className={styles.formHeading}><Plus size={17} /> Create a practice group</h3>
        <div className={styles.createGrid}>
          <label className={styles.label}>Group name<input className={styles.input} aria-label="New group name" placeholder="e.g. Stage Left" required value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
          <label className={styles.label}>Capacity<input className={styles.input} aria-label="New group capacity" type="number" min="1" required value={newCapacity} onChange={(event) => setNewCapacity(Number(event.target.value))} /></label>
          <button className={`${styles.button} ${styles.primaryButton}`} type="submit" disabled={busy}><Plus size={15} /> Create group</button>
        </div>
      </form>
      {message && <div className={`${styles.notice} ${isError ? styles.noticeError : ''}`} role={isError ? 'alert' : 'status'}>{isError ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{message}</span></div>}
      {groups.length === 0 && <div className={styles.emptyState}><Layers3 size={25} /><strong>No practice groups yet</strong><span>Create the first group above, then add its sessions and members.</span></div>}
      <div className={styles.groupsGrid}>{groups.map((group) => {
        const groupBookings = bookings.filter((booking) => booking.group_id === group.id)
        const groupSessions = sessions.filter((session) => session.group_id === group.id)
        const groupDraft = groupDrafts[group.id] ?? { name: group.name, capacity: group.capacity }
        const sessionDraft = sessionDrafts[group.id] ?? emptySession
        const occupancy = Math.min((group.booking_count / Math.max(group.capacity, 1)) * 100, 100)
        return (
          <article className={styles.groupCard} key={group.id}>
            <header className={styles.groupHeader}>
              <div>
                <div className={styles.groupTitleRow}>
                  <h3>{group.name}</h3>
                  <span className={`${styles.statusBadge} ${group.status === 'open' ? '' : styles.statusInactive}`}>{group.status === 'open' ? 'Open for booking' : 'Closed'}</span>
                </div>
                <p className={styles.groupMeta}>{groupSessions.length} session{groupSessions.length === 1 ? '' : 's'} scheduled</p>
              </div>
              <div className={styles.capacity}>
                <span className={styles.capacityText}>{group.booking_count} of {group.capacity} places filled</span>
                <div className={styles.capacityTrack} aria-hidden="true"><div className={styles.capacityFill} style={{ width: `${occupancy}%` }} /></div>
              </div>
            </header>

            <div className={styles.groupBody}>
              <div className={styles.groupSettings}>
                <label className={styles.label}>Group name<input className={styles.input} aria-label={`Group name for ${group.name}`} value={groupDraft.name} onChange={(event) => setGroupDrafts((current) => ({ ...current, [group.id]: { ...groupDraft, name: event.target.value } }))} /></label>
                <label className={styles.label}>Capacity<input className={styles.input} aria-label={`Capacity for ${group.name}`} type="number" min="1" value={groupDraft.capacity} onChange={(event) => setGroupDrafts((current) => ({ ...current, [group.id]: { ...groupDraft, capacity: Number(event.target.value) } }))} /></label>
                <div className={styles.buttonRow}>
                  <button className={`${styles.button} ${styles.secondaryButton}`} type="button" disabled={busy} onClick={() => updateGroup(group)}><CheckCircle2 size={14} /> Save {group.name}</button>
                  <button className={`${styles.button} ${group.status === 'open' ? styles.dangerButton : styles.successButton}`} type="button" disabled={busy} aria-label={`${group.status === 'open' ? 'Close' : 'Open'} ${group.name}`} onClick={() => updateGroup(group, group.status === 'open' ? 'closed' : 'open')}>{group.status === 'open' ? 'Close booking' : 'Open booking'}</button>
                  <button className={`${styles.iconButton} ${styles.dangerButton}`} type="button" disabled={busy} aria-label={`Delete ${group.name}`} onClick={() => run(() => deletePracticeGroupAction(group.id), 'Group deleted.')}><Trash2 size={14} /> Delete</button>
                </div>
              </div>

              <div className={styles.groupSection}>
                <div className={styles.groupSectionHeader}><h4><CalendarClock size={16} /> Sessions</h4><span className={styles.countPill}>{groupSessions.length}</span></div>
                {groupSessions.length === 0 ? <div className={styles.emptyState}><Clock3 size={22} /><strong>No sessions scheduled</strong><span>Add the first practice time below.</span></div> : <div className={styles.sessionList}>{groupSessions.map((session) => <div className={styles.sessionItem} key={session.id}>
                  <div className={styles.sessionInfo}><Clock3 size={16} /><span>{new Date(session.starts_at).toLocaleString()}<small><MapPin size={11} /> {session.location || 'Location not set'}</small></span></div>
                  <div className={styles.inlineActions}>
                    <button className={`${styles.iconButton} ${styles.secondaryButton}`} type="button" aria-label={`Edit session ${session.location}`} onClick={() => setSessionDrafts((current) => ({ ...current, [group.id]: { id: session.id, startsAt: localDateTime(session.starts_at), endsAt: localDateTime(session.ends_at), location: session.location } }))}><Pencil size={14} /> Edit</button>
                    <button className={`${styles.iconButton} ${styles.dangerButton}`} type="button" aria-label={`Delete session ${session.location}`} onClick={() => run(() => deletePracticeSessionAction(session.id), 'Session deleted.')}><Trash2 size={14} /> Delete</button>
                  </div>
                </div>)}</div>}
                <div className={styles.sessionForm}>
                  <label className={styles.label}>Start<input className={styles.input} aria-label={`Session start for ${group.name}`} type="datetime-local" value={sessionDraft.startsAt} onChange={(event) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, startsAt: event.target.value } }))} /></label>
                  <label className={styles.label}>End<input className={styles.input} aria-label={`Session end for ${group.name}`} type="datetime-local" value={sessionDraft.endsAt} onChange={(event) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, endsAt: event.target.value } }))} /></label>
                  <label className={styles.label}>Location<input className={styles.input} aria-label={`Session location for ${group.name}`} placeholder="Room or venue" value={sessionDraft.location} onChange={(event) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, location: event.target.value } }))} /></label>
                  <button className={`${styles.button} ${styles.primaryButton}`} type="button" aria-label={`${sessionDraft.id ? 'Save session for' : 'Add session to'} ${group.name}`} onClick={() => saveSession(group)}>{sessionDraft.id ? <CheckCircle2 size={14} /> : <Plus size={14} />}{sessionDraft.id ? 'Save session' : 'Add session'}</button>
                </div>
              </div>

              <div className={styles.groupSection}>
                <div className={styles.groupSectionHeader}><h4><UsersRound size={16} /> Members</h4><span className={styles.countPill}>{groupBookings.length}</span></div>
                {groupBookings.length === 0 ? <div className={styles.emptyState}><UsersRound size={22} /><strong>No members in this group</strong><span>Members can book publicly, or you can assign one below.</span></div> : <div className={styles.memberList}>{groupBookings.map((booking) => <div className={styles.memberItem} key={booking.id}>
                  <div className={styles.memberInfo}><UsersRound size={16} /><span><strong>{booking.member_name}</strong><small>{booking.student_id} · {booking.source === 'self_service' ? 'Self-booked' : 'Assigned by admin'}</small></span></div>
                  <div className={styles.inlineActions}>
                    <select className={styles.select} aria-label={`Move ${booking.student_id}`} value={moves[booking.id] ?? group.id} onChange={(event) => setMoves((current) => ({ ...current, [booking.id]: event.target.value }))}>
                      {groups.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                    <button className={`${styles.iconButton} ${styles.secondaryButton}`} type="button" aria-label={`Move ${booking.student_id}`} disabled={!moves[booking.id] || moves[booking.id] === group.id} onClick={async () => {
                      const destination = moves[booking.id]
                      const success = await run(() => movePracticeMemberAction(booking.id, destination), 'Member moved.')
                      if (success) setMoves((current) => ({ ...current, [booking.id]: destination }))
                    }}><ArrowRightLeft size={14} /> Move</button>
                    <button className={`${styles.iconButton} ${styles.dangerButton}`} type="button" aria-label={`Remove ${booking.student_id}`} onClick={() => run(() => removePracticeBookingAction(booking.id), 'Booking removed.')}><Trash2 size={14} /> Remove</button>
                  </div>
                </div>)}</div>}
                <div className={styles.assignRow}>
                  <select className={styles.select} aria-label={`Assign member to ${group.name}`} value={assignments[group.id] ?? ''} onChange={(event) => setAssignments((current) => ({ ...current, [group.id]: event.target.value }))}>
                <option value="">Select an active unbooked member</option>
                {unbooked.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.student_id})</option>)}
              </select>
                  <button className={`${styles.button} ${styles.primaryButton}`} type="button" aria-label={`Assign to ${group.name}`} disabled={!assignments[group.id]} onClick={async () => {
                    const memberId = assignments[group.id]
                    const success = await run(() => assignPracticeMemberAction(memberId, group.id), 'Member assigned.')
                    if (success) setAssignments((current) => ({ ...current, [group.id]: '' }))
                  }}><UserRoundPlus size={14} /> Assign</button>
                </div>
              </div>
            </div>
          </article>
        )
      })}</div>
    </section>
  )
}
