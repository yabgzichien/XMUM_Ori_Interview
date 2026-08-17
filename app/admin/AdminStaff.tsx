'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  deleteInvite,
  listInvites,
  listCommitteeMembers,
  renameCommitteeMember,
  revokeCommitteeMember,
  type StaffInvite,
  type StaffRole,
  type CommitteeMember,
} from '@/lib/admin'
import {
  getCommitteePositions,
  addCommitteePosition,
  deleteCommitteePosition,
  setCommitteePosition,
  type CommitteePositionOption,
} from '@/lib/practice'
import { ORIENTATIONS, DEFAULT_ORIENTATION, DEFAULT_ORIENTATION_YEAR, type Orientation } from '@/lib/orientation'
import { addInviteAction } from '@/app/actions/inviteAction'

const roleLabels: Record<StaffRole, string> = {
  head_facilitator: 'Head of Facilitators',
  head_gm: 'Head of Game Masters',
  admin: 'Admin',
  committee: 'Committee Member',
}

// Shared with the other admin screens (see app/admin/logs/AuditLogClient.tsx)
// so every form control on /admin* looks the same.
export const fieldLabelStyle: React.CSSProperties = { fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }
export const fieldStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569', backgroundColor: '#fff' }

export function AdminStaff() {
  const [invites, setInvites] = useState<StaffInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [positions, setPositions] = useState<CommitteePositionOption[]>([])
  const [positionsError, setPositionsError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [position, setPosition] = useState('')
  const [grantAdmin, setGrantAdmin] = useState(false)
  const [orientation, setOrientation] = useState<Orientation>(DEFAULT_ORIENTATION)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Mirrors the server's derivation in addInviteAction — shown so the admin
  // sees what access the invite will actually grant before submitting.
  const derivedRole: StaffRole = grantAdmin
    ? 'admin'
    : position === 'hof'
      ? 'head_facilitator'
      : position === 'hog'
        ? 'head_gm'
        : 'committee'

  const [showManagePositions, setShowManagePositions] = useState(false)
  const [newPositionLabel, setNewPositionLabel] = useState('')
  const [positionBusy, setPositionBusy] = useState(false)
  const [positionActionError, setPositionActionError] = useState<string | null>(null)

  const [reloadToken, setReloadToken] = useState(0)
  const load = useCallback(() => setReloadToken((n) => n + 1), [])

  const loadPositions = useCallback(async () => {
    const { data, error } = await getCommitteePositions()
    if (error) {
      setPositionsError(error.message)
      return
    }
    setPositionsError(null)
    setPositions(data ?? [])
  }, [])

  useEffect(() => {
    let active = true

    async function run() {
      const { data, error } = await listInvites()
      if (!active) return
      setLoading(false)
      if (error) {
        setLoadError(error.message)
        setInvites([])
        return
      }
      setLoadError(null)
      setInvites(data ?? [])
    }

    run()
    return () => {
      active = false
    }
  }, [reloadToken])

  useEffect(() => {
    loadPositions()
  }, [loadPositions])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    const { error } = await addInviteAction({
      name,
      studentId,
      email,
      position: position || null,
      orientation: grantAdmin ? null : orientation,
      orientationYear: grantAdmin ? null : DEFAULT_ORIENTATION_YEAR,
      grantAdmin,
    })
    setSubmitting(false)
    if (error) {
      setFormError(
        error.includes('duplicate')
          ? 'That email already has an invite.'
          : error,
      )
      return
    }
    setName('')
    setStudentId('')
    setEmail('')
    setPosition('')
    setGrantAdmin(false)
    setLoading(true)
    load()
  }

  async function handleDelete(invite: StaffInvite) {
    if (!window.confirm(`Remove the invite for ${invite.email}?`)) return
    const { error } = await deleteInvite(invite.id)
    if (error) {
      alert(error.message)
      setLoadError(error.message)
      return
    }
    setLoading(true)
    load()
  }

  async function handleAddPosition(e: React.FormEvent) {
    e.preventDefault()
    setPositionActionError(null)
    setPositionBusy(true)
    const { error } = await addCommitteePosition(newPositionLabel)
    setPositionBusy(false)
    if (error) {
      setPositionActionError(
        error.message.includes('duplicate') ? 'That role already exists.' : error.message,
      )
      return
    }
    setNewPositionLabel('')
    loadPositions()
  }

  async function handleDeletePosition(value: string, label: string) {
    if (!window.confirm(`Remove the "${label}" role? Anyone currently holding it keeps the title, but it won't be selectable anymore.`)) return
    setPositionActionError(null)
    setPositionBusy(true)
    const { error } = await deleteCommitteePosition(value)
    setPositionBusy(false)
    if (error) {
      setPositionActionError(
        error.message.includes('violates foreign key')
          ? 'Someone currently holds this role — reassign them first.'
          : error.message,
      )
      return
    }
    loadPositions()
  }

  const deleteBtnStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: '8px',
    border: 'none',
    background: '#FEE2E2',
    color: '#EF4444',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'background .15s',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Invite Form Card */}
      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '26px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>👋</div>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 2px' }}>Invite Committee</h2>
            <p style={{ fontSize: '12.5px', color: '#64748B', margin: 0 }}>Add a new administrator, head, or committee member.</p>
          </div>
        </div>

        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={fieldLabelStyle}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={fieldStyle}
              />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={fieldLabelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={fieldStyle}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={fieldLabelStyle}>Student ID</label>
              <input
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                required
                style={fieldStyle}
              />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={fieldLabelStyle}>Title (optional)</label>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                disabled={grantAdmin}
                style={{ ...fieldStyle, opacity: grantAdmin ? 0.6 : 1 }}
              >
                <option value="">No title</option>
                {positions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            {!grantAdmin && (
              <div style={{ flex: '1 1 200px' }}>
                <label style={fieldLabelStyle}>Orientation</label>
                <select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as Orientation)}
                  style={fieldStyle}
                >
                  {ORIENTATIONS.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="grant-admin"
              checked={grantAdmin}
              onChange={(e) => setGrantAdmin(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <label htmlFor="grant-admin" style={{ fontSize: '13px', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
              Grant admin access
            </label>
          </div>

          <p style={{ margin: 0, fontSize: '12.5px', color: '#94A3B8' }}>
            Access level: <strong style={{ color: '#475569' }}>{roleLabels[derivedRole]}</strong>
            {' — '}
            {grantAdmin
              ? 'admins see and manage everything.'
              : derivedRole === 'committee'
                ? 'Head of Facilitator / Head of Game Master titles grant real dashboard access automatically; every other title is just a label.'
                : 'this title grants real /head dashboard access for its track.'}
          </p>

          <div>
            <button type="submit" disabled={submitting} style={{ padding: '10.5px 22px', borderRadius: '9px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 12px -4px rgba(37,99,235,.4)', transition: 'all 0.15s', opacity: submitting ? 0.7 : 1 }}>
              {submitting ? 'Adding...' : 'Add invite'}
            </button>
          </div>
        </form>
        {formError && <p style={{ marginTop: '14px', fontSize: '13px', color: '#B91C1C' }}>{formError}</p>}

        <button
          type="button"
          onClick={() => setShowManagePositions((v) => !v)}
          style={{ marginTop: '18px', padding: 0, border: 'none', background: 'none', color: '#2563EB', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          {showManagePositions ? 'Hide title management' : 'Manage titles'}
        </button>

        {showManagePositions && (
          <div style={{ marginTop: '14px', padding: '16px', border: '1px solid #EAEEF4', borderRadius: '12px', background: '#F8FAFC' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155', marginBottom: '10px' }}>Committee titles</div>
            {positionsError && <p style={{ fontSize: '12.5px', color: '#B91C1C', marginBottom: '10px' }}>{positionsError}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
              {positions.map((p) => (
                <span key={p.value} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 8px 5px 12px', borderRadius: '99px', background: '#fff', border: '1px solid #E2E8F0', fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                  {p.label}
                  <button
                    type="button"
                    onClick={() => handleDeletePosition(p.value, p.label)}
                    disabled={positionBusy}
                    aria-label={`Remove ${p.label}`}
                    style={{ border: 'none', background: '#FEE2E2', color: '#EF4444', borderRadius: '99px', width: '18px', height: '18px', lineHeight: '18px', textAlign: 'center', fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form onSubmit={handleAddPosition} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={newPositionLabel}
                onChange={(e) => setNewPositionLabel(e.target.value)}
                placeholder="e.g. Marketing Lead"
                required
                style={{ ...fieldStyle, flex: '1 1 200px', backgroundColor: '#fff' }}
              />
              <button type="submit" disabled={positionBusy} style={{ padding: '10px 16px', borderRadius: '9px', border: 'none', background: '#0F172A', color: '#fff', fontWeight: 700, fontSize: '13.5px', cursor: 'pointer', opacity: positionBusy ? 0.7 : 1 }}>
                Add title
              </button>
            </form>
            {positionActionError && <p style={{ marginTop: '10px', fontSize: '12.5px', color: '#B91C1C' }}>{positionActionError}</p>}
          </div>
        )}
      </div>

      <CommitteeMembersPanel positions={positions} />

      {/* Invites Table Card */}
      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #EAEEF4', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🔑</span>
          <h2 style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', margin: 0 }}>Active Invites & Committee</h2>
        </div>

        {loading && <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>}
        {loadError && <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{loadError}</div>}

        {!loading && !loadError && invites.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>No invites yet.</div>
        )}

        {!loading && !loadError && invites.length > 0 && (
          <div style={{ width: '100%' }}>
            {/* Desktop Table — one table, header and rows together. The mobile
                card list below is toggled by the shared .tbl-desk/.tbl-mob rules. */}
            <table className="tbl-desk" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #EAEEF4' }}>
                  <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Committee Member</th>
                  <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Role</th>
                  <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Code/Status</th>
                  <th style={{ padding: '16px 20px' }}></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid #EAEEF4' }}>
                    <td style={{ padding: '18px 20px' }}>
                      <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{inv.name}</div>
                      <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{inv.email}</div>
                    </td>
                    <td style={{ padding: '18px 20px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>{roleLabels[inv.role]}</div>
                      {inv.position && (
                        <div style={{ fontSize: '12.5px', color: '#94A3B8', fontWeight: 500, marginTop: '1px' }}>
                          {positions.find((p) => p.value === inv.position)?.label ?? inv.position}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '18px 20px' }}>
                      {inv.claimed_at ? (
                        <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', background: '#ECFDF3', color: '#15803D', fontSize: '12px', fontWeight: 700 }}>Activated</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', background: '#FEF3C7', color: '#B45309', fontSize: '12px', fontWeight: 700, width: 'fit-content' }}>Pending</span>
                          <span style={{ fontSize: '13px', fontFamily: 'var(--font-jetbrains-mono, monospace)', background: '#F1F5F9', padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.05em', color: '#0F172A', fontWeight: 600 }}>{inv.code}</span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '18px 20px', textAlign: 'right' }}>
                      {!inv.claimed_at && (
                        <button type="button" onClick={() => handleDelete(inv)} className="btn-del hover:bg-red-200" style={deleteBtnStyle}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile list */}
            <div className="tbl-mob">
              {invites.map((inv) => (
                <div key={inv.id} style={{ borderBottom: '1px solid #EAEEF4', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{inv.name}</div>
                      <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{inv.email}</div>
                    </div>
                    <div>
                      {inv.claimed_at ? (
                        <span style={{ display: 'inline-flex', padding: '4px 8px', borderRadius: '6px', background: '#ECFDF3', color: '#15803D', fontSize: '11px', fontWeight: 700 }}>Activated</span>
                      ) : (
                        <span style={{ display: 'inline-flex', padding: '4px 8px', borderRadius: '6px', background: '#FEF3C7', color: '#B45309', fontSize: '11px', fontWeight: 700 }}>Pending</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#475569' }}>
                      <span style={{ color: '#94A3B8', fontWeight: 500, marginRight: '4px' }}>Role:</span>
                      {roleLabels[inv.role]}
                      {inv.position && (
                        <span style={{ color: '#94A3B8', fontWeight: 500 }}> · {positions.find((p) => p.value === inv.position)?.label ?? inv.position}</span>
                      )}
                    </div>
                    {!inv.claimed_at && (
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center' }}>
                        <span style={{ color: '#94A3B8', fontWeight: 500, marginRight: '6px' }}>Code:</span>
                        <span style={{ fontSize: '13px', fontFamily: 'var(--font-jetbrains-mono, monospace)', background: '#F1F5F9', padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.05em', color: '#0F172A' }}>{inv.code}</span>
                      </div>
                    )}
                  </div>
                  {!inv.claimed_at && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button type="button" onClick={() => handleDelete(inv)} className="btn-del hover:bg-red-200" style={deleteBtnStyle}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function initialsFor(name: string, email: string): string {
  return (name.trim()
    ? name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('')
    : email.slice(0, 2) || 'SC'
  ).toUpperCase()
}

function MemberAvatar({ name, email, avatarUrl }: { name: string; email: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        style={{ width: '36px', height: '36px', borderRadius: '99px', objectFit: 'cover', border: '1px solid #EAEEF4', flexShrink: 0 }}
      />
    )
  }
  return (
    <div style={{ width: '36px', height: '36px', borderRadius: '99px', background: '#EEF2F7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', color: '#475569', flexShrink: 0 }}>
      {initialsFor(name, email)}
    </div>
  )
}

const memberRoleLabels: Record<CommitteeMember['role'], string> = {
  committee: 'Committee Member',
  performance_lead: 'Performance Lead',
  head_facilitator: 'Head of Facilitators',
  head_gm: 'Head of Game Masters',
}

function CommitteeMembersPanel({ positions }: { positions: CommitteePositionOption[] }) {
  const [members, setMembers] = useState<CommitteeMember[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await listCommitteeMembers()
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      return
    }
    setLoadError(null)
    setMembers(data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handlePositionChange(memberId: string, position: string) {
    setBusyId(memberId)
    setRowError(null)
    const { error } = await setCommitteePosition(memberId, position || null)
    setBusyId(null)
    if (error) {
      setRowError({ id: memberId, message: error.message })
      return
    }
    load()
  }

  function startRename(member: CommitteeMember) {
    setRenamingId(member.id)
    setRenameValue(member.name)
    setRowError(null)
  }

  async function saveRename(memberId: string) {
    if (!renameValue.trim()) return
    setBusyId(memberId)
    setRowError(null)
    const { error } = await renameCommitteeMember(memberId, renameValue)
    setBusyId(null)
    if (error) {
      setRowError({ id: memberId, message: error.message })
      return
    }
    setRenamingId(null)
    load()
  }

  async function handleRevoke(member: CommitteeMember) {
    if (!window.confirm(`Revoke committee access for ${member.name}? They'll lose their dashboard access, but their account and history stay. You can re-promote them later via the practice dashboard.`)) return
    setBusyId(member.id)
    setRowError(null)
    const { error } = await revokeCommitteeMember(member.id)
    setBusyId(null)
    if (error) {
      setRowError({ id: member.id, message: error.message })
      return
    }
    load()
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #EAEEF4', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px' }}>🧑‍🤝‍🧑</span>
        <h2 style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', margin: 0 }}>Committee Members</h2>
      </div>

      {loading && <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>}
      {loadError && <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{loadError}</div>}
      {!loading && !loadError && members.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>No active committee members yet.</div>
      )}

      {!loading && !loadError && members.map((m) => {
        const permanent = !m.orientation
        return (
          <div key={m.id} style={{ padding: '14px 20px', borderBottom: '1px solid #EAEEF4', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '180px' }}>
              <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} />
              <div>
              {renamingId === m.id ? (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    disabled={busyId === m.id}
                    style={{ padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: '7px', fontSize: '13.5px', fontFamily: 'inherit', width: '160px' }}
                  />
                  <button type="button" disabled={busyId === m.id} onClick={() => saveRename(m.id)} style={{ padding: '6px 10px', borderRadius: '7px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>Save</button>
                  <button type="button" disabled={busyId === m.id} onClick={() => setRenamingId(null)} style={{ padding: '6px 10px', borderRadius: '7px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                </div>
              ) : (
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#0F172A', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {m.name}
                  <button type="button" onClick={() => startRename(m)} style={{ padding: 0, border: 'none', background: 'none', color: '#94A3B8', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}>Rename</button>
                </div>
              )}
              <div style={{ fontSize: '12.5px', color: '#64748B' }}>
                {memberRoleLabels[m.role]}{m.orientation ? ` · ${m.orientation}` : ' · permanent'} · {m.email}
              </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <select
                value={m.position ?? ''}
                disabled={busyId === m.id || permanent}
                onChange={(e) => handlePositionChange(m.id, e.target.value)}
                title={permanent ? 'Permanent account — title is managed outside the committee roster.' : undefined}
                style={{ ...fieldStyle, width: '220px', opacity: permanent ? 0.6 : 1 }}
              >
                <option value="">No title</option>
                {positions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleRevoke(m)}
                disabled={busyId === m.id || permanent}
                title={permanent ? 'Permanent account — can\'t be revoked here.' : undefined}
                style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#FEE2E2', color: '#EF4444', fontWeight: 700, fontSize: '13px', cursor: permanent ? 'not-allowed' : 'pointer', opacity: permanent ? 0.6 : 1 }}
              >
                Revoke
              </button>
            </div>

            {rowError && rowError.id === m.id && (
              <div style={{ width: '100%', fontSize: '12.5px', color: '#B91C1C', fontWeight: 600, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '7px 10px' }}>
                {rowError.message}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
