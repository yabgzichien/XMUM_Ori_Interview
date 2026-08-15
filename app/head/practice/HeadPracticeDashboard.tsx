'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  getHeadPracticeGroups,
  getHeadCommitteeRoster,
  getMyPracticeGroup,
  createPracticeGroup,
  updatePracticeGroup,
  reassignPracticeLead,
  deletePracticeGroup,
  getGroupSessions,
  getGroupMembers,
  setCommitteePosition,
  POSITIONS,
  positionLabel,
  type HeadPracticeGroup,
  type CommitteeRosterEntry,
  type PracticeSession,
  type MyGroup,
  type GroupStatus,
  type Track,
  type Orientation,
} from '@/lib/practice'
import { formatDateHeading, formatTimeRange, toLocalDateIso } from '@/lib/booking-helpers'
import { MyGroupPanel } from '@/app/practice/MyGroupPanel'

type Props = {
  orientation: Orientation
  orientationYear?: number
  isAdmin: boolean
  currentUserId: string
}

type MemberWithProfile = {
  member_id: string
  joined_at: string
  profiles: { name: string; email: string } | null
}

function trackLabel(track: Track): string {
  return track === 'game_master' ? 'Game Master' : 'Facilitator'
}

const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle: React.CSSProperties = { padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '13.5px', fontFamily: 'inherit', color: '#0F172A', outline: 'none' }
const primaryBtnStyle: React.CSSProperties = { padding: '9px 16px', borderRadius: '8px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }
const secondaryBtnStyle: React.CSSProperties = { padding: '9px 14px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }
const dangerBtnStyle: React.CSSProperties = { padding: '9px 14px', borderRadius: '8px', border: 'none', background: '#FEE2E2', color: '#B91C1C', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }

export function HeadPracticeDashboard({ orientation, orientationYear = 2026, isAdmin, currentUserId }: Props) {
  const [groups, setGroups] = useState<HeadPracticeGroup[]>([])
  const [roster, setRoster] = useState<CommitteeRosterEntry[]>([])
  const [myGroup, setMyGroup] = useState<MyGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'mygroup' | 'groups' | 'members'>('mygroup')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: g, error: gErr }, { data: r, error: rErr }, { data: mg, error: mgErr }] = await Promise.all([
      getHeadPracticeGroups(orientation, orientationYear),
      getHeadCommitteeRoster(orientation, orientationYear),
      getMyPracticeGroup(),
    ])
    setError(gErr?.message ?? rErr?.message ?? mgErr?.message ?? null)
    setGroups(g ?? [])
    setRoster(r ?? [])
    const userMyGroup = mg && mg.is_lead ? mg : null
    setMyGroup(userMyGroup)
    if (!userMyGroup) {
      setActiveTab((prev) => (prev === 'mygroup' ? 'groups' : prev))
    }
    setLoading(false)
  }, [orientation, orientationYear])

  useEffect(() => {
    load()
  }, [load])

  const availableLeads = roster.filter((m) => m.role === 'committee')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', borderRadius: '14px', border: '1px solid #EAEEF4', background: '#F8FAFC', overflow: 'hidden' }}>
        {myGroup && (
          <button
            type="button"
            onClick={() => setActiveTab('mygroup')}
            style={{ flex: 1, padding: '14px 20px', border: 'none', borderRight: '1px solid #EAEEF4', background: activeTab === 'mygroup' ? '#fff' : 'transparent', color: activeTab === 'mygroup' ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '14.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          >
            My Group
          </button>
        )}
        <button
          type="button"
          onClick={() => setActiveTab('groups')}
          style={{ flex: 1, padding: '14px 20px', border: 'none', background: activeTab === 'groups' ? '#fff' : 'transparent', color: activeTab === 'groups' ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '14.5px', cursor: 'pointer', borderRight: '1px solid #EAEEF4', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          Groups
          <span style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'groups' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{groups.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          style={{ flex: 1, padding: '14px 20px', border: 'none', background: activeTab === 'members' ? '#fff' : 'transparent', color: activeTab === 'members' ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '14.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          Committee Members
          <span style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'members' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{roster.length}</span>
        </button>
      </div>

      {loading && <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>}
      {error && <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>}

      {!loading && !error && activeTab === 'groups' && (
        <>
          {isAdmin && (
            <NewGroupForm orientation={orientation} orientationYear={orientationYear} availableLeads={availableLeads} onCreated={load} />
          )}

          {groups.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '32px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
              {isAdmin ? 'No practice groups created yet for this orientation. Use the form above to add one.' : 'No practice groups created yet for this orientation.'}
            </div>
          )}

          {groups.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #EAEEF4', fontWeight: 700, fontSize: '15px' }}>
                Practice groups ({groups.length})
              </div>
              {groups.map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  availableLeads={availableLeads}
                  isAdmin={isAdmin}
                  expanded={expandedId === g.id}
                  onToggle={() => setExpandedId(expandedId === g.id ? null : g.id)}
                  onChanged={load}
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!loading && !error && activeTab === 'members' && (
        <CommitteeRosterPanel roster={roster} isAdmin={isAdmin} onChanged={load} />
      )}

      {!loading && !error && activeTab === 'mygroup' && myGroup && (
        <MyGroupPanel myGroup={myGroup} currentUserId={currentUserId} onGroupChanged={load} />
      )}
    </div>
  )
}

function NewGroupForm({ orientation, orientationYear = 2026, availableLeads, onCreated }: {
  orientation: Orientation
  orientationYear?: number
  availableLeads: CommitteeRosterEntry[]
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState(6)
  const [leadId, setLeadId] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !leadId) return
    setSaving(true)
    setFormError(null)
    const { error } = await createPracticeGroup(name.trim(), orientation, capacity, leadId, orientationYear)
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setName('')
    setCapacity(6)
    setLeadId('')
    onCreated()
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '20px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={labelStyle}>Group name</label>
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Team Alpha" style={{ ...inputStyle, width: '220px' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={labelStyle}>Capacity</label>
        <input type="number" min={1} required value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} style={{ ...inputStyle, width: '90px' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={labelStyle}>Performance lead</label>
        <select required value={leadId} onChange={(e) => setLeadId(e.target.value)} style={{ ...inputStyle, width: '240px' }}>
          <option value="">Select a committee member...</option>
          {availableLeads.map((m) => (
            <option key={m.id} value={m.id}>{m.name} · {trackLabel(m.track)} ({m.email})</option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={saving || !name.trim() || !leadId} style={primaryBtnStyle}>
        {saving ? 'Creating...' : '+ New group'}
      </button>
      {formError && <span style={{ color: '#B91C1C', fontSize: '13px' }}>{formError}</span>}
      {availableLeads.length === 0 && !formError && (
        <span style={{ color: '#94A3B8', fontSize: '12.5px' }}>
          No committee members available to lead yet — invite approved interviewees first.
        </span>
      )}
    </form>
  )
}

function CommitteeRosterPanel({ roster, isAdmin, onChanged }: { roster: CommitteeRosterEntry[]; isAdmin: boolean; onChanged: () => void }) {
  const [savingId, setSavingId] = useState<string | null>(null)

  async function handleChange(memberId: string, position: string) {
    setSavingId(memberId)
    const { error } = await setCommitteePosition(memberId, position || null)
    setSavingId(null)
    if (error) {
      alert(error.message)
      return
    }
    onChanged()
  }

  if (roster.length === 0) return null

  return (
    <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #EAEEF4', fontWeight: 700, fontSize: '15px' }}>
        Committee members ({roster.length})
      </div>
      {roster.map((m) => (
        <div key={m.id} style={{ padding: '14px 20px', borderBottom: '1px solid #EAEEF4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px', color: '#0F172A' }}>{m.name}</div>
            <div style={{ fontSize: '12.5px', color: '#64748B' }}>{trackLabel(m.track)} · {m.email}</div>
          </div>
          {isAdmin ? (
            <select
              value={m.position ?? ''}
              disabled={savingId === m.id}
              onChange={(e) => handleChange(m.id, e.target.value)}
              style={{ ...inputStyle, width: '240px' }}
            >
              <option value="">No position set</option>
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          ) : (
            <span style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '11.5px', fontWeight: 700, background: m.position ? '#EFF4FF' : '#F1F5F9', color: m.position ? '#2563EB' : '#94A3B8' }}>
              {positionLabel(m.position)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function GroupRow({ group, expanded, onToggle, availableLeads, isAdmin, onChanged, currentUserId }: {
  group: HeadPracticeGroup
  expanded: boolean
  onToggle: () => void
  availableLeads: CommitteeRosterEntry[]
  isAdmin: boolean
  onChanged: () => void
  currentUserId?: string
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.name)
  const [capacity, setCapacity] = useState(group.capacity)
  const [status, setStatus] = useState<GroupStatus>(group.status)
  const [saving, setSaving] = useState(false)
  const [reassignId, setReassignId] = useState('')

  const isManagedByUser = Boolean(currentUserId && group.lead_id === currentUserId)

  async function handleSave() {
    setSaving(true)
    const { error } = await updatePracticeGroup(group.id, name.trim(), capacity, status)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    setEditing(false)
    onChanged()
  }

  async function handleReassign() {
    if (!reassignId) return
    if (!window.confirm(`Reassign lead of "${group.name}"? The current lead returns to Committee.`)) return
    const { error } = await reassignPracticeLead(group.id, reassignId)
    if (error) {
      alert(error.message)
      return
    }
    setReassignId('')
    onChanged()
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${group.name}"? This removes its members and sessions, and returns ${group.lead_name} to Committee.`)) return
    const { error } = await deletePracticeGroup(group.id)
    if (error) {
      alert(error.message)
      return
    }
    onChanged()
  }

  return (
    <div style={{ borderBottom: '1px solid #EAEEF4' }}>
      <div
        style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', cursor: 'pointer' }}
        onClick={onToggle}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#0F172A', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{group.name}</span>
            {isManagedByUser && (
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#2563EB', background: '#EFF4FF', padding: '2px 8px', borderRadius: '99px' }}>
                your group
              </span>
            )}
          </div>
          <div style={{ fontSize: '13px', color: '#64748B' }}>
            Led by {group.lead_name} ({group.lead_email}){isManagedByUser ? ' (your group)' : ''} · {group.member_count}/{group.capacity} members · {group.session_count} session{group.session_count === 1 ? '' : 's'}
          </div>
        </div>
        <span style={{
          padding: '4px 10px', borderRadius: '99px', fontSize: '11.5px', fontWeight: 700,
          background: group.status === 'open' ? '#ECFDF3' : '#F1F5F9',
          color: group.status === 'open' ? '#15803D' : '#64748B',
        }}>
          {group.status === 'open' ? 'Open' : 'Closed'}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }} onClick={(e) => e.stopPropagation()}>
          {isAdmin && (
            editing ? (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', background: '#F8FAFC', padding: '14px', borderRadius: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={labelStyle}>Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={labelStyle}>Capacity</label>
                  <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} style={{ ...inputStyle, width: '90px' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={labelStyle}>Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as GroupStatus)} style={inputStyle}>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
                <button type="button" disabled={saving} onClick={handleSave} style={primaryBtnStyle}>{saving ? 'Saving...' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(false)} style={secondaryBtnStyle}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onClick={() => setEditing(true)} style={secondaryBtnStyle}>Edit</button>
                <select value={reassignId} onChange={(e) => setReassignId(e.target.value)} style={inputStyle}>
                  <option value="">Reassign lead to...</option>
                  {availableLeads.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} · {trackLabel(m.track)}</option>
                  ))}
                </select>
                <button type="button" disabled={!reassignId} onClick={handleReassign} style={secondaryBtnStyle}>Reassign</button>
                <button type="button" onClick={handleDelete} style={dangerBtnStyle}>Delete group</button>
              </div>
            )
          )}

          <GroupDetails groupId={group.id} />
        </div>
      )}
    </div>
  )
}

function GroupDetails({ groupId }: { groupId: string }) {
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      const [{ data: s }, { data: m }] = await Promise.all([getGroupSessions(groupId), getGroupMembers(groupId)])
      if (!cancelled) {
        setSessions(s ?? [])
        setMembers((m as unknown as MemberWithProfile[]) ?? [])
        setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [groupId])

  if (loading) {
    return <div style={{ fontSize: '13px', color: '#94A3B8' }}>Loading details...</div>
  }

  return (
    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ ...labelStyle, marginBottom: '8px', display: 'block' }}>Roster</div>
        {members.length === 0 && <div style={{ fontSize: '13px', color: '#94A3B8' }}>No members yet.</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {members.map((m) => (
            <span key={m.member_id} style={{ padding: '5px 11px', borderRadius: '99px', background: '#F1F5F9', color: '#334155', fontSize: '12.5px', fontWeight: 600 }}>
              {m.profiles?.name ?? m.member_id}
            </span>
          ))}
        </div>
      </div>
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ ...labelStyle, marginBottom: '8px', display: 'block' }}>Sessions</div>
        {sessions.length === 0 && <div style={{ fontSize: '13px', color: '#94A3B8' }}>No sessions scheduled yet.</div>}
        {sessions.map((s) => (
          <div key={s.id} style={{ fontSize: '13px', color: '#334155', marginBottom: '4px' }}>
            {formatDateHeading(toLocalDateIso(s.starts_at))} · {formatTimeRange(s.starts_at, s.ends_at)}
            {s.location && <> · {s.location}</>}
          </div>
        ))}
      </div>
    </div>
  )
}
