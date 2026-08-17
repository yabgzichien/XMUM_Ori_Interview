'use client'

import { useMemo, useState } from 'react'
import { formatDateHeading, toLocalDateIso } from '@/lib/booking-helpers'
import { inviteApprovedBookingAction } from '@/app/actions/inviteCommitteeAction'
import type { HeadBooking, Track, Orientation } from '@/lib/head'
import { errorMessage } from '@/lib/utils'
import { useToast } from '@/components/Toast'

type Props = {
  bookings: HeadBooking[]
  loading: boolean
  error: string | null
  track: Track
  orientation: Orientation
  orientationYear?: number
  onChanged: () => void
}

const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

function formatDateTime(iso: string): string {
  return `${formatDateHeading(toLocalDateIso(iso))} · ${timeFormatter.format(new Date(iso))}`
}

const resendBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: 'none',
  background: '#EFF6FF',
  color: '#2563EB',
  fontWeight: 700,
  fontSize: '13px',
  cursor: 'pointer',
  transition: 'background .15s',
}

// Screens and tracks whether approved applicants who were sent a committee
// invite (BookingsTable's "Invite" action) have actually registered — i.e.
// claimed that invite by setting a password. Reuses the bookings already
// fetched by HeadDashboard (head_bookings now carries invite status, 0031)
// rather than a separate fetch.
export function InvitesTable({ bookings, loading, error, track, orientation, orientationYear = 2026, onChanged }: Props) {
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const { showToast, toastElement } = useToast()

  const invited = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return bookings
      .filter((b) => !!b.invited_at)
      .filter((b) => {
        if (!needle) return true
        return (
          b.applicant_name?.toLowerCase().includes(needle) ||
          b.applicant_email?.toLowerCase().includes(needle) ||
          b.student_id?.toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => new Date(b.invited_at as string).getTime() - new Date(a.invited_at as string).getTime())
  }, [bookings, filter])

  const registeredCount = invited.filter((b) => b.invite_claimed_at).length

  async function handleResend(b: HeadBooking) {
    if (!window.confirm(`Resend the committee invite code to ${b.applicant_name}?`)) return
    setBusyId(b.booking_id)
    try {
      const res = await inviteApprovedBookingAction(b.booking_id, track, orientation, orientationYear)
      if (res.error) {
        showToast(`Failed to resend to ${b.applicant_name}: ${res.error}`, 'error')
      } else if (res.status === 'already_claimed') {
        showToast(`${b.applicant_name} already registered.`, 'info')
      } else {
        showToast(`Invite code resent to ${b.applicant_name}.`, 'success')
      }
      if (!res.error) onChanged()
    } catch (err: unknown) {
      showToast(`Failed to resend to ${b.applicant_name}: ${errorMessage(err)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ minHeight: '380px', display: 'flex', flexDirection: 'column' }}>
      {toastElement}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #EAEEF4', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', background: '#FAFBFD' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</label>
          <input
            type="text"
            placeholder="Filter by name, email, or ID..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: '100%', maxWidth: '280px', padding: '8px 12px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '13.5px', fontFamily: 'inherit', color: '#0F172A', outline: 'none' }}
          />
        </div>
        {invited.length > 0 && (
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>
            <span style={{ color: '#15803D' }}>{registeredCount}</span> / {invited.length} registered
          </div>
        )}
      </div>

      {loading && <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>}
      {error && <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>}

      {!loading && !error && invited.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
          No committee invites sent yet — invite approved applicants from the Booked Applicants tab.
        </div>
      )}

      {!loading && !error && invited.length > 0 && (
        <div style={{ width: '100%' }}>
          <style>{`
            .tbl-mob { display: none !important; }
            .tbl-desk { display: table !important; width: 100%; }
            @media (max-width: 840px) {
              .tbl-desk { display: none !important; }
              .tbl-mob { display: block !important; }
            }
          `}</style>

          {/* Desktop Table */}
          <table className="tbl-desk" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #EAEEF4' }}>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Applicant</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Invited</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Registration Status</th>
                <th style={{ padding: '16px 20px' }}></th>
              </tr>
            </thead>
            <tbody>
              {invited.map((b) => (
                <tr key={b.booking_id} style={{ borderBottom: '1px solid #EAEEF4' }}>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{b.applicant_name}</div>
                    <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{b.applicant_email}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '13.5px', color: '#475569', fontWeight: 600 }}>{formatDateTime(b.invited_at as string)}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    {b.invite_claimed_at ? (
                      <div>
                        <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', background: '#ECFDF3', color: '#15803D', fontSize: '12px', fontWeight: 700 }}>Registered</span>
                        <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '4px' }}>{formatDateTime(b.invite_claimed_at)}</div>
                      </div>
                    ) : (
                      <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', background: '#FEF3C7', color: '#B45309', fontSize: '12px', fontWeight: 700 }}>Not yet registered</span>
                    )}
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle', textAlign: 'right' }}>
                    {!b.invite_claimed_at && (
                      <button
                        type="button"
                        disabled={busyId === b.booking_id}
                        onClick={() => handleResend(b)}
                        style={{ ...resendBtnStyle, opacity: busyId === b.booking_id ? 0.7 : 1, cursor: busyId === b.booking_id ? 'not-allowed' : 'pointer' }}
                      >
                        {busyId === b.booking_id ? 'Sending...' : 'Send Invite Again'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile list */}
          <div className="tbl-mob">
            {invited.map((b) => (
              <div key={b.booking_id} style={{ borderBottom: '1px solid #EAEEF4', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{b.applicant_name}</div>
                    <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{b.applicant_email}</div>
                  </div>
                  {b.invite_claimed_at ? (
                    <span style={{ display: 'inline-flex', padding: '4px 8px', borderRadius: '6px', background: '#ECFDF3', color: '#15803D', fontSize: '11px', fontWeight: 700 }}>Registered</span>
                  ) : (
                    <span style={{ display: 'inline-flex', padding: '4px 8px', borderRadius: '6px', background: '#FEF3C7', color: '#B45309', fontSize: '11px', fontWeight: 700 }}>Pending</span>
                  )}
                </div>
                <div style={{ fontSize: '12.5px', color: '#64748B' }}>
                  Invited {formatDateTime(b.invited_at as string)}
                  {b.invite_claimed_at && <> · Registered {formatDateTime(b.invite_claimed_at)}</>}
                </div>
                {!b.invite_claimed_at && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      disabled={busyId === b.booking_id}
                      onClick={() => handleResend(b)}
                      style={{ ...resendBtnStyle, opacity: busyId === b.booking_id ? 0.7 : 1, cursor: busyId === b.booking_id ? 'not-allowed' : 'pointer' }}
                    >
                      {busyId === b.booking_id ? 'Sending...' : 'Send Invite Again'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
