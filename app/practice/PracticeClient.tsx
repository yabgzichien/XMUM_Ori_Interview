'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  getMyPracticeGroup,
  getMyPracticeGroupSessions,
  getMyPracticeGroupMembers,
  getAvailablePracticeGroups,
  joinPracticeGroup,
  leavePracticeGroup,
  leadCreateSession,
  leadUpdateSession,
  leadDeleteSession,
  type MyGroup,
  type PracticeSession,
  type GroupMember,
  type AvailableGroup,
} from '@/lib/practice'
import { formatDateHeading, formatTimeRange, toLocalDateIso } from '@/lib/booking-helpers'

// Local-time "HH:MM" for a fixed ISO timestamp, kept out of the render path
// itself (plain module function, same convention as lib/booking-helpers.ts)
// per the react-hooks/purity rule on new Date() in component bodies.
function toLocalTimeHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function combineLocal(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString()
}

const inputStyle: React.CSSProperties = { padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '13.5px', fontFamily: 'inherit', color: '#0F172A', outline: 'none' }
const primaryBtnStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }
const secondaryBtnStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }
const dangerBtnStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#FEE2E2', color: '#B91C1C', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }

export function PracticeClient() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myGroup, setMyGroup] = useState<MyGroup | null>(null)
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[]>([])
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data: group, error: groupErr } = await getMyPracticeGroup()
    if (groupErr) {
      setError(groupErr.message)
      setLoading(false)
      return
    }
    setMyGroup(group)

    if (group) {
      const [{ data: s, error: sErr }, { data: m, error: mErr }] = await Promise.all([
        getMyPracticeGroupSessions(),
        getMyPracticeGroupMembers(),
      ])
      if (sErr || mErr) {
        setError((sErr || mErr)?.message ?? 'Failed to load group details.')
      }
      setSessions(s ?? [])
      setMembers(m ?? [])
      setAvailableGroups([])
    } else {
      const { data: groups, error: groupsErr } = await getAvailablePracticeGroups()
      if (groupsErr) {
        setError(groupsErr.message)
      }
      setAvailableGroups(groups ?? [])
      setSessions([])
      setMembers([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleJoin(groupId: string) {
    setJoiningId(groupId)
    const { error: joinErr } = await joinPracticeGroup(groupId)
    setJoiningId(null)
    if (joinErr) {
      alert(joinErr.message)
      return
    }
    load()
  }

  async function handleLeave() {
    if (!window.confirm('Leave this practice group?')) return
    setLeaving(true)
    const { error: leaveErr } = await leavePracticeGroup()
    setLeaving(false)
    if (leaveErr) {
      alert(leaveErr.message)
      return
    }
    load()
  }

  if (loading) {
    return <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>
  }
  if (error) {
    return <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>
  }

  if (!myGroup) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {availableGroups.length === 0 && (
          <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '32px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
            No practice groups are open yet. Check back soon.
          </div>
        )}
        {availableGroups.map((g) => {
          const joinable = g.seats_left > 0 && g.status === 'open'
          return (
            <div key={g.id} style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '20px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px' }}>{g.name}</div>
                <div style={{ fontSize: '13px', color: '#64748B' }}>
                  Led by {g.lead_name} · {g.session_count} session{g.session_count === 1 ? '' : 's'} scheduled
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: joinable ? '#2563EB' : '#94A3B8' }}>{g.seats_left}</div>
                  <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>seats left</div>
                </div>
                <button
                  type="button"
                  disabled={!joinable || joiningId === g.id}
                  onClick={() => handleJoin(g.id)}
                  style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: joinable ? '#2563EB' : '#CBD5E1', color: '#fff', fontWeight: 700, fontSize: '13.5px', cursor: joinable ? 'pointer' : 'not-allowed' }}
                >
                  {joiningId === g.id ? 'Joining...' : g.status !== 'open' ? 'Closed' : g.seats_left > 0 ? 'Join group' : 'Full'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '24px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              {myGroup.is_lead ? 'You lead this group' : 'Your group'}
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>{myGroup.name}</h2>
            <p style={{ color: '#64748B', fontSize: '13.5px', margin: '4px 0 0' }}>
              Led by {myGroup.lead_name} · {myGroup.member_count}/{myGroup.capacity} members
            </p>
          </div>
          {!myGroup.is_lead && (
            <button type="button" disabled={leaving} onClick={handleLeave} style={{ padding: '9px 16px', borderRadius: '9px', border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#B91C1C', fontWeight: 700, fontSize: '13px', cursor: leaving ? 'not-allowed' : 'pointer' }}>
              {leaving ? 'Leaving...' : 'Leave group'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {members.map((m) => (
            <span key={m.member_id} style={{ padding: '5px 11px', borderRadius: '99px', background: '#F1F5F9', color: '#334155', fontSize: '12.5px', fontWeight: 600 }}>
              {m.member_name}
            </span>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #EAEEF4', fontWeight: 700, fontSize: '15px' }}>Practice sessions</div>
        {sessions.length === 0 && (
          <div style={{ padding: '24px', color: '#64748B', fontSize: '13.5px' }}>No sessions scheduled yet.</div>
        )}
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} editable={myGroup.is_lead} onChanged={load} />
        ))}
        {myGroup.is_lead && <NewSessionForm groupId={myGroup.group_id} onCreated={load} />}
      </div>
    </div>
  )
}

function SessionRow({ session, editable, onChanged }: { session: PracticeSession; editable: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(() => toLocalDateIso(session.starts_at))
  const [startTime, setStartTime] = useState(() => toLocalTimeHHMM(session.starts_at))
  const [endTime, setEndTime] = useState(() => toLocalTimeHHMM(session.ends_at))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await leadUpdateSession(session.id, combineLocal(date, startTime), combineLocal(date, endTime))
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    setEditing(false)
    onChanged()
  }

  async function handleDelete() {
    if (!window.confirm('Delete this practice session?')) return
    const { error } = await leadDeleteSession(session.id)
    if (error) {
      alert(error.message)
      return
    }
    onChanged()
  }

  if (editing) {
    return (
      <div style={{ padding: '14px 24px', borderBottom: '1px solid #EAEEF4', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
        <span style={{ color: '#94A3B8' }}>–</span>
        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
        <button type="button" disabled={saving} onClick={handleSave} style={primaryBtnStyle}>{saving ? 'Saving...' : 'Save'}</button>
        <button type="button" onClick={() => setEditing(false)} style={secondaryBtnStyle}>Cancel</button>
      </div>
    )
  }

  return (
    <div style={{ padding: '14px 24px', borderBottom: '1px solid #EAEEF4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#0F172A' }}>{formatDateHeading(toLocalDateIso(session.starts_at))}</div>
        <div style={{ fontSize: '13px', color: '#64748B' }}>{formatTimeRange(session.starts_at, session.ends_at)}</div>
      </div>
      {editable && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={() => setEditing(true)} style={secondaryBtnStyle}>Edit</button>
          <button type="button" onClick={handleDelete} style={dangerBtnStyle}>Delete</button>
        </div>
      )}
    </div>
  )
}

function NewSessionForm({ groupId, onCreated }: { groupId: string; onCreated: () => void }) {
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!date || !startTime || !endTime) return
    setSaving(true)
    const { error } = await leadCreateSession(groupId, combineLocal(date, startTime), combineLocal(date, endTime))
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    setDate('')
    setStartTime('')
    setEndTime('')
    onCreated()
  }

  return (
    <div style={{ padding: '16px 24px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', background: '#FAFBFD' }}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
      <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
      <span style={{ color: '#94A3B8' }}>–</span>
      <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
      <button type="button" disabled={saving} onClick={handleCreate} style={primaryBtnStyle}>{saving ? 'Adding...' : '+ Add session'}</button>
    </div>
  )
}
