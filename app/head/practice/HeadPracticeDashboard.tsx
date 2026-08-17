'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  getLeadEligibleMembers,
  leadAddMember,
  leadRemoveMember,
  setCommitteePosition,
  getCommitteePositions,
  positionLabel,
  type HeadPracticeGroup,
  type CommitteeRosterEntry,
  type CommitteePositionOption,
  type PracticeSession,
  type MyGroup,
  type GroupStatus,
  type Track,
  type Orientation,
  type EligibleMember,
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

function trackLabel(track: Track | null): string | null {
  if (!track) return null
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
  const [positions, setPositions] = useState<CommitteePositionOption[]>([])
  const [myGroup, setMyGroup] = useState<MyGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'mygroup' | 'groups' | 'members'>('mygroup')

  const [reloadToken, setReloadToken] = useState(0)
  const load = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    let active = true

    async function run() {
      const [{ data: g, error: gErr }, { data: r, error: rErr }, { data: mg, error: mgErr }, { data: p }] = await Promise.all([
        getHeadPracticeGroups(orientation, orientationYear),
        getHeadCommitteeRoster(orientation, orientationYear),
        getMyPracticeGroup(),
        getCommitteePositions(),
      ])
      if (!active) return
      setError(gErr?.message ?? rErr?.message ?? mgErr?.message ?? null)
      setGroups(g ?? [])
      setRoster(r ?? [])
      setPositions(p ?? [])
      const userMyGroup = mg && mg.is_lead ? mg : null
      setMyGroup(userMyGroup)
      if (!userMyGroup) {
        setActiveTab((prev) => (prev === 'mygroup' ? 'groups' : prev))
      }
      setLoading(false)
    }

    run()
    return () => {
      active = false
    }
  }, [orientation, orientationYear, reloadToken])

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
            <NewGroupForm orientation={orientation} orientationYear={orientationYear} availableLeads={availableLeads} onRefreshLeads={load} onCreated={load} />
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
                  onRefreshLeads={load}
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
        <CommitteeRosterPanel roster={roster} positions={positions} isAdmin={isAdmin} onChanged={load} />
      )}

      {!loading && !error && activeTab === 'mygroup' && myGroup && (
        <MyGroupPanel myGroup={myGroup} currentUserId={currentUserId} onGroupChanged={load} />
      )}
    </div>
  )
}

function CommitteeMemberPicker({ options, value, onChange, onOpen, placeholder = 'Select a committee member...', disabled, width = '260px' }: {
  options: CommitteeRosterEntry[]
  value: string
  onChange: (id: string) => void
  onOpen?: () => void
  placeholder?: string
  disabled?: boolean
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = options.find((m) => m.id === value) ?? null

  function updateCoords() {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }

  useEffect(() => {
    if (!open) return
    updateCoords()
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
      setQuery('')
    }
    function handleReposition() {
      updateCoords()
    }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('resize', handleReposition)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('resize', handleReposition)
    }
  }, [open])

  const filtered = options.filter((m) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
  })

  function handleOpen() {
    if (disabled || open) return
    updateCoords()
    setOpen(true)
    setQuery('')
    onOpen?.()
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width }}>
      <input
        type="text"
        disabled={disabled}
        value={open ? query : selected ? `${selected.name} (${selected.email})` : ''}
        placeholder={placeholder}
        onFocus={handleOpen}
        onClick={handleOpen}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
      />
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', zIndex: 1000, top: coords.top, left: coords.left, width: coords.width, background: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', boxShadow: '0 8px 24px rgba(16,24,40,.12)', maxHeight: '260px', overflowY: 'auto' }}
        >
          {value && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(''); setOpen(false); setQuery('') }}
              style={{ padding: '8px 12px', fontSize: '12.5px', color: '#94A3B8', cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}
            >
              Clear selection
            </div>
          )}
          {filtered.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '13px', color: '#94A3B8' }}>No matching committee members.</div>
          )}
          {filtered.map((m) => (
            <div
              key={m.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(m.id); setOpen(false); setQuery('') }}
              style={{ padding: '9px 12px', fontSize: '13.5px', color: '#0F172A', cursor: 'pointer', background: m.id === value ? '#EFF4FF' : 'transparent' }}
            >
              <div style={{ fontWeight: 600 }}>{m.name}{trackLabel(m.track) ? ` · ${trackLabel(m.track)}` : ''}</div>
              <div style={{ fontSize: '12px', color: '#64748B' }}>{m.email}</div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

function NewGroupForm({ orientation, orientationYear = 2026, availableLeads, onRefreshLeads, onCreated }: {
  orientation: Orientation
  orientationYear?: number
  availableLeads: CommitteeRosterEntry[]
  onRefreshLeads: () => void
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
        <CommitteeMemberPicker options={availableLeads} value={leadId} onChange={setLeadId} onOpen={onRefreshLeads} width="260px" />
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

function CommitteeRosterPanel({ roster, positions, isAdmin, onChanged }: { roster: CommitteeRosterEntry[]; positions: CommitteePositionOption[]; isAdmin: boolean; onChanged: () => void }) {
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
            <div style={{ fontSize: '12.5px', color: '#64748B' }}>{trackLabel(m.track) ? `${trackLabel(m.track)} · ` : ''}{m.email}</div>
          </div>
          {isAdmin ? (
            <select
              value={m.position ?? ''}
              disabled={savingId === m.id}
              onChange={(e) => handleChange(m.id, e.target.value)}
              style={{ ...inputStyle, width: '240px' }}
            >
              <option value="">No position set</option>
              {positions.map((p) => (
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

function GroupRow({ group, expanded, onToggle, availableLeads, onRefreshLeads, isAdmin, onChanged, currentUserId }: {
  group: HeadPracticeGroup
  expanded: boolean
  onToggle: () => void
  availableLeads: CommitteeRosterEntry[]
  onRefreshLeads: () => void
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
                <CommitteeMemberPicker options={availableLeads} value={reassignId} onChange={setReassignId} onOpen={onRefreshLeads} placeholder="Reassign lead to..." width="220px" />
                <button type="button" disabled={!reassignId} onClick={handleReassign} style={secondaryBtnStyle}>Reassign</button>
                <button type="button" onClick={handleDelete} style={dangerBtnStyle}>Delete group</button>
              </div>
            )
          )}

          <GroupDetails groupId={group.id} capacity={group.capacity} isAdmin={isAdmin} onChanged={onChanged} />
        </div>
      )}
    </div>
  )
}

function GroupDetails({ groupId, capacity, isAdmin, onChanged }: {
  groupId: string
  capacity: number
  isAdmin: boolean
  onChanged: () => void
}) {
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [memberReloadToken, setMemberReloadToken] = useState(0)

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
  }, [groupId, memberReloadToken])

  async function handleRemove(memberId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this group?`)) return
    setRemovingId(memberId)
    const { error } = await leadRemoveMember(groupId, memberId)
    setRemovingId(null)
    if (error) {
      alert(error.message)
      return
    }
    setMemberReloadToken((n) => n + 1)
    onChanged()
  }

  if (loading) {
    return <div style={{ fontSize: '13px', color: '#94A3B8' }}>Loading details...</div>
  }

  return (
    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 260px' }}>
        <div style={{ ...labelStyle, marginBottom: '8px', display: 'block' }}>Group members</div>
        {members.length === 0 && <div style={{ fontSize: '13px', color: '#94A3B8' }}>No members yet.</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {members.map((m) => (
            <span key={m.member_id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 8px 5px 11px', borderRadius: '99px', background: '#F1F5F9', color: '#334155', fontSize: '12.5px', fontWeight: 600 }}>
              {m.profiles?.name ?? m.member_id}
              {isAdmin && (
                <button
                  type="button"
                  disabled={removingId === m.member_id}
                  onClick={() => handleRemove(m.member_id, m.profiles?.name ?? 'this member')}
                  aria-label={`Remove ${m.profiles?.name ?? 'member'}`}
                  style={{ border: 'none', background: '#FEE2E2', color: '#EF4444', borderRadius: '99px', width: '16px', height: '16px', lineHeight: '16px', textAlign: 'center', fontSize: '10px', fontWeight: 700, cursor: removingId === m.member_id ? 'not-allowed' : 'pointer', padding: 0 }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {isAdmin && (
          <AdminAddMemberForm
            groupId={groupId}
            seatsLeft={capacity - members.length}
            onAdded={() => {
              setMemberReloadToken((n) => n + 1)
              onChanged()
            }}
          />
        )}
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

function AdminAddMemberForm({ groupId, seatsLeft, onAdded }: {
  groupId: string
  seatsLeft: number
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<EligibleMember[]>([])
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleOpen() {
    setOpen(true)
    setLoading(true)
    setFormError(null)
    const { data, error } = await getLeadEligibleMembers(groupId)
    setLoading(false)
    if (error) {
      setFormError(error.message)
      setOpen(false)
      return
    }
    setCandidates(data ?? [])
  }

  async function handleAdd(memberId: string) {
    setAddingId(memberId)
    setFormError(null)
    const { error } = await leadAddMember(groupId, memberId)
    setAddingId(null)
    if (error) {
      setFormError(error.message)
      return
    }
    setCandidates((prev) => prev.filter((c) => c.id !== memberId))
    onAdded()
  }

  if (!open) {
    return (
      <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleOpen}
          disabled={seatsLeft === 0}
          style={{ ...secondaryBtnStyle, opacity: seatsLeft === 0 ? 0.5 : 1, cursor: seatsLeft === 0 ? 'not-allowed' : 'pointer' }}
        >
          + Add member
        </button>
        <span style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>
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
    <div style={{ marginTop: '10px', padding: '12px', background: '#F8FAFC', border: '1px solid #EAEEF4', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search by name or student ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 180px' }}
        />
        <button type="button" onClick={() => setOpen(false)} style={secondaryBtnStyle}>Close</button>
      </div>
      {formError && <span style={{ color: '#B91C1C', fontSize: '12.5px' }}>{formError}</span>}
      {loading && <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>Loading eligible members...</div>}
      {!loading && filtered.length === 0 && (
        <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>
          {candidates.length === 0
            ? 'No eligible committee members — everyone in this orientation is already in a group.'
            : 'No matches.'}
        </div>
      )}
      {!loading && filtered.map((c) => (
        <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '8px 10px', background: '#fff', border: '1px solid #EAEEF4', borderRadius: '8px' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#0F172A' }}>{c.name}</div>
            <div style={{ fontSize: '11.5px', color: '#64748B' }}>{c.student_id ?? 'No student ID'} · {c.email}</div>
          </div>
          <button
            type="button"
            disabled={addingId === c.id || seatsLeft === 0}
            onClick={() => handleAdd(c.id)}
            style={{ ...primaryBtnStyle, padding: '6px 12px', fontSize: '12px' }}
          >
            {addingId === c.id ? 'Adding...' : 'Add'}
          </button>
        </div>
      ))}
    </div>
  )
}
