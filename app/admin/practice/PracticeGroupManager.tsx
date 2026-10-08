'use client'

import { useEffect, useState } from 'react'
import {
  assignPracticeMemberAction,
  createPracticeGroupAction,
  deletePracticeGroupAction,
  deletePracticeSessionAction,
  movePracticeMemberAction,
  removePracticeBookingAction,
  savePracticeGroupDetailsAction,
  savePracticeSessionAction,
  updatePracticeGroupAction,
} from '@/app/actions/practiceAdminActions'
import type { AdminPracticeBooking, AdminPracticeGroup, AdminRosterMember, PracticeSession, PracticeSongType } from '@/lib/practice-types'
import { AlertCircle, ArrowRightLeft, CalendarClock, CheckCircle2, ChevronDown, Clock3, Film, Headphones, Layers3, MapPin, Pencil, Plus, Search, Trash2, UserRoundPlus, UsersRound, X } from 'lucide-react'
import { AdminModal } from './AdminModal'
import { ExportPracticeButton } from './ExportPracticeButton'
import { SearchSelect } from './SearchSelect'
import { addMinutesToDateTime, DateTimeField, formatInstant } from './DateTimeField'
import styles from './practice-admin.module.css'

type AdminSession = PracticeSession & { group_id: string }
type Props = { groups: AdminPracticeGroup[]; roster: AdminRosterMember[]; bookings: AdminPracticeBooking[]; sessions: AdminSession[]; positions?: Array<{ value: string; label: string }> }
type SessionDraft = { id?: string; startsAt: string; endsAt: string; location: string }
type DetailDraft = {
  songs: string
  leaderRosterMemberIds: string[]
  performanceVideoUrl: string
  songSourceType: PracticeSongType | ''
  songUrl: string
}

// Session scheduling is hidden for now; flip to bring it back.
const SHOW_SESSIONS = false

const emptySession: SessionDraft = { startsAt: '', endsAt: '', location: '' }
const emptyDetails: DetailDraft = { songs: '', leaderRosterMemberIds: [], performanceVideoUrl: '', songSourceType: '', songUrl: '' }

function detailsFor(group: AdminPracticeGroup): DetailDraft {
  return {
    songs: group.songs ?? '',
    leaderRosterMemberIds: group.leader_roster_member_ids,
    performanceVideoUrl: group.performance_video_url ?? '',
    songSourceType: group.song_source_type ?? '',
    songUrl: group.song_url ?? '',
  }
}

function localDateTime(value: string) {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/** Chips for the chosen leaders plus a searchable list to add more. */
function LeaderPicker({ ariaLabel, selected, options, onChange }: {
  ariaLabel: string
  selected: string[]
  options: Array<{ value: string; label: string; hint?: string }>
  onChange: (next: string[]) => void
}) {
  const chosen = selected.map((id) => options.find((option) => option.value === id)).filter((option): option is NonNullable<typeof option> => Boolean(option))
  return (
    <div className={styles.leaderPicker}>
      {chosen.length > 0 && (
        <ul className={styles.leaderChips} aria-label={`Selected ${ariaLabel}`}>
          {chosen.map((option) => (
            <li key={option.value} className={styles.leaderChip}>
              <span>{option.label}</span>
              <button type="button" aria-label={`Remove leader ${option.label}`} onClick={() => onChange(selected.filter((id) => id !== option.value))}><X size={12} /></button>
            </li>
          ))}
        </ul>
      )}
      <SearchSelect
        ariaLabel={ariaLabel}
        value=""
        onChange={(id) => { if (id && !selected.includes(id)) onChange([...selected, id]) }}
        options={options.filter((option) => !selected.includes(option.value))}
        placeholder={chosen.length > 0 ? 'Add another leader' : 'No leader selected — add one'}
        searchPlaceholder="Search name or student ID"
      />
    </div>
  )
}

export function PracticeGroupManager({ groups, roster, bookings, sessions, positions = [] }: Props) {
  const [newName, setNewName] = useState('')
  const [newCommitteeCapacity, setNewCommitteeCapacity] = useState(1)
  const [newFaciGmCapacity, setNewFaciGmCapacity] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [newDetails, setNewDetails] = useState<DetailDraft>(emptyDetails)
  const [newSongFile, setNewSongFile] = useState<File | null>(null)
  const [groupDrafts, setGroupDrafts] = useState<Record<string, {
    name: string
    committeeCapacity: number
    faciGmCapacity: number
  }>>({})
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [addingSession, setAddingSession] = useState<Record<string, boolean>>({})
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, SessionDraft>>({})
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null)
  const [addMemberQuery, setAddMemberQuery] = useState('')
  const [moves, setMoves] = useState<Record<string, string>>({})
  const [detailDrafts, setDetailDrafts] = useState<Record<string, DetailDraft>>({})
  const [songFiles, setSongFiles] = useState<Record<string, File | null>>({})
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)

  function toggleGroupEdit(groupId: string) {
    setEditingGroupId((current) => (current === groupId ? null : groupId))
  }

  function cancelGroupEdit(group: AdminPracticeGroup) {
    setGroupDrafts((current) => ({
      ...current,
      [group.id]: {
        name: group.name,
        committeeCapacity: group.committee_capacity,
        faciGmCapacity: group.faci_gm_capacity,
      },
    }))
    setEditingGroupId((current) => (current === group.id ? null : current))
  }

  function toggleAddSession(groupId: string) {
    const isCurrentlyAdding = Boolean(addingSession[groupId] || sessionDrafts[groupId]?.startsAt || sessionDrafts[groupId]?.location || sessionDrafts[groupId]?.id)
    if (isCurrentlyAdding) {
      setAddingSession((current) => ({ ...current, [groupId]: false }))
      setSessionDrafts((current) => ({ ...current, [groupId]: emptySession }))
    } else {
      setAddingSession((current) => ({ ...current, [groupId]: true }))
      setSessionDrafts((current) => ({ ...current, [groupId]: emptySession }))
    }
  }

  function cancelSessionEdit(groupId: string) {
    setAddingSession((current) => ({ ...current, [groupId]: false }))
    setSessionDrafts((current) => ({ ...current, [groupId]: emptySession }))
  }

  async function run(operation: () => Promise<{ error: string | null }>, success: string) {
    setBusy(true)
    setMessage(null)
    const result = await operation()
    setBusy(false)
    setIsError(Boolean(result.error))
    setMessage(result.error ?? success)
    return !result.error
  }

  function closeCreate() {
    setCreateOpen(false)
    setNewName('')
    setNewCommitteeCapacity(1)
    setNewFaciGmCapacity(1)
    setNewDetails(emptyDetails)
    setNewSongFile(null)
  }

  useEffect(() => {
    if (!createOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeCreate()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [createOpen])

  useEffect(() => {
    if (!editingGroupId) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !addMemberGroupId) setEditingGroupId(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editingGroupId, addMemberGroupId])

  async function createGroup(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const created = await createPracticeGroupAction({
      name: newName,
      committeeCapacity: newCommitteeCapacity,
      faciGmCapacity: newFaciGmCapacity,
    })
    const groupId = (created.data as { id?: string } | null)?.id
    if (created.error || !groupId) {
      setBusy(false)
      setIsError(true)
      setMessage(created.error ?? 'Group could not be created.')
      return
    }
    const hasDetails = Boolean(newDetails.songs || newDetails.leaderRosterMemberIds.length > 0 || newDetails.performanceVideoUrl || newDetails.songSourceType)
    if (hasDetails) {
      const body = new FormData()
      body.set('groupId', groupId)
      body.set('songs', newDetails.songs)
      newDetails.leaderRosterMemberIds.forEach((id) => body.append('leaderRosterMemberId', id))
      body.set('performanceVideoUrl', newDetails.performanceVideoUrl)
      body.set('songSourceType', newDetails.songSourceType)
      body.set('songUrl', newDetails.songUrl)
      if (newSongFile) body.set('songFile', newSongFile)
      const saved = await savePracticeGroupDetailsAction(body)
      if (saved.error) {
        setBusy(false)
        closeCreate()
        setIsError(true)
        setMessage(`Group created, but performance details were not saved: ${saved.error} Open Edit group to fix them.`)
        return
      }
    }
    setBusy(false)
    closeCreate()
    setIsError(false)
    setMessage('Group created.')
  }

  async function updateGroup(group: AdminPracticeGroup, status = group.status) {
    const draft = groupDrafts[group.id] ?? {
      name: group.name,
      committeeCapacity: group.committee_capacity,
      faciGmCapacity: group.faci_gm_capacity,
    }
    const success = await run(() => updatePracticeGroupAction({
      id: group.id,
      name: draft.name,
      committeeCapacity: draft.committeeCapacity,
      faciGmCapacity: draft.faciGmCapacity,
      status,
    }), 'Group updated.')
    if (success && status === group.status) {
      setEditingGroupId((current) => (current === group.id ? null : current))
    }
  }

  async function saveSession(group: AdminPracticeGroup) {
    const draft = sessionDrafts[group.id] ?? emptySession
    const success = await run(() => savePracticeSessionAction({
      ...(draft.id ? { id: draft.id } : {}), groupId: group.id, startsAt: draft.startsAt, endsAt: draft.endsAt, location: draft.location,
    }), draft.id ? 'Session updated.' : 'Session added.')
    if (success) {
      setSessionDrafts((current) => ({ ...current, [group.id]: emptySession }))
      setAddingSession((current) => ({ ...current, [group.id]: false }))
    }
  }

  async function saveDetails(group: AdminPracticeGroup) {
    const draft = detailDrafts[group.id] ?? detailsFor(group)
    const body = new FormData()
    body.set('groupId', group.id)
    body.set('songs', draft.songs)
    draft.leaderRosterMemberIds.forEach((id) => body.append('leaderRosterMemberId', id))
    body.set('performanceVideoUrl', draft.performanceVideoUrl)
    body.set('songSourceType', draft.songSourceType)
    body.set('songUrl', draft.songUrl)
    const songFile = songFiles[group.id]
    if (songFile) body.set('songFile', songFile)
    const success = await run(() => savePracticeGroupDetailsAction(body), 'Performance details saved.')
    if (success) setSongFiles((current) => ({ ...current, [group.id]: null }))
  }

  const leaderOptions = roster.filter((member) => member.active).map((member) => ({ value: member.id, label: member.name, hint: member.student_id }))
  const unbooked = roster.filter((member) => member.active && !member.booking_id)

  return (
    <section className={styles.section} aria-labelledby="groups-heading">
      <h2 id="groups-heading">Practice Group</h2>

      <div className={styles.createBar}>
        <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create a practice group</button>
        <ExportPracticeButton hasGroups={groups.length > 0} />
      </div>
      {createOpen && (
        <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate() }}>
          <form className={`${styles.modal} ${styles.modalCreate}`} role="dialog" aria-modal="true" aria-labelledby="create-group-title" onSubmit={createGroup}>
            <div className={styles.modalHeader}>
              <h3 id="create-group-title" className={styles.formHeading}><Plus size={17} /> Create a practice group</h3>
              <button type="button" className={styles.textCloseButton} aria-label="Close create group" onClick={closeCreate}><X size={14} /></button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.createGrid}>
                <label className={styles.label}>Group name<input className={styles.input} aria-label="New group name" placeholder="e.g. Stage Left" required autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
                <label className={styles.label}>Committee capacity<input className={styles.input} aria-label="New group committee capacity" type="number" min="0" required value={newCommitteeCapacity} onChange={(event) => setNewCommitteeCapacity(Number(event.target.value))} /></label>
                <label className={styles.label}>Faci/GM capacity<input className={styles.input} aria-label="New group Faci/GM capacity" type="number" min="0" required value={newFaciGmCapacity} onChange={(event) => setNewFaciGmCapacity(Number(event.target.value))} /></label>
              </div>
              <h4 className={styles.modalSubheading}><Film size={16} /> Performance details <span className={styles.optionalLabel}>Optional</span></h4>
              <div className={styles.detailsGrid}>
                <label className={styles.label}>Songs
                  <input className={styles.input} aria-label="New group songs" placeholder="e.g. Song 1, Song 2" value={newDetails.songs} onChange={(event) => setNewDetails((current) => ({ ...current, songs: event.target.value }))} />
                </label>
                <div className={styles.label}>Performance leaders
                  <LeaderPicker ariaLabel="New group performance leaders" selected={newDetails.leaderRosterMemberIds} options={leaderOptions} onChange={(leaderRosterMemberIds) => setNewDetails((current) => ({ ...current, leaderRosterMemberIds }))} />
                </div>
                <label className={`${styles.label} ${styles.detailsWide}`}>YouTube performance video
                  <input className={styles.input} aria-label="New group performance video" type="url" placeholder="https://youtube.com/watch?v=…" value={newDetails.performanceVideoUrl} onChange={(event) => setNewDetails((current) => ({ ...current, performanceVideoUrl: event.target.value }))} />
                </label>
              </div>
              <div className={styles.songPanel}>
                <div className={styles.songHeading}><Headphones size={16} /><div><strong>Song audio</strong><span>Optional · YouTube, MP3 upload, or external audio link</span></div></div>
                <div className={styles.songGrid}>
                  <label className={styles.label}>Song source
                    <select className={styles.select} aria-label="New group song source" value={newDetails.songSourceType} onChange={(event) => setNewDetails((current) => ({ ...current, songSourceType: event.target.value as PracticeSongType | '', songUrl: '' }))}>
                      <option value="">No song audio</option>
                      <option value="youtube">YouTube</option>
                      <option value="mp3">Upload MP3</option>
                      <option value="external">External audio link</option>
                    </select>
                  </label>
                  {(newDetails.songSourceType === 'youtube' || newDetails.songSourceType === 'external') && <label className={styles.label}>Song link
                    <input className={styles.input} aria-label="New group song link" type="url" placeholder={newDetails.songSourceType === 'youtube' ? 'https://youtube.com/watch?v=…' : 'https://example.com/song.mp3'} value={newDetails.songUrl} onChange={(event) => setNewDetails((current) => ({ ...current, songUrl: event.target.value }))} />
                  </label>}
                  {newDetails.songSourceType === 'mp3' && <label className={styles.label}>MP3 file
                    <input className={styles.fileInput} aria-label="New group MP3 file" type="file" accept="audio/mpeg,.mp3" onChange={(event) => setNewSongFile(event.target.files?.[0] ?? null)} />
                  </label>}
                </div>
              </div>
              <p className={styles.modalHint}>Sessions and members can be added after the group is created, using Edit group.</p>
            </div>
            <div className={styles.modalFooter}>
              <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={closeCreate}>Cancel</button>
              <button className={`${styles.button} ${styles.primaryButton}`} type="submit" disabled={busy}><Plus size={15} /> Create group</button>
            </div>
          </form>
        </div>
      )}
      {message && <div className={`${styles.notice} ${isError ? styles.noticeError : ''}`} role={isError ? 'alert' : 'status'}>{isError ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{message}</span></div>}
      {groups.length === 0 && <div className={styles.emptyState}><Layers3 size={25} /><strong>No practice groups yet</strong><span>Create the first group above, then add its sessions and members.</span></div>}
      <div className={styles.groupsGrid}>{groups.map((group) => {
        const groupBookings = bookings.filter((booking) => booking.group_id === group.id)
        const groupSessions = sessions.filter((session) => session.group_id === group.id)
        const groupDraft = groupDrafts[group.id] ?? {
          name: group.name,
          committeeCapacity: group.committee_capacity,
          faciGmCapacity: group.faci_gm_capacity,
        }
        const sessionDraft = sessionDrafts[group.id] ?? emptySession
        const detailDraft = detailDrafts[group.id] ?? detailsFor(group)
        const isEditingGroup = editingGroupId === group.id
        const isSessionFormOpen = Boolean(addingSession[group.id] || sessionDraft.id || sessionDraft.startsAt || sessionDraft.endsAt || sessionDraft.location)
        const committeeOccupancy = Math.min((group.committee_booking_count / Math.max(group.committee_capacity, 1)) * 100, 100)
        const faciGmOccupancy = Math.min((group.faci_gm_booking_count / Math.max(group.faci_gm_capacity, 1)) * 100, 100)
        return (
          <article className={styles.groupCard} key={group.id}>
            <header className={styles.groupHeader}>
              <h3 className={styles.groupName}>{group.name}</h3>
              <div className={styles.groupLeader}>
                <span className={styles.groupLeaderLabel}>{group.leader_names.length > 1 ? 'Leaders' : 'Leader'}</span>
                <span className={group.leader_names.length > 0 ? styles.groupLeaderName : styles.groupLeaderEmpty}>{group.leader_names.length > 0 ? group.leader_names.join(', ') : 'Not assigned'}</span>
              </div>
              <div className={styles.capacityPair}>
                <div>
                  <div className={styles.capacityHead}>
                    <span className={styles.capacityName}>Committee</span>
                    <span>{group.committee_booking_count} of {group.committee_capacity}</span>
                  </div>
                  <div className={styles.capacityTrack} role="meter" aria-label={`Committee seats for ${group.name}`} aria-valuemin={0} aria-valuemax={Math.max(group.committee_capacity, 0)} aria-valuenow={group.committee_booking_count}>
                    <div className={styles.capacityFill} style={{ width: `${committeeOccupancy}%` }} />
                  </div>
                </div>
                <div>
                  <div className={styles.capacityHead}>
                    <span className={`${styles.capacityName} ${styles.capacityNameFaci}`}>Faci/GM</span>
                    <span>{group.faci_gm_booking_count} of {group.faci_gm_capacity}</span>
                  </div>
                  <div className={`${styles.capacityTrack} ${styles.capacityTrackFaci}`} role="meter" aria-label={`Faci/GM seats for ${group.name}`} aria-valuemin={0} aria-valuemax={Math.max(group.faci_gm_capacity, 0)} aria-valuenow={group.faci_gm_booking_count}>
                    <div className={`${styles.capacityFill}`} style={{ width: `${faciGmOccupancy}%` }} />
                  </div>
                </div>
              </div>
              <div className={styles.groupHeaderActions}>
                <button
                  className={`${styles.button} ${styles.smallButton} ${styles.secondaryButton}`}
                  type="button"
                  aria-label={`Edit ${group.name}`}
                  aria-haspopup="dialog"
                  onClick={() => toggleGroupEdit(group.id)}
                >
                  <Pencil size={14} />
                  <span>Edit group</span>
                </button>
              </div>
            </header>

            {isEditingGroup && (<div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) cancelGroupEdit(group) }}><div className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true" aria-label={`${group.name} settings`}><div className={styles.modalScroll}>
            <div className={styles.groupSettingsPanel}>
                <div className={styles.settingsPanelHeader}>
                  <span className={styles.settingsPanelTitle}><Pencil size={14} /> Edit {group.name} settings<span className={`${styles.settingsStatus} ${group.status === 'open' ? '' : styles.settingsStatusClosed}`}>{group.status === 'open' ? 'Open for booking' : 'Closed'}</span></span>
                  <button
                    type="button"
                    className={styles.textCloseButton}
                    aria-label={`Close settings for ${group.name}`}
                    onClick={() => cancelGroupEdit(group)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className={styles.groupSettings}>
                  <label className={styles.label}>Group name<input className={styles.input} aria-label={`Group name for ${group.name}`} value={groupDraft.name} onChange={(event) => setGroupDrafts((current) => ({ ...current, [group.id]: { ...groupDraft, name: event.target.value } }))} /></label>
                  <label className={styles.label}>Committee capacity<input className={styles.input} aria-label={`Committee capacity for ${group.name}`} type="number" min="0" value={groupDraft.committeeCapacity} onChange={(event) => setGroupDrafts((current) => ({ ...current, [group.id]: { ...groupDraft, committeeCapacity: Number(event.target.value) } }))} /></label>
                  <label className={styles.label}>Faci/GM capacity<input className={styles.input} aria-label={`Faci/GM capacity for ${group.name}`} type="number" min="0" value={groupDraft.faciGmCapacity} onChange={(event) => setGroupDrafts((current) => ({ ...current, [group.id]: { ...groupDraft, faciGmCapacity: Number(event.target.value) } }))} /></label>
                  <div className={styles.settingsActions}>
                    <button className={`${styles.button} ${styles.primaryButton}`} type="button" disabled={busy} onClick={() => updateGroup(group)}><CheckCircle2 size={14} /> Save {group.name}</button>
                    <button className={`${styles.button} ${group.status === 'open' ? styles.dangerButton : styles.successButton}`} type="button" disabled={busy} aria-label={`${group.status === 'open' ? 'Close' : 'Open'} ${group.name}`} onClick={() => updateGroup(group, group.status === 'open' ? 'closed' : 'open')}>{group.status === 'open' ? 'Close booking' : 'Open booking'}</button>
                    <button className={`${styles.button} ${styles.secondaryButton}`} type="button" disabled={busy} onClick={() => cancelGroupEdit(group)}>Cancel</button>
                    <button className={`${styles.iconButton} ${styles.dangerButton} ${styles.dangerAside}`} type="button" disabled={busy} aria-label={`Delete ${group.name}`} onClick={() => run(() => deletePracticeGroupAction(group.id), 'Group deleted.')}><Trash2 size={14} /> Delete</button>
                  </div>
                </div>
              </div>

            <div className={styles.groupBody}>
              {SHOW_SESSIONS && (
              <div className={styles.groupSection}>
                <div className={styles.groupSectionHeader}>
                  <h4><CalendarClock size={16} /> Sessions <span className={styles.countPill}>{groupSessions.length}</span></h4>
                  <button
                    className={`${styles.button} ${styles.smallButton} ${isSessionFormOpen ? styles.secondaryButton : styles.primaryButton}`}
                    type="button"
                    aria-label={`${isSessionFormOpen ? 'Close add session form for' : 'Add new session to'} ${group.name}`}
                    onClick={() => toggleAddSession(group.id)}
                  >
                    {isSessionFormOpen ? <X size={13} /> : <Plus size={13} />}
                    <span>{isSessionFormOpen ? 'Cancel' : 'Add session'}</span>
                  </button>
                </div>
                {groupSessions.length === 0 ? (
                  <div className={`${styles.emptyState} ${styles.emptyInline}`}>
                    <Clock3 size={15} />
                    <span>No sessions scheduled yet.</span>
                    {!isSessionFormOpen && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => setAddingSession((current) => ({ ...current, [group.id]: true }))}
                      >
                        + Add the first session
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={styles.sessionList}>{groupSessions.map((session) => <div className={styles.sessionItem} key={session.id}>
                    <div className={styles.sessionInfo}><Clock3 size={16} /><span>{formatInstant(session.starts_at)} – {formatInstant(session.ends_at)}<small><MapPin size={11} /> {session.location || 'Location not set'}</small></span></div>
                    <div className={styles.inlineActions}>
                      <button className={`${styles.iconButton} ${styles.secondaryButton}`} type="button" aria-label={`Edit session ${session.location}`} onClick={() => {
                        setSessionDrafts((current) => ({ ...current, [group.id]: { id: session.id, startsAt: localDateTime(session.starts_at), endsAt: localDateTime(session.ends_at), location: session.location } }))
                        setAddingSession((current) => ({ ...current, [group.id]: true }))
                      }}><Pencil size={14} /> Edit</button>
                      <button className={`${styles.iconButton} ${styles.dangerButton}`} type="button" aria-label={`Delete session ${session.location}`} onClick={() => run(() => deletePracticeSessionAction(session.id), 'Session deleted.')}><Trash2 size={14} /> Delete</button>
                    </div>
                  </div>)}</div>
                )}
                {isSessionFormOpen && (
                  <div className={styles.sessionFormCard}>
                    <div className={styles.sessionFormHeader}>
                      <h5>
                        {sessionDraft.id ? <Pencil size={14} /> : <Plus size={14} />}
                        {sessionDraft.id ? 'Edit session details' : 'Add new session'}
                      </h5>
                      <button
                        type="button"
                        className={styles.textCloseButton}
                        aria-label={`Cancel session for ${group.name}`}
                        onClick={() => cancelSessionEdit(group.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className={styles.sessionForm}>
                      <DateTimeField label="Start" ariaLabel={`Session start for ${group.name}`} value={sessionDraft.startsAt} allowClear onChange={(startsAt) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, startsAt } }))} />
                      <DateTimeField
                        label="End"
                        ariaLabel={`Session end for ${group.name}`}
                        value={sessionDraft.endsAt}
                        allowClear
                        presets={sessionDraft.startsAt ? [
                          { label: '1 hour later', value: addMinutesToDateTime(sessionDraft.startsAt, 60) },
                          { label: '90 min later', value: addMinutesToDateTime(sessionDraft.startsAt, 90) },
                          { label: '2 hours later', value: addMinutesToDateTime(sessionDraft.startsAt, 120) },
                        ] : undefined}
                        onChange={(endsAt) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, endsAt } }))}
                      />
                      <label className={styles.label}>Location<input className={styles.input} aria-label={`Session location for ${group.name}`} placeholder="Room or venue" value={sessionDraft.location} onChange={(event) => setSessionDrafts((current) => ({ ...current, [group.id]: { ...sessionDraft, location: event.target.value } }))} /></label>
                      <div className={styles.sessionFormActions}>
                        <button className={`${styles.button} ${styles.primaryButton}`} type="button" aria-label={`${sessionDraft.id ? 'Save session for' : 'Add session to'} ${group.name}`} onClick={() => saveSession(group)}>{sessionDraft.id ? <CheckCircle2 size={14} /> : <Plus size={14} />}{sessionDraft.id ? 'Save session' : 'Add session'}</button>
                        <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={() => cancelSessionEdit(group.id)}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              )}

              <div className={styles.groupSection}>
                <div className={styles.groupSectionHeader}>
                  <h4><UsersRound size={16} /> Members <span className={styles.countPill}>{groupBookings.length}</span></h4>
                  <button className={`${styles.button} ${styles.smallButton} ${styles.primaryButton}`} type="button" aria-label={`Add member to ${group.name}`} onClick={() => { setAddMemberQuery(''); setAddMemberGroupId(group.id) }}>
                    <UserRoundPlus size={13} /> <span>Add member</span>
                  </button>
                </div>
                {groupBookings.length === 0 ? <div className={`${styles.emptyState} ${styles.emptyInline}`}><strong>No members yet.</strong><span>They can book themselves, or use Add member.</span></div> : <div className={styles.memberList}>{groupBookings.map((booking) => {
                  const member = roster.find((candidate) => candidate.id === booking.roster_member_id)
                  const positionLabel = positions.find((option) => option.value === member?.position)?.label ?? member?.position ?? '—'
                  const isEditingMember = editingMemberId === booking.id
                  return (
                    <div className={styles.memberItem} key={booking.id}>
                      <div className={styles.memberRow}>
                        <div className={styles.memberInfo}><UsersRound size={16} /><span><strong>{booking.member_name}</strong>
                          <small>{positionLabel}</small>
                          <small>{booking.student_id} · {member?.contact_number || 'No contact number'}</small></span></div>
                        <button className={`${styles.iconButton} ${styles.secondaryButton}`} type="button" aria-label={`${isEditingMember ? 'Done editing' : 'Edit'} ${booking.student_id}`} aria-expanded={isEditingMember} onClick={() => setEditingMemberId(isEditingMember ? null : booking.id)}>
                          {isEditingMember ? <CheckCircle2 size={14} /> : <Pencil size={14} />} {isEditingMember ? 'Done' : 'Edit'}
                        </button>
                      </div>
                      {isEditingMember && (
                        <div className={styles.inlineActions}>
                          <select className={styles.select} aria-label={`Move ${booking.student_id}`} value={moves[booking.id] ?? group.id} onChange={(event) => setMoves((current) => ({ ...current, [booking.id]: event.target.value }))}>
                            {groups.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                          </select>
                          <button className={`${styles.iconButton} ${styles.secondaryButton}`} type="button" aria-label={`Move ${booking.student_id}`} disabled={!moves[booking.id] || moves[booking.id] === group.id} onClick={async () => {
                            const destination = moves[booking.id]
                            const success = await run(() => movePracticeMemberAction(booking.id, destination), 'Member moved.')
                            if (success) { setMoves((current) => ({ ...current, [booking.id]: destination })); setEditingMemberId(null) }
                          }}><ArrowRightLeft size={14} /> Move</button>
                          <button className={`${styles.iconButton} ${styles.dangerButton}`} type="button" aria-label={`Remove ${booking.student_id}`} onClick={async () => {
                            const success = await run(() => removePracticeBookingAction(booking.id), 'Booking removed.')
                            if (success) setEditingMemberId(null)
                          }}><Trash2 size={14} /> Remove</button>
                        </div>
                      )}
                    </div>
                  )
                })}</div>}
              </div>

              <details
                className={styles.disclosure}
                open={previewOpen[group.id] ?? false}
                onToggle={(event) => {
                  const open = event.currentTarget.open
                  setPreviewOpen((current) => ({ ...current, [group.id]: open }))
                }}
              >
                <summary className={styles.disclosureSummary}><ChevronDown className={styles.disclosureChevron} size={16} aria-hidden="true" /> <Film size={16} /> Performance details <span className={styles.optionalLabel}>Optional</span></summary>
                <div className={styles.detailsGrid}>
                  <label className={styles.label}>Songs
                    <input className={styles.input} aria-label={`Songs for ${group.name}`} placeholder="e.g. Song 1, Song 2" value={detailDraft.songs} onChange={(event) => setDetailDrafts((current) => ({ ...current, [group.id]: { ...detailDraft, songs: event.target.value } }))} />
                  </label>
                  <div className={styles.label}>Performance leaders
                    <LeaderPicker ariaLabel={`Performance leaders for ${group.name}`} selected={detailDraft.leaderRosterMemberIds} options={leaderOptions} onChange={(leaderRosterMemberIds) => setDetailDrafts((current) => ({ ...current, [group.id]: { ...detailDraft, leaderRosterMemberIds } }))} />
                  </div>
                  <label className={`${styles.label} ${styles.detailsWide}`}>YouTube performance video
                    <input className={styles.input} aria-label={`Performance video for ${group.name}`} type="url" placeholder="https://youtube.com/watch?v=…" value={detailDraft.performanceVideoUrl} onChange={(event) => setDetailDrafts((current) => ({ ...current, [group.id]: { ...detailDraft, performanceVideoUrl: event.target.value } }))} />
                  </label>
                </div>

                <div className={styles.songPanel}>
                  <div className={styles.songHeading}><Headphones size={16} /><div><strong>Song audio</strong><span>Optional · YouTube, MP3 upload, or external audio link</span></div></div>
                  <div className={styles.songGrid}>
                    <label className={styles.label}>Song source
                      <select className={styles.select} aria-label={`Song source for ${group.name}`} value={detailDraft.songSourceType} onChange={(event) => setDetailDrafts((current) => ({ ...current, [group.id]: { ...detailDraft, songSourceType: event.target.value as PracticeSongType | '', songUrl: '' } }))}>
                        <option value="">No song audio</option>
                        <option value="youtube">YouTube</option>
                        <option value="mp3">Upload MP3</option>
                        <option value="external">External audio link</option>
                      </select>
                    </label>
                    {(detailDraft.songSourceType === 'youtube' || detailDraft.songSourceType === 'external') && <label className={styles.label}>Song link
                      <input className={styles.input} aria-label={`Song link for ${group.name}`} type="url" placeholder={detailDraft.songSourceType === 'youtube' ? 'https://youtube.com/watch?v=…' : 'https://example.com/song.mp3'} value={detailDraft.songUrl} onChange={(event) => setDetailDrafts((current) => ({ ...current, [group.id]: { ...detailDraft, songUrl: event.target.value } }))} />
                    </label>}
                    {detailDraft.songSourceType === 'mp3' && <label className={styles.label}>MP3 file
                      <input className={styles.fileInput} aria-label={`MP3 file for ${group.name}`} type="file" accept="audio/mpeg,.mp3" onChange={(event) => setSongFiles((current) => ({ ...current, [group.id]: event.target.files?.[0] ?? null }))} />
                    </label>}
                    <button className={`${styles.button} ${styles.primaryButton}`} type="button" aria-label={`Save performance details for ${group.name}`} disabled={busy} onClick={() => saveDetails(group)}><CheckCircle2 size={14} /> Save performance details</button>
                  </div>
                </div>
              </details>
            </div>
            </div></div></div>)}
            {addMemberGroupId === group.id && (() => {
              const needle = addMemberQuery.trim().toLowerCase()
              const matches = unbooked.filter((member) => !needle || [member.name, member.student_id, positions.find((option) => option.value === member.position)?.label ?? member.position].some((value) => value.toLowerCase().includes(needle)))
              return (
                <AdminModal title={`Add member to ${group.name}`} onClose={() => setAddMemberGroupId(null)}>
                  <div className={styles.addMemberBody}>
                    <div className={styles.searchWrap}>
                      <Search size={16} />
                      <input className={styles.input} type="search" aria-label="Search members to add" placeholder="Search name, ID, or position" value={addMemberQuery} onChange={(event) => setAddMemberQuery(event.target.value)} />
                    </div>
                    {matches.length === 0 ? <div className={`${styles.emptyState} ${styles.emptyInline}`}><span>{unbooked.length === 0 ? 'Every active member is already in a group.' : 'No matching members.'}</span></div> : (
                      <ul className={styles.pickList}>{matches.map((member) => (
                        <li key={member.id}>
                          <span><strong>{member.name}</strong><small>{positions.find((option) => option.value === member.position)?.label ?? member.position} · {member.student_id}</small></span>
                          <button className={`${styles.button} ${styles.smallButton} ${styles.primaryButton}`} type="button" aria-label={`Add ${member.student_id} to ${group.name}`} disabled={busy} onClick={async () => {
                            const success = await run(() => assignPracticeMemberAction(member.id, group.id), 'Member added to group.')
                            if (success) setAddMemberGroupId(null)
                          }}><UserRoundPlus size={13} /> Add</button>
                        </li>
                      ))}</ul>
                    )}
                  </div>
                </AdminModal>
              )
            })()}
          </article>
        )
      })}</div>
    </section>
  )
}
