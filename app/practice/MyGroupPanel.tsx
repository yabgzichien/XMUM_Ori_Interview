'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getMyPracticeGroupSessions,
  getMyPracticeGroupMembers,
  getLeadEligibleMembers,
  leadCreateSession,
  leadUpdateSession,
  leadDeleteSession,
  leadUpdateGroup,
  leadAddMember,
  leadRemoveMember,
  positionLabel,
  type MyGroup,
  type PracticeSession,
  type GroupMember,
  type EligibleMember,
} from '@/lib/practice'
import { formatDateHeading, formatTimeRange, toLocalDateIso } from '@/lib/booking-helpers'
import { Toast } from '@/components/Toast'

// --- Helpers ---

function toLocalTimeHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function combineLocal(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString()
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Minutes between two 'HH:MM' strings; negative if end precedes start. */
function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = ((h * 60 + m + minutes) % (24 * 60) + 24 * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

/** True if [aStart,aEnd) intersects [bStart,bEnd). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

type SessionDraft = { date: string; startTime: string; endTime: string; location: string }

/**
 * Validates a draft against the group's other sessions. Returns null when the
 * draft is fine, otherwise a message the form shows inline.
 */
function validateDraft(
  draft: SessionDraft,
  otherSessions: PracticeSession[],
): string | null {
  if (!draft.date) return 'Pick a date for this session.'
  if (!draft.startTime || !draft.endTime) return 'Set both a start and an end time.'
  if (minutesBetween(draft.startTime, draft.endTime) <= 0) return 'The end time has to be after the start time.'
  if (draft.date < todayIso()) return 'That date has already passed.'

  const start = new Date(`${draft.date}T${draft.startTime}`).getTime()
  const end = new Date(`${draft.date}T${draft.endTime}`).getTime()
  const clash = otherSessions.find((s) =>
    overlaps(start, end, new Date(s.starts_at).getTime(), new Date(s.ends_at).getTime()),
  )
  if (clash) {
    return `This overlaps an existing session on ${formatDateHeading(toLocalDateIso(clash.starts_at))} at ${formatTimeRange(clash.starts_at, clash.ends_at)}.`
  }
  return null
}

const DURATION_PRESETS = [30, 60, 90, 120]

// --- Styles ---

const inputStyle: React.CSSProperties = { padding: '9px 11px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '13.5px', fontFamily: 'inherit', color: '#0F172A', outline: 'none', background: '#fff', boxSizing: 'border-box', transition: 'border-color 0.2s' }
const primaryBtnStyle: React.CSSProperties = { padding: '9px 15px', borderRadius: '9px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s, opacity 0.2s' }
const secondaryBtnStyle: React.CSSProperties = { padding: '9px 14px', borderRadius: '9px', border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontWeight: 600, fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s' }
const dangerBtnStyle: React.CSSProperties = { padding: '9px 14px', borderRadius: '9px', border: 'none', background: '#FEE2E2', color: '#B91C1C', fontWeight: 700, fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s' }
const fieldLabelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '5px' }

// --- UI primitives ---

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  isDanger,
}: {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  isDanger?: boolean
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px', animation: 'fadeIn 0.2s ease-out' }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.12)', animation: 'slideUp 0.2s ease-out' }}
      >
        <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800, color: '#0F172A' }}>{title}</h3>
        <p style={{ margin: '0 0 24px 0', fontSize: '14.5px', color: '#64748B', lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
          <button type="button" onClick={onConfirm} style={isDanger ? dangerBtnStyle : primaryBtnStyle}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <div style={{ color: '#B91C1C', fontSize: '12.5px', marginTop: '10px', fontWeight: 600, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '8px 10px' }}>
      {message}
    </div>
  )
}

// --- Main component ---

export function MyGroupPanel({ myGroup, currentUserId, onGroupChanged }: { myGroup: MyGroup; currentUserId: string; onGroupChanged: () => void }) {
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'sessions' | 'members'>('sessions')

  const [editingGroup, setEditingGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupCapacity, setGroupCapacity] = useState(0)
  const [savingGroup, setSavingGroup] = useState(false)
  const [groupError, setGroupError] = useState<string | null>(null)

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<
    { title: string; message: string; confirmLabel?: string; onConfirm: () => void; isDanger?: boolean } | null
  >(null)

  // Remounting the create form with a new key resets it to fresh initial
  // values — cheaper and less surprising than syncing props into state.
  const [formSeed, setFormSeed] = useState(0)
  const [prefill, setPrefill] = useState<SessionDraft | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    setToast({ message, type })
  }, [])

  const closeConfirm = useCallback(() => setConfirmDialog(null), [])

  const showConfirm = useCallback(
    (title: string, message: string, onConfirm: () => void, options?: { isDanger?: boolean; confirmLabel?: string }) => {
      setConfirmDialog({
        title,
        message,
        confirmLabel: options?.confirmLabel,
        isDanger: options?.isDanger ?? true,
        onConfirm: () => {
          setConfirmDialog(null)
          onConfirm()
        },
      })
    },
    [],
  )

  // "Now" is captured when the data lands rather than read during render, so
  // the upcoming/past split stays a pure function of state.
  const [loadedAt, setLoadedAt] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const load = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    let active = true

    async function run() {
      const [{ data: s, error: sErr }, { data: m, error: mErr }] = await Promise.all([
        getMyPracticeGroupSessions(),
        getMyPracticeGroupMembers(),
      ])
      if (!active) return
      setError(sErr || mErr ? ((sErr || mErr)?.message ?? 'Failed to load group details.') : null)
      setSessions(s ?? [])
      setMembers(m ?? [])
      setLoadedAt(Date.now())
      setLoading(false)
    }

    run()
    return () => {
      active = false
    }
  }, [reloadToken])

  const { upcoming, past } = useMemo(() => {
    const up: PracticeSession[] = []
    const done: PracticeSession[] = []
    for (const s of sessions) {
      if (new Date(s.ends_at).getTime() >= loadedAt) up.push(s)
      else done.push(s)
    }
    up.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    done.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
    return { upcoming: up, past: done }
  }, [sessions, loadedAt])

  function handleEditGroupOpen() {
    setGroupName(myGroup.name)
    setGroupCapacity(myGroup.capacity)
    setGroupError(null)
    setEditingGroup(true)
  }

  async function handleSaveGroup() {
    if (!groupName.trim()) {
      setGroupError('The group needs a name.')
      return
    }
    if (groupCapacity < myGroup.member_count) {
      setGroupError(`Capacity can't be below the ${myGroup.member_count} member(s) already in the group.`)
      return
    }
    setSavingGroup(true)
    const { error: err } = await leadUpdateGroup(myGroup.group_id, groupName.trim(), groupCapacity)
    setSavingGroup(false)
    if (err) {
      setGroupError(err.message)
      return
    }
    showToast('Group updated', 'success')
    setEditingGroup(false)
    onGroupChanged()
  }

  function handleRemoveMemberClick(memberId: string, memberName: string) {
    showConfirm(
      'Remove member',
      `Remove ${memberName} from ${myGroup.name}? They can join another group afterwards.`,
      async () => {
        const { error: err } = await leadRemoveMember(myGroup.group_id, memberId)
        if (err) {
          showToast(err.message, 'error')
          return
        }
        showToast('Member removed', 'success')
        load()
      },
      { confirmLabel: 'Remove' },
    )
  }

  const handleDuplicateSession = useCallback((session: PracticeSession) => {
    setPrefill({
      date: '',
      startTime: toLocalTimeHHMM(session.starts_at),
      endTime: toLocalTimeHHMM(session.ends_at),
      location: session.location || '',
    })
    setFormSeed((n) => n + 1)
    setActiveTab('sessions')
    showToast('Times copied — pick a date to schedule it', 'success')
  }, [showToast])

  const handleCreated = useCallback(() => {
    setPrefill(null)
    setFormSeed((n) => n + 1)
    load()
  }, [load])

  const seatsLeft = Math.max(0, myGroup.capacity - myGroup.member_count)

  if (loading) {
    return <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading your group…</div>
  }
  if (error) {
    return <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
      <style>{`
        .mgp-tabpanel { background: #fff; border: 1px solid #EAEEF4; border-radius: 18px; box-shadow: 0 1px 2px rgba(16,24,40,.04); overflow: hidden; }
        .mgp-session-row { padding: 14px 24px; border-bottom: 1px solid #EAEEF4; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
        .mgp-form-grid { display: grid; grid-template-columns: 1.1fr 1fr 1fr 1.2fr; gap: 12px; }
        .mgp-edit-grid { display: grid; grid-template-columns: 1.1fr 1fr 1fr 1.2fr; gap: 10px; }
        @media (max-width: 760px) {
          .mgp-form-grid, .mgp-edit-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 480px) {
          .mgp-form-grid, .mgp-edit-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {toast && <Toast message={toast.message} kind={toast.type} onClose={() => setToast(null)} />}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={closeConfirm}
          isDanger={confirmDialog.isDanger}
        />
      )}

      {/* ── Group header ─────────────────────────────────────────────── */}
      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '24px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: editingGroup ? '14px' : 0, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              {myGroup.is_lead ? 'You lead this group' : 'Your group'}
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>{myGroup.name}</h2>
            <p style={{ color: '#64748B', fontSize: '13.5px', margin: '4px 0 0' }}>
              Performance Lead: {myGroup.lead_name} · {myGroup.member_count}/{myGroup.capacity} members
              {seatsLeft > 0 ? ` · ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left` : ' · full'}
            </p>
          </div>
          {myGroup.is_lead && !editingGroup && (
            <button type="button" onClick={handleEditGroupOpen} style={secondaryBtnStyle}>Edit group</button>
          )}
        </div>

        {editingGroup && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', background: '#F8FAFC', padding: '14px', borderRadius: '10px' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={fieldLabelStyle} htmlFor="mgp-group-name">Group name</label>
              <input id="mgp-group-name" type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div>
              <label style={fieldLabelStyle} htmlFor="mgp-group-capacity">Capacity</label>
              <input id="mgp-group-capacity" type="number" min={1} value={groupCapacity} onChange={(e) => setGroupCapacity(Number(e.target.value))} style={{ ...inputStyle, width: '90px' }} />
            </div>
            <button type="button" disabled={savingGroup} onClick={handleSaveGroup} style={{ ...primaryBtnStyle, opacity: savingGroup ? 0.7 : 1 }}>
              {savingGroup ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditingGroup(false)} style={secondaryBtnStyle}>Cancel</button>
            {groupError && <div style={{ flexBasis: '100%' }}><InlineError message={groupError} /></div>}
          </div>
        )}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="mgp-tabpanel">
        <div style={{ display: 'flex', borderBottom: '1px solid #EAEEF4', background: '#F8FAFC' }}>
          {([
            { key: 'sessions' as const, label: 'Sessions', count: upcoming.length },
            { key: 'members' as const, label: 'Members', count: members.length },
          ]).map((tab, idx) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{ flex: 1, padding: '16px 20px', border: 'none', background: activeTab === tab.key ? '#fff' : 'transparent', color: activeTab === tab.key ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '14.5px', cursor: 'pointer', borderRight: idx === 0 ? '1px solid #EAEEF4' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }}
            >
              {tab.label}
              <span style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === tab.key ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {activeTab === 'sessions' ? (
          <>
            {myGroup.is_lead && (
              <NewSessionForm
                key={formSeed}
                groupId={myGroup.group_id}
                initial={prefill ?? defaultDraftFrom(sessions)}
                existingSessions={sessions}
                onCreated={handleCreated}
                showToast={showToast}
              />
            )}

            <SessionSection
              title="Upcoming"
              emptyMessage={myGroup.is_lead ? 'Nothing scheduled yet — add your first session above.' : 'Your lead hasn’t scheduled a session yet.'}
              sessions={upcoming}
              editable={myGroup.is_lead}
              allSessions={sessions}
              onChanged={load}
              showToast={showToast}
              showConfirm={showConfirm}
              onDuplicate={handleDuplicateSession}
            />

            {past.length > 0 && (
              <SessionSection
                title="Past"
                emptyMessage=""
                sessions={past}
                editable={false}
                allSessions={sessions}
                onChanged={load}
                showToast={showToast}
                showConfirm={showConfirm}
                onDuplicate={handleDuplicateSession}
                muted
              />
            )}
          </>
        ) : (
          <>
            {members.length === 0 && (
              <div style={{ padding: '24px', color: '#64748B', fontSize: '13.5px' }}>No members yet.</div>
            )}
            {members.map((m) => (
              <div key={m.member_id} style={{ padding: '14px 24px', borderBottom: '1px solid #EAEEF4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#0F172A' }}>
                  {m.member_name}
                  {m.member_id === currentUserId && <span style={{ color: '#2563EB', fontWeight: 700 }}> (You)</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '11.5px', fontWeight: 700, background: m.position ? '#EFF4FF' : '#F1F5F9', color: m.position ? '#2563EB' : '#94A3B8' }}>
                    {positionLabel(m.position)}
                  </span>
                  {myGroup.is_lead && m.member_id !== myGroup.lead_id && (
                    <button type="button" onClick={() => handleRemoveMemberClick(m.member_id, m.member_name)} style={dangerBtnStyle}>Remove</button>
                  )}
                </div>
              </div>
            ))}
            {myGroup.is_lead && (
              <AddMemberForm
                groupId={myGroup.group_id}
                seatsLeft={seatsLeft}
                onAdded={load}
                showToast={showToast}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Seeds the create form from the group's habits: the most-used time pattern and
 * the most recent location, so a weekly rehearsal is one date-click away.
 */
function defaultDraftFrom(sessions: PracticeSession[]): SessionDraft {
  if (sessions.length === 0) {
    return { date: '', startTime: '', endTime: '', location: '' }
  }
  const byRecency = [...sessions].sort(
    (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
  )

  const counts = new Map<string, number>()
  for (const s of sessions) {
    const key = `${toLocalTimeHHMM(s.starts_at)}|${toLocalTimeHHMM(s.ends_at)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = key
    }
  }
  const [startTime = '', endTime = ''] = best.split('|')
  return { date: '', startTime, endTime, location: byRecency[0].location || '' }
}

function SessionSection({
  title,
  emptyMessage,
  sessions,
  editable,
  allSessions,
  onChanged,
  showToast,
  showConfirm,
  onDuplicate,
  muted,
}: {
  title: string
  emptyMessage: string
  sessions: PracticeSession[]
  editable: boolean
  allSessions: PracticeSession[]
  onChanged: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
  showConfirm: (title: string, message: string, onConfirm: () => void, options?: { isDanger?: boolean; confirmLabel?: string }) => void
  onDuplicate: (session: PracticeSession) => void
  muted?: boolean
}) {
  return (
    <div style={{ opacity: muted ? 0.72 : 1 }}>
      <div style={{ padding: '12px 24px', background: '#FAFBFD', borderBottom: '1px solid #EAEEF4', borderTop: '1px solid #EAEEF4', fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title} · {sessions.length}
      </div>
      {sessions.length === 0 ? (
        emptyMessage ? <div style={{ padding: '24px', color: '#64748B', fontSize: '13.5px' }}>{emptyMessage}</div> : null
      ) : (
        sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            editable={editable}
            allSessions={allSessions}
            onChanged={onChanged}
            showToast={showToast}
            showConfirm={showConfirm}
            onDuplicate={() => onDuplicate(s)}
          />
        ))
      )}
    </div>
  )
}

function SessionRow({
  session,
  editable,
  allSessions,
  onChanged,
  showToast,
  showConfirm,
  onDuplicate,
}: {
  session: PracticeSession
  editable: boolean
  allSessions: PracticeSession[]
  onChanged: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
  showConfirm: (title: string, message: string, onConfirm: () => void, options?: { isDanger?: boolean; confirmLabel?: string }) => void
  onDuplicate: () => void
}) {
  const [draft, setDraft] = useState<SessionDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [valError, setValError] = useState('')

  const otherSessions = useMemo(
    () => allSessions.filter((s) => s.id !== session.id),
    [allSessions, session.id],
  )

  function startEditing() {
    setValError('')
    setDraft({
      date: toLocalDateIso(session.starts_at),
      startTime: toLocalTimeHHMM(session.starts_at),
      endTime: toLocalTimeHHMM(session.ends_at),
      location: session.location || '',
    })
  }

  async function handleSave() {
    if (!draft) return
    const problem = validateDraft(draft, otherSessions)
    if (problem) {
      setValError(problem)
      return
    }
    setValError('')
    setSaving(true)
    const { error } = await leadUpdateSession(
      session.id,
      combineLocal(draft.date, draft.startTime),
      combineLocal(draft.date, draft.endTime),
      draft.location.trim(),
    )
    setSaving(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Session updated', 'success')
    setDraft(null)
    onChanged()
  }

  function handleDeleteClick() {
    showConfirm(
      'Delete session',
      `Delete the session on ${formatDateHeading(toLocalDateIso(session.starts_at))} at ${formatTimeRange(session.starts_at, session.ends_at)}? Members will no longer see it.`,
      async () => {
        const { error } = await leadDeleteSession(session.id)
        if (error) {
          showToast(error.message, 'error')
          return
        }
        showToast('Session deleted', 'success')
        onChanged()
      },
      { confirmLabel: 'Delete' },
    )
  }

  if (draft) {
    const durationMinutes = minutesBetween(draft.startTime, draft.endTime)
    return (
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #EAEEF4', background: '#FAFBFD' }}>
        <div className="mgp-edit-grid">
          <div>
            <label style={fieldLabelStyle}>Date</label>
            <input type="date" min={todayIso()} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={fieldLabelStyle}>Starts</label>
            <input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={fieldLabelStyle}>Ends</label>
            <input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={fieldLabelStyle}>Location</label>
            <input type="text" placeholder="e.g. Studio B" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button type="button" disabled={saving} onClick={handleSave} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save changes'}</button>
          <button type="button" onClick={() => setDraft(null)} style={secondaryBtnStyle}>Cancel</button>
          {durationMinutes > 0 && (
            <span style={{ fontSize: '12.5px', color: '#64748B', fontWeight: 600 }}>{formatDuration(durationMinutes)}</span>
          )}
        </div>
        {valError && <InlineError message={valError} />}
      </div>
    )
  }

  const duration = formatDuration(
    Math.round((new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60000),
  )

  return (
    <div className="mgp-session-row">
      <div>
        <div style={{ fontWeight: 700, fontSize: '14px', color: '#0F172A' }}>{formatDateHeading(toLocalDateIso(session.starts_at))}</div>
        <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
          {formatTimeRange(session.starts_at, session.ends_at)}
          {duration && <span style={{ color: '#94A3B8' }}> · {duration}</span>}
          {session.location && <> · 📍 {session.location}</>}
        </div>
      </div>
      {editable && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" onClick={onDuplicate} style={secondaryBtnStyle} title="Reuse these times for another date">Duplicate</button>
          <button type="button" onClick={startEditing} style={secondaryBtnStyle}>Edit</button>
          <button type="button" onClick={handleDeleteClick} style={dangerBtnStyle}>Delete</button>
        </div>
      )}
    </div>
  )
}

function NewSessionForm({
  groupId,
  initial,
  existingSessions,
  onCreated,
  showToast,
}: {
  groupId: string
  initial: SessionDraft
  existingSessions: PracticeSession[]
  onCreated: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [draft, setDraft] = useState<SessionDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [valError, setValError] = useState('')

  const durationMinutes = draft.startTime && draft.endTime ? minutesBetween(draft.startTime, draft.endTime) : 0

  /** Picking a preset keeps the start time and moves the end time. */
  function applyPreset(minutes: number) {
    const start = draft.startTime || '19:00'
    setDraft({ ...draft, startTime: start, endTime: addMinutes(start, minutes) })
    setValError('')
  }

  function updateStart(startTime: string) {
    // Keep the current length when the start slides, which is what a lead
    // almost always means by "move it half an hour later".
    const keep = durationMinutes > 0 ? durationMinutes : 0
    setDraft({ ...draft, startTime, endTime: keep > 0 ? addMinutes(startTime, keep) : draft.endTime })
  }

  const preview =
    draft.date && draft.startTime && draft.endTime && minutesBetween(draft.startTime, draft.endTime) > 0
      ? `${formatDateHeading(draft.date)} · ${formatTimeRange(
          combineLocal(draft.date, draft.startTime),
          combineLocal(draft.date, draft.endTime),
        )} · ${formatDuration(durationMinutes)}${draft.location.trim() ? ` · ${draft.location.trim()}` : ''}`
      : null

  async function handleCreate() {
    const problem = validateDraft(draft, existingSessions)
    if (problem) {
      setValError(problem)
      return
    }
    setValError('')
    setSaving(true)
    const { error } = await leadCreateSession(
      groupId,
      combineLocal(draft.date, draft.startTime),
      combineLocal(draft.date, draft.endTime),
      draft.location.trim(),
    )
    setSaving(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Session added', 'success')
    onCreated()
  }

  return (
    <div style={{ padding: '18px 24px', background: '#FAFBFD', borderBottom: '1px solid #EAEEF4' }}>
      <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A', marginBottom: '12px' }}>Schedule a practice session</div>

      <div className="mgp-form-grid">
        <div>
          <label style={fieldLabelStyle} htmlFor="ns-date">Date</label>
          <input
            id="ns-date"
            type="date"
            min={todayIso()}
            value={draft.date}
            onChange={(e) => { setDraft({ ...draft, date: e.target.value }); setValError('') }}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={fieldLabelStyle} htmlFor="ns-start">Starts</label>
          <input
            id="ns-start"
            type="time"
            value={draft.startTime}
            onChange={(e) => { updateStart(e.target.value); setValError('') }}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={fieldLabelStyle} htmlFor="ns-end">Ends</label>
          <input
            id="ns-end"
            type="time"
            value={draft.endTime}
            onChange={(e) => { setDraft({ ...draft, endTime: e.target.value }); setValError('') }}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={fieldLabelStyle} htmlFor="ns-location">Location <span style={{ color: '#94A3B8', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          <input
            id="ns-location"
            type="text"
            placeholder="e.g. Studio B"
            value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 700, marginRight: '2px' }}>Length</span>
        {DURATION_PRESETS.map((minutes) => {
          const active = durationMinutes === minutes
          return (
            <button
              key={minutes}
              type="button"
              onClick={() => applyPreset(minutes)}
              style={{
                padding: '5px 12px',
                borderRadius: '99px',
                border: `1px solid ${active ? '#2563EB' : '#E2E8F0'}`,
                background: active ? '#EFF4FF' : '#fff',
                color: active ? '#2563EB' : '#64748B',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all .12s',
              }}
            >
              {formatDuration(minutes)}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '14px' }}>
        <div style={{ fontSize: '12.5px', color: preview ? '#334155' : '#94A3B8', fontWeight: 600 }}>
          {preview ?? 'Fill in a date and time to preview the session.'}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={handleCreate}
          style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Adding…' : '+ Add session'}
        </button>
      </div>

      {valError && <InlineError message={valError} />}
    </div>
  )
}

function AddMemberForm({
  groupId,
  seatsLeft,
  onAdded,
  showToast,
}: {
  groupId: string
  seatsLeft: number
  onAdded: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<EligibleMember[]>([])
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)

  async function handleOpen() {
    setOpen(true)
    setLoading(true)
    const { data, error } = await getLeadEligibleMembers(groupId)
    setLoading(false)
    if (error) {
      showToast(error.message, 'error')
      setOpen(false)
      return
    }
    setCandidates(data ?? [])
  }

  async function handleAdd(memberId: string) {
    setAddingId(memberId)
    const { error } = await leadAddMember(groupId, memberId)
    setAddingId(null)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Member added', 'success')
    setCandidates((prev) => prev.filter((c) => c.id !== memberId))
    onAdded()
  }

  if (!open) {
    return (
      <div style={{ padding: '16px 24px', background: '#FAFBFD', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button type="button" onClick={handleOpen} disabled={seatsLeft === 0} style={{ ...primaryBtnStyle, background: seatsLeft === 0 ? '#CBD5E1' : '#2563EB', cursor: seatsLeft === 0 ? 'not-allowed' : 'pointer' }}>
          + Add member
        </button>
        <span style={{ fontSize: '12.5px', color: '#94A3B8', fontWeight: 600 }}>
          {seatsLeft === 0 ? 'Group is full — raise the capacity to add more.' : `${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left`}
        </span>
      </div>
    )
  }

  const query = search.trim().toLowerCase()
  const filtered = query
    ? candidates.filter((c) => c.name.toLowerCase().includes(query) || (c.student_id ?? '').toLowerCase().includes(query))
    : candidates

  return (
    <div style={{ padding: '16px 24px', background: '#FAFBFD', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search by name or student ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 220px', maxWidth: '280px' }}
        />
        <button type="button" onClick={() => setOpen(false)} style={secondaryBtnStyle}>Close</button>
      </div>
      {loading && <div style={{ fontSize: '13px', color: '#94A3B8' }}>Loading eligible members…</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ fontSize: '13px', color: '#94A3B8' }}>
          {candidates.length === 0
            ? 'No eligible committee members left — everyone in this orientation is already in a group.'
            : 'No matches.'}
        </div>
      )}
      {!loading && filtered.map((c) => (
        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#fff', border: '1px solid #EAEEF4', borderRadius: '10px' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '13.5px', color: '#0F172A' }}>{c.name}</div>
            <div style={{ fontSize: '12px', color: '#64748B' }}>{c.student_id ?? 'No student ID'} · {c.email}</div>
          </div>
          <button type="button" disabled={addingId === c.id || seatsLeft === 0} onClick={() => handleAdd(c.id)} style={primaryBtnStyle}>
            {addingId === c.id ? 'Adding…' : 'Add'}
          </button>
        </div>
      ))}
    </div>
  )
}
