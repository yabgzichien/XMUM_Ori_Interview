'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  deleteInvite,
  listInvites,
  type StaffInvite,
  type StaffRole,
} from '@/lib/admin'
import { addInviteAction } from '@/app/actions/inviteAction'

const roleLabels: Record<StaffRole, string> = {
  head_facilitator: 'Head of Facilitators',
  head_gm: 'Head of Game Masters',
  admin: 'Admin',
}

export function AdminStaff() {
  const [invites, setInvites] = useState<StaffInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('head_facilitator')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await listInvites()
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      setInvites([])
      return
    }
    setLoadError(null)
    setInvites(data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    const { error } = await addInviteAction({ name, studentId, email, role })
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
    setRole('head_facilitator')
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

  const deleteBtnStyle = `padding:8px 14px;border-radius:8px;border:none;background:#FEE2E2;color:#EF4444;font-weight:700;font-size:13px;cursor:pointer;transition:background .15s`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Invite Form Card */}
      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '26px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>👋</div>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 2px' }}>Invite Committee</h2>
            <p style={{ fontSize: '12.5px', color: '#64748B', margin: 0 }}>Add a new administrator or head.</p>
          </div>
        </div>

        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
              />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Student ID (Optional)</label>
              <input
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
              />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569', backgroundColor: '#fff' }}
              >
                <option value="head_facilitator">Head of Facilitators</option>
                <option value="head_gm">Head of Game Masters</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <button type="submit" disabled={submitting} style={{ width: '100%', padding: '10.5px 18px', borderRadius: '9px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 12px -4px rgba(37,99,235,.4)', transition: 'all 0.15s', opacity: submitting ? 0.7 : 1 }}>
                {submitting ? 'Adding...' : 'Add invite'}
              </button>
            </div>
          </div>
        </form>
        {formError && <p style={{ marginTop: '14px', fontSize: '13px', color: '#B91C1C' }}>{formError}</p>}
      </div>

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
            {/* Desktop Table */}
            <table className="tbl-desk" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #EAEEF4' }}>
                  <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Committee Member</th>
                  <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Role</th>
                  <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Code/Status</th>
                  <th style={{ padding: '16px 20px' }}></th>
                </tr>
              </thead>
              <tbody />
            </table>

            <table className="w-full tbl-desk-wrapper-hack" style={{ borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="tbl-desk-row" style={{ borderBottom: '1px solid #EAEEF4' }}>
                    <td style={{ padding: '18px 20px' }}>
                      <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{inv.name}</div>
                      <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{inv.email}</div>
                    </td>
                    <td style={{ padding: '18px 20px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>{roleLabels[inv.role]}</div>
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
                        <button type="button" onClick={() => handleDelete(inv)} className="btn-del hover:bg-red-200" style={Object.fromEntries(deleteBtnStyle.split(';').map(x=>x.split(':')).filter(x=>x.length===2).map(x=>[x[0].replace(/-([a-z])/g, g=>g[1].toUpperCase()), x[1]])) as React.CSSProperties}>
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
                      <button type="button" onClick={() => handleDelete(inv)} className="btn-del hover:bg-red-200" style={Object.fromEntries(deleteBtnStyle.split(';').map(x=>x.split(':')).filter(x=>x.length===2).map(x=>[x[0].replace(/-([a-z])/g, g=>g[1].toUpperCase()), x[1]])) as React.CSSProperties}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <style>{`
               .tbl-desk-wrapper-hack thead { display: none; }
               @media (max-width: 640px) {
                 .tbl-desk { display: none !important; }
                 .tbl-desk-wrapper-hack { display: block; border-collapse: separate; }
                 .tbl-desk-wrapper-hack tbody { display: flex; flex-direction: column; width: 100%; }
               }
               .tbl-mob { display: none; }
               @media (max-width: 640px) {
                 .tbl-desk-wrapper-hack { display: none !important; }
                 .tbl-mob { display: block; }
               }
            `}</style>
          </div>
        )}
      </div>
    </div>
  )
}
