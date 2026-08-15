'use client'

import React, { useCallback, useEffect, useState, useMemo } from 'react'
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

// --- Helpers ---

function toLocalTimeHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function combineLocal(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString()
}

// --- Styles ---

const inputStyle: React.CSSProperties = { padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '13.5px', fontFamily: 'inherit', color: '#0F172A', outline: 'none', transition: 'border-color 0.2s' }
const primaryBtnStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s, opacity 0.2s' }
const secondaryBtnStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontWeight: 600, fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s' }
const dangerBtnStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#FEE2E2', color: '#B91C1C', fontWeight: 700, fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s' }

// --- UI Components ---

function ConfirmDialog({ 
  title, 
  message, 
  onConfirm, 
  onCancel, 
  isDanger 
}: { 
  title: string; 
  message: string; 
  onConfirm: () => void; 
  onCancel: () => void; 
  isDanger?: boolean; 
}) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, opacity: 1, animation: 'fadeIn 0.2s ease-out' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', width: '90%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', animation: 'slideUp 0.2s ease-out' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 800, color: '#0F172A' }}>{title}</h3>
        <p style={{ margin: '0 0 24px 0', fontSize: '14.5px', color: '#64748B', lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
          <button type="button" onClick={onConfirm} style={isDanger ? dangerBtnStyle : primaryBtnStyle}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  const bg = type === 'success' ? '#DEF7EC' : '#FEE2E2'
  const color = type === 'success' ? '#03543F' : '#991B1B'
  const border = type === 'success' ? '#31C48D' : '#F87171'

  return (
    <div style={{ position: 'fixed', top: '24px', right: '24px', background: bg, color: color, borderLeft: `4px solid ${border}`, padding: '12px 20px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', zIndex: 9999, fontWeight: 600, fontSize: '14px', animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
      {message}
    </div>
  )
}

// --- Main Component ---

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

  // Dialog & Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void; isDanger?: boolean } | null>(null)

  // Duplicate prefill state
  const [prefillData, setPrefillData] = useState<{ startTime: string; endTime: string; location: string } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    setToast({ message, type })
  }, [])

  const showConfirm = useCallback((title: string, message: string, onConfirm: () => void, isDanger = true) => {
    setConfirmDialog({ title, message, onConfirm, isDanger })
  }, [])

  const closeConfirm = useCallback(() => setConfirmDialog(null), [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [{ data: s, error: sErr }, { data: m, error: mErr }] = await Promise.all([
      getMyPracticeGroupSessions(),
      getMyPracticeGroupMembers(),
    ])
    if (sErr || mErr) {
      setError((sErr || mErr)?.message ?? 'Failed to load group details.')
    }
    setSessions(s ?? [])
    setMembers(m ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function handleEditGroupOpen() {
    setGroupName(myGroup.name)
    setGroupCapacity(myGroup.capacity)
    setEditingGroup(true)
  }

  async function handleSaveGroup() {
    setSavingGroup(true)
    const { error: err } = await leadUpdateGroup(myGroup.group_id, groupName.trim(), groupCapacity)
    setSavingGroup(false)
    if (err) {
      showToast(err.message, 'error')
      return
    }
    showToast('Group updated successfully', 'success')
    setEditingGroup(false)
    onGroupChanged()
  }

  function handleRemoveMemberClick(memberId: string, memberName: string) {
    showConfirm(
      'Remove Member',
      `Are you sure you want to remove ${memberName} from this group?`,
      async () => {
        closeConfirm()
        const { error: err } = await leadRemoveMember(myGroup.group_id, memberId)
        if (err) {
          showToast(err.message, 'error')
          return
        }
        showToast('Member removed', 'success')
        load()
      },
      true
    )
  }

  const handleDuplicateSession = useCallback((session: PracticeSession) => {
    setPrefillData({
      startTime: toLocalTimeHHMM(session.starts_at),
      endTime: toLocalTimeHHMM(session.ends_at),
      location: session.location || ''
    })
    setActiveTab('sessions')
  }, [])

  if (loading) {
    return <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>
  }
  if (error) {
    return <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} onConfirm={confirmDialog.onConfirm} onCancel={closeConfirm} isDanger={confirmDialog.isDanger} />}

      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '24px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              {myGroup.is_lead ? 'You lead this group' : 'Your group'}
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>{myGroup.name}</h2>
            <p style={{ color: '#64748B', fontSize: '13.5px', margin: '4px 0 0' }}>
              Performance Lead: {myGroup.lead_name} · {myGroup.member_count}/{myGroup.capacity} members
            </p>
          </div>
          {myGroup.is_lead && !editingGroup && (
            <button type="button" onClick={handleEditGroupOpen} style={secondaryBtnStyle}>
              Edit group
            </button>
          )}
        </div>

        {editingGroup && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', background: '#F8FAFC', padding: '14px', borderRadius: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Group name</label>
              <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Capacity</label>
              <input type="number" min={1} value={groupCapacity} onChange={(e) => setGroupCapacity(Number(e.target.value))} style={{ ...inputStyle, width: '90px' }} />
            </div>
            <button type="button" disabled={savingGroup || !groupName.trim()} onClick={handleSaveGroup} style={primaryBtnStyle}>{savingGroup ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={() => setEditingGroup(false)} style={secondaryBtnStyle}>Cancel</button>
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #EAEEF4', background: '#F8FAFC' }}>
          <button
            type="button"
            onClick={() => setActiveTab('sessions')}
            style={{ flex: 1, padding: '16px 20px', border: 'none', background: activeTab === 'sessions' ? '#fff' : 'transparent', color: activeTab === 'sessions' ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '14.5px', cursor: 'pointer', borderRight: '1px solid #EAEEF4', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }}
          >
            Sessions
            <span style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'sessions' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{sessions.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('members')}
            style={{ flex: 1, padding: '16px 20px', border: 'none', background: activeTab === 'members' ? '#fff' : 'transparent', color: activeTab === 'members' ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '14.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }}
          >
            Members
            <span style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'members' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{members.length}</span>
          </button>
        </div>

        {activeTab === 'sessions' ? (
          <>
            {sessions.length === 0 && (
              <div style={{ padding: '24px', color: '#64748B', fontSize: '13.5px' }}>No sessions scheduled yet.</div>
            )}
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} editable={myGroup.is_lead} onChanged={load} showToast={showToast} showConfirm={closeConfirm => showConfirm} onDuplicate={() => handleDuplicateSession(s)} />
            ))}
            {myGroup.is_lead && <NewSessionForm groupId={myGroup.group_id} onCreated={load} showToast={showToast} existingSessions={sessions} prefillData={prefillData} onPrefillConsumed={() => setPrefillData(null)} />}
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
                  {myGroup.is_lead && (
                    <button type="button" onClick={() => handleRemoveMemberClick(m.member_id, m.member_name)} style={dangerBtnStyle}>Remove</button>
                  )}
                </div>
              </div>
            ))}
            {myGroup.is_lead && <AddMemberForm groupId={myGroup.group_id} onAdded={load} showToast={showToast} />}
          </>
        )}
      </div>
    </div>
  )
}

function SessionRow({ 
  session, 
  editable, 
  onChanged, 
  showToast, 
  showConfirm,
  onDuplicate
}: { 
  session: PracticeSession; 
  editable: boolean; 
  onChanged: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void, isDanger?: boolean) => void;
  onDuplicate: () => void;
}) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(() => toLocalDateIso(session.starts_at))
  const [startTime, setStartTime] = useState(() => toLocalTimeHHMM(session.starts_at))
  const [endTime, setEndTime] = useState(() => toLocalTimeHHMM(session.ends_at))
  const [location, setLocation] = useState(session.location || '')
  const [saving, setSaving] = useState(false)
  const [valError, setValError] = useState('')

  useEffect(() => {
    if (editing) {
      setDate(toLocalDateIso(session.starts_at))
      setStartTime(toLocalTimeHHMM(session.starts_at))
      setEndTime(toLocalTimeHHMM(session.ends_at))
      setLocation(session.location || '')
      setValError('')
    }
  }, [editing, session])

  async function handleSave() {
    setValError('')
    if (startTime >= endTime) {
      setValError('End time must be after start time')
      return
    }
    const selectedDate = new Date(date)
    const today = new Date()
    today.setHours(0,0,0,0)
    if (selectedDate < today) {
      setValError('Cannot schedule in the past')
      return
    }

    setSaving(true)
    const { error } = await leadUpdateSession(session.id, combineLocal(date, startTime), combineLocal(date, endTime), location)
    setSaving(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Session updated', 'success')
    setEditing(false)
    onChanged()
  }

  function handleDeleteClick() {
    showConfirm(
      'Delete Session',
      'Are you sure you want to delete this practice session?',
      async () => {
        const { error } = await leadDeleteSession(session.id)
        if (error) {
          showToast(error.message, 'error')
          return
        }
        showToast('Session deleted', 'success')
        onChanged()
      },
      true
    )
  }

  if (editing) {
    return (
      <div style={{ padding: '14px 24px', borderBottom: '1px solid #EAEEF4' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
          <span style={{ color: '#94A3B8' }}>–</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
          <input type="text" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} style={{ ...inputStyle, width: '160px' }} />
          <button type="button" disabled={saving} onClick={handleSave} style={primaryBtnStyle}>{saving ? 'Saving...' : 'Save'}</button>
          <button type="button" onClick={() => setEditing(false)} style={secondaryBtnStyle}>Cancel</button>
        </div>
        {valError && <div style={{ color: '#B91C1C', fontSize: '13px', marginTop: '8px', fontWeight: 600 }}>{valError}</div>}
      </div>
    )
  }

  return (
    <div style={{ padding: '14px 24px', borderBottom: '1px solid #EAEEF4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#0F172A' }}>{formatDateHeading(toLocalDateIso(session.starts_at))}</div>
        <div style={{ fontSize: '13px', color: '#64748B' }}>
          {formatTimeRange(session.starts_at, session.ends_at)}
          {session.location && <> · {session.location}</>}
        </div>
      </div>
      {editable && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={onDuplicate} style={secondaryBtnStyle}>Duplicate</button>
          <button type="button" onClick={() => setEditing(true)} style={secondaryBtnStyle}>Edit</button>
          <button type="button" onClick={handleDeleteClick} style={dangerBtnStyle}>Delete</button>
        </div>
      )}
    </div>
  )
}

function NewSessionForm({ 
  groupId, 
  onCreated, 
  showToast,
  existingSessions,
  prefillData,
  onPrefillConsumed
}: { 
  groupId: string; 
  onCreated: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  existingSessions: PracticeSession[];
  prefillData: { startTime: string; endTime: string; location: string } | null;
  onPrefillConsumed: () => void;
}) {
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)
  const [valError, setValError] = useState('')

  // Calculate smart defaults
  useEffect(() => {
    if (prefillData) {
      setStartTime(prefillData.startTime)
      setEndTime(prefillData.endTime)
      setLocation(prefillData.location)
      setDate('') // always clear date on duplicate
      onPrefillConsumed()
    } else if (existingSessions.length > 0 && !date && !startTime && !endTime && !location) {
      // Find most recent location
      const sorted = [...existingSessions].sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
      setLocation(sorted[0].location || '')

      // Find most common time pattern
      const patternCounts: Record<string, number> = {}
      existingSessions.forEach(s => {
        const pattern = `${toLocalTimeHHMM(s.starts_at)}|${toLocalTimeHHMM(s.ends_at)}`
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1
      })
      let mostCommon = ''
      let maxCount = 0
      Object.entries(patternCounts).forEach(([p, c]) => {
        if (c > maxCount) {
          maxCount = c
          mostCommon = p
        }
      })
      if (mostCommon) {
        const [st, et] = mostCommon.split('|')
        setStartTime(st)
        setEndTime(et)
      }
    }
  }, [existingSessions, prefillData, onPrefillConsumed, date, startTime, endTime, location])

  async function handleCreate() {
    setValError('')
    if (!date || !startTime || !endTime) {
      setValError('Please fill in date and time')
      return
    }
    if (startTime >= endTime) {
      setValError('End time must be after start time')
      return
    }
    const selectedDate = new Date(date)
    const today = new Date()
    today.setHours(0,0,0,0)
    if (selectedDate < today) {
      setValError('Cannot schedule in the past')
      return
    }

    setSaving(true)
    const { error } = await leadCreateSession(groupId, combineLocal(date, startTime), combineLocal(date, endTime), location)
    setSaving(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Session added', 'success')
    setDate('')
    // Keep location and time for easier chaining, or reset?
    // User often wants to add another session with same time/location.
    // Let's just clear date to prevent accidental duplicate submission on same day.
    onCreated()
  }

  return (
    <div style={{ padding: '16px 24px', background: '#FAFBFD' }}>
      <style>{`
        .ns-layout { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .ns-item { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; }
        .ns-date, .ns-loc, .ns-btn { min-width: 140px; }
        .ns-time { min-width: 200px; display: flex; align-items: center; gap: 10px; flex: 1 1 auto; }
        
        @media (max-width: 640px) {
          .ns-layout { flex-direction: column; align-items: stretch; }
          .ns-item { width: 100%; justify-content: space-between; }
          .ns-date input, .ns-loc input, .ns-btn button { width: 100%; }
          .ns-time { width: 100%; }
          .ns-time input { flex: 1; }
        }
      `}</style>
      
      <div className="ns-layout">
        <div className="ns-item ns-date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
        </div>
        <div className="ns-item ns-time">
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          <span style={{ color: '#94A3B8' }}>–</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        </div>
        <div className="ns-item ns-loc">
          <input type="text" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
        </div>
        <div className="ns-item ns-btn">
          <button type="button" disabled={saving} onClick={handleCreate} style={{ ...primaryBtnStyle, width: '100%' }}>{saving ? 'Adding...' : '+ Add session'}</button>
        </div>
      </div>
      
      {valError && <div style={{ color: '#B91C1C', fontSize: '13px', marginTop: '10px', fontWeight: 600 }}>{valError}</div>}
    </div>
  )
}

function AddMemberForm({ groupId, onAdded, showToast }: { groupId: string; onAdded: () => void; showToast: (msg: string, type?: 'success' | 'error') => void }) {
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
      <div style={{ padding: '16px 24px', background: '#FAFBFD' }}>
        <button type="button" onClick={handleOpen} style={primaryBtnStyle}>+ Add member</button>
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
          placeholder="Search by name or student ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: '100%', maxWidth: '260px' }}
        />
        <button type="button" onClick={() => setOpen(false)} style={secondaryBtnStyle}>Close</button>
      </div>
      {loading && <div style={{ fontSize: '13px', color: '#94A3B8' }}>Loading eligible members...</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ fontSize: '13px', color: '#94A3B8' }}>
          {candidates.length === 0 ? 'No eligible committee members to add.' : 'No matches.'}
        </div>
      )}
      {!loading && filtered.map((c) => (
        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '8px 12px', background: '#fff', border: '1px solid #EAEEF4', borderRadius: '8px' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '13.5px', color: '#0F172A' }}>{c.name}</div>
            <div style={{ fontSize: '12px', color: '#64748B' }}>{c.student_id ?? 'No student ID'} · {c.email}</div>
          </div>
          <button type="button" disabled={addingId === c.id} onClick={() => handleAdd(c.id)} style={primaryBtnStyle}>
            {addingId === c.id ? 'Adding...' : 'Add'}
          </button>
        </div>
      ))}
    </div>
  )
}
