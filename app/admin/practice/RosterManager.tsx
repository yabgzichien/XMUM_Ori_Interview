'use client'

import { useState } from 'react'
import { saveRosterMemberAction, setRosterMemberActiveAction } from '@/app/actions/practiceAdminActions'
import type { AdminRosterMember } from '@/lib/practice-types'

type Props = {
  roster: AdminRosterMember[]
  positions: Array<{ value: string; label: string }>
}

const fieldStyle = { padding: '9px 10px', border: '1px solid #dbe2ea', borderRadius: '8px' }
const buttonStyle = { padding: '8px 12px', border: '1px solid #dbe2ea', borderRadius: '8px', background: '#fff', cursor: 'pointer' }

export function RosterManager({ roster, positions }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [position, setPosition] = useState(positions[0]?.value ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [messageKind, setMessageKind] = useState<'error' | 'success' | null>(null)
  const [busy, setBusy] = useState(false)

  function resetForm() {
    setEditingId(null)
    setName('')
    setStudentId('')
    setPosition(positions[0]?.value ?? '')
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    setMessageKind(null)
    const result = await saveRosterMemberAction({ ...(editingId ? { id: editingId } : {}), name, studentId, position })
    setBusy(false)
    if (result.error) {
      setMessageKind('error')
      return setMessage(result.error)
    }
    setMessageKind('success')
    setMessage(editingId ? 'Member updated.' : 'Member added.')
    resetForm()
  }

  function edit(member: AdminRosterMember) {
    setEditingId(member.id)
    setName(member.name)
    setStudentId(member.student_id)
    setPosition(member.position)
    setMessage(null)
    setMessageKind(null)
  }

  async function setActive(member: AdminRosterMember, active: boolean) {
    setBusy(true)
    setMessage(null)
    setMessageKind(null)
    const result = await setRosterMemberActiveAction(member.id, active)
    setBusy(false)
    setMessageKind(result.error ? 'error' : 'success')
    setMessage(result.error ?? (active ? 'Member reactivated.' : 'Member deactivated.'))
  }

  return (
    <section aria-labelledby="roster-heading">
      <h2 id="roster-heading">Committee roster</h2>
      <p>Only active members can verify and book. Deactivating a member does not remove their existing booking.</p>
      <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr 1.3fr auto', gap: '10px', alignItems: 'end', margin: '18px 0' }}>
        <label>Name<input aria-label="Name" required value={name} onChange={(event) => setName(event.target.value)} style={{ ...fieldStyle, display: 'block', width: '100%', marginTop: '5px' }} /></label>
        <label>Student ID<input aria-label="Student ID" required value={studentId} onChange={(event) => setStudentId(event.target.value)} style={{ ...fieldStyle, display: 'block', width: '100%', marginTop: '5px' }} /></label>
        <label>Position<select aria-label="Position" required value={position} onChange={(event) => setPosition(event.target.value)} style={{ ...fieldStyle, display: 'block', width: '100%', marginTop: '5px' }}>{positions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="submit" disabled={busy} style={buttonStyle}>{editingId ? 'Save member' : 'Add member'}</button>
          {editingId && <button type="button" onClick={resetForm} style={buttonStyle}>Cancel</button>}
        </div>
      </form>
      {message && <p role={messageKind === 'error' ? 'alert' : 'status'}>{message}</p>}
      {roster.length === 0 ? <p>No committee members yet.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Member</th><th align="left">Position</th><th align="left">Practice group</th><th align="left">Status</th><th>Actions</th></tr></thead>
            <tbody>{roster.map((member) => (
              <tr key={member.id} style={{ borderTop: '1px solid #e5eaf0' }}>
                <td style={{ padding: '12px 0' }}><strong>{member.name}</strong><br /><small>{member.student_id}</small></td>
                <td>{positions.find((option) => option.value === member.position)?.label ?? member.position}</td>
                <td>{member.group_name ?? 'Not booked'}</td>
                <td>{member.active ? 'Active' : 'Inactive'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" aria-label={`Edit ${member.student_id}`} onClick={() => edit(member)} style={buttonStyle}>Edit</button>{' '}
                  <button type="button" disabled={busy} aria-label={`${member.active ? 'Deactivate' : 'Reactivate'} ${member.student_id}`} onClick={() => setActive(member, !member.active)} style={buttonStyle}>{member.active ? 'Deactivate' : 'Reactivate'}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
