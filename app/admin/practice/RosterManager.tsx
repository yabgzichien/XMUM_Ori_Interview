'use client'

import { useState } from 'react'
import { saveRosterMemberAction, setRosterMemberActiveAction } from '@/app/actions/practiceAdminActions'
import type { AdminRosterMember } from '@/lib/practice-types'
import { AdminModal } from './AdminModal'
import { RosterImportPanel } from './RosterImportPanel'
import { SearchSelect } from './SearchSelect'
import { positionToneClass } from './position-tone'
import { AlertCircle, CheckCircle2, Pencil, Search, Upload, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react'
import styles from './practice-admin.module.css'

type Props = {
  roster: AdminRosterMember[]
  positions: Array<{ value: string; label: string }>
}

export function RosterManager({ roster, positions }: Props) {
  const [modal, setModal] = useState<'member' | 'import' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [contactNumber, setContactNumber] = useState('')
  const [position, setPosition] = useState(positions[0]?.value ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [messageKind, setMessageKind] = useState<'error' | 'success' | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  function resetForm() {
    setEditingId(null)
    setName('')
    setStudentId('')
    setContactNumber('')
    setPosition(positions[0]?.value ?? '')
  }

  function closeModal() {
    setModal(null)
    resetForm()
  }

  function openAdd() {
    resetForm()
    setMessage(null)
    setMessageKind(null)
    setModal('member')
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    setFormError(null)
    setMessageKind(null)
    const result = await saveRosterMemberAction({ ...(editingId ? { id: editingId } : {}), name, studentId, position, contactNumber })
    setBusy(false)
    if (result.error) {
      setMessageKind('error')
      return setFormError(result.error)
    }
    setMessageKind('success')
    setMessage(editingId ? 'Member updated.' : 'Member added.')
    closeModal()
  }

  function edit(member: AdminRosterMember) {
    setEditingId(member.id)
    setName(member.name)
    setStudentId(member.student_id)
    setContactNumber(member.contact_number ?? '')
    setPosition(member.position)
    setFormError(null)
    setModal('member')
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

  const normalizedQuery = query.trim().toLowerCase()
  const visibleRoster = normalizedQuery
    ? roster.filter((member) => {
      const positionLabel = positions.find((option) => option.value === member.position)?.label ?? member.position
      return [member.name, member.student_id, positionLabel, member.group_name ?? '']
        .some((value) => value.toLowerCase().includes(normalizedQuery))
    })
    : roster

  return (
    <section className={styles.section} aria-labelledby="roster-heading">
      <header className={styles.sectionHeader}>
        <div>
          <h2 id="roster-heading">Committee roster</h2>
          <p>Active members can verify and book. Deactivate someone to pause access without removing their existing booking.</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.intakeBadge}><UserRoundCheck size={14} /> {roster.filter((member) => member.active).length} active</span>
          <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={() => setModal('import')}><Upload size={15} /> Import</button>
          <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={openAdd}><UserPlus size={15} /> Add member</button>
        </div>
      </header>

      {modal === 'member' && (
        <AdminModal title={editingId ? 'Edit roster member' : 'Add a roster member'} onClose={closeModal}>
          <form className={styles.modalForm} onSubmit={save}>
            <label className={styles.label}>Name<input className={styles.input} aria-label="Name" placeholder="Full name" required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className={styles.label}>Student ID<input className={styles.input} aria-label="Student ID" placeholder="DSC2404106" required value={studentId} onChange={(event) => setStudentId(event.target.value)} /></label>
            <div className={styles.label}>Position
              <SearchSelect ariaLabel="Position" value={position} onChange={setPosition} options={positions.map((option) => ({ value: option.value, label: option.label }))} searchPlaceholder="Search positions" />
            </div>
            <label className={styles.label}>Contact number <span className={styles.optionalLabel}>Optional</span><input className={styles.input} aria-label="Contact number" type="tel" placeholder="012-3456789" maxLength={30} value={contactNumber} onChange={(event) => setContactNumber(event.target.value)} /></label>
            {formError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><AlertCircle size={17} /><span>{formError}</span></div>}
            <div className={styles.buttonRow}>
              <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={closeModal}>Cancel</button>
              <button className={`${styles.button} ${styles.primaryButton}`} type="submit" disabled={busy}><UserPlus size={15} /> {editingId ? 'Save member' : 'Add member'}</button>
            </div>
          </form>
        </AdminModal>
      )}
      {modal === 'import' && (
        <AdminModal title="Import roster" wide onClose={() => setModal(null)}>
          <RosterImportPanel positions={positions} onDone={() => { setModal(null); setMessageKind('success'); setMessage('Import complete.') }} />
        </AdminModal>
      )}
      {message && <div className={`${styles.notice} ${messageKind === 'error' ? styles.noticeError : ''}`} role={messageKind === 'error' ? 'alert' : 'status'}>
        {messageKind === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{message}</span>
      </div>}

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={16} />
          <input className={styles.input} type="search" aria-label="Search roster" placeholder="Search name, ID, position, or group" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <span className={styles.resultCount}>{visibleRoster.length} of {roster.length} members</span>
      </div>

      {roster.length === 0 ? <div className={styles.emptyState}><UserPlus size={24} /><strong>No roster members yet</strong><span>Use Add member or Import above.</span></div> : visibleRoster.length === 0 ? (
        <div className={styles.emptyState}><Search size={24} /><strong>No matching members</strong><span>Try a different name, student ID, position, or group.</span></div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Member</th><th>Contact</th><th>Position</th><th>Practice group</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{visibleRoster.map((member) => (
              <tr key={member.id}>
                <td><strong className={styles.memberName}>{member.name}</strong><span className={styles.studentId}>{member.student_id}</span></td>
                <td data-label="Contact">{member.contact_number || <span className={styles.studentId}>—</span>}</td>
                <td data-label="Position"><span className={`${styles.positionBadge} ${styles[positionToneClass(member.position)]}`}>{positions.find((option) => option.value === member.position)?.label ?? member.position}</span></td>
                <td data-label="Practice group">{member.group_name ? <span className={styles.groupBadge}>{member.group_name}</span> : <span className={styles.studentId}>Not booked</span>}</td>
                <td data-label="Status"><span className={`${styles.statusBadge} ${member.active ? '' : styles.statusInactive}`}>{member.active ? 'Active' : 'Inactive'}</span></td>
                <td data-label="Actions">
                  <div className={styles.actions}>
                    <button className={`${styles.iconButton} ${styles.secondaryButton}`} type="button" aria-label={`Edit ${member.student_id}`} onClick={() => edit(member)}><Pencil size={14} /> Edit</button>
                    <button className={`${styles.iconButton} ${member.active ? styles.dangerButton : styles.successButton}`} type="button" disabled={busy} aria-label={`${member.active ? 'Deactivate' : 'Reactivate'} ${member.student_id}`} onClick={() => setActive(member, !member.active)}>{member.active ? <UserRoundX size={14} /> : <UserRoundCheck size={14} />}{member.active ? 'Deactivate' : 'Reactivate'}</button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
