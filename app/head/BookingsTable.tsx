import { useMemo, useState } from 'react'
import { formatDateHeading, formatTimeRange, isPastSlot, toLocalDateIso } from '@/lib/booking-helpers'
import { cancelBooking, updateInterviewStatus, type HeadBooking } from '@/lib/head'
import type { Orientation } from '@/lib/head'
import { DateRangePicker, type DateRange } from '@/components/DateRangePicker'
import { sendBulkWelcomeEmailsAction } from '@/app/actions/bookingAction'
import { saveInterviewNotesAction } from '@/app/actions/saveNotesAction'
import { bulkInviteApprovedAction } from '@/app/actions/inviteCommitteeAction'

const DEFAULT_SUBJECT = `[XMUM Orientation] Welcome to the Committee! - {track}`
const DEFAULT_BODY = `Dear {name},

Congratulations! We are absolutely thrilled to inform you that you have been approved to join the XMUM Orientation Committee as a {track}!

The recruitment team was incredibly impressed by your interview performance, experiences, and enthusiasm. We believe you will be a fantastic addition to the team.

What's Next?

1. Onboarding Session: Keep an eye on your inbox for our official onboarding invitation, where we will share the project timeline and introduce the subcommittee leads.
2. Committee Chat: We will invite you to the main Committee communication channels (WhatsApp/Discord) within the next few days.
3. Get Ready: Get ready for an exciting journey of planning, teamwork, and welcoming the new freshmen!

Once again, welcome onboard! We are excited to work with you.`

type Props = {
  bookings: HeadBooking[]
  loading: boolean
  error: string | null
  track: 'facilitator' | 'game_master'
  orientation: Orientation
  orientationYear?: number
  onChanged: () => void
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: 'none',
  background: '#F1F5F9',
  color: '#475569',
  fontWeight: 700,
  fontSize: '13px',
  cursor: 'pointer',
  transition: 'background .15s',
}

function formatTrack(track: string | undefined | null): string {
  if (!track) return '-'
  if (track === 'game_master') return 'Game Master'
  if (track === 'facilitator') return 'Facilitator'
  return track.charAt(0).toUpperCase() + track.slice(1)
}

function formatStatusText(status: string | undefined | null): string {
  const s = status || 'pending'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function cycleStatus(current: string | undefined | null): 'pending' | 'approved' | 'failed' {
  const s = current || 'pending'
  if (s === 'pending') return 'approved'
  if (s === 'approved') return 'failed'
  return 'pending'
}

export function BookingsTable({ bookings, loading, error, track, orientation, orientationYear = 2026, onChanged }: Props) {
  const [filter, setFilter] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [selectedBooking, setSelectedBooking] = useState<HeadBooking | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null })
  const [showPast, setShowPast] = useState<boolean>(true)
  const [sendingBulk, setSendingBulk] = useState(false)
  const [invitingCommittee, setInvitingCommittee] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)

  const approvedBookings = useMemo(() => {
    return bookings.filter((b) => b.interview_status === 'approved')
  }, [bookings])

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return bookings.filter((b) => {
      if (needle) {
        const matchesText =
          b.applicant_name?.toLowerCase().includes(needle) ||
          b.applicant_email?.toLowerCase().includes(needle) ||
          b.student_id?.toLowerCase().includes(needle)
        if (!matchesText) return false
      }
      if (dateRange.start || dateRange.end) {
        const bookingDateStr = toLocalDateIso(b.starts_at)
        if (dateRange.start) {
          const startStr = toLocalDateIso(dateRange.start.toISOString())
          if (bookingDateStr < startStr) return false
        }
        if (dateRange.end) {
          const endStr = toLocalDateIso(dateRange.end.toISOString())
          if (bookingDateStr > endStr) return false
        }
      }
      const isPast = isPastSlot(b.ends_at)
      if (!showPast && isPast) {
        return false
      }
      return true
    })
  }, [bookings, filter, dateRange, showPast])

  const [showEmailEditor, setShowEmailEditor] = useState(false)
  const [customSubject, setCustomSubject] = useState('')
  const [customBody, setCustomBody] = useState('')

  async function handleBulkEmail() {
    if (approvedBookings.length === 0) return
    setCustomSubject(DEFAULT_SUBJECT)
    setCustomBody(DEFAULT_BODY)
    setShowEmailEditor(true)
  }

  async function executeBulkEmailSend() {
    setSendingBulk(true)
    try {
      const res = await sendBulkWelcomeEmailsAction(
        approvedBookings.map((b) => ({
          booking_id: b.booking_id,
          applicant_name: b.applicant_name,
          applicant_email: b.applicant_email,
          track: b.track,
        })),
        customSubject,
        customBody
      )
      alert(`Successfully sent ${res.successCount} welcome email(s)!${res.failCount > 0 ? ` (${res.failCount} failed)` : ''}`)
      setShowEmailEditor(false)
      onChanged()
    } catch (err: any) {
      alert(`Failed to trigger bulk emails: ${err.message || String(err)}`)
    } finally {
      setSendingBulk(false)
    }
  }

  async function handleInviteCommittee() {
    if (approvedBookings.length === 0) return
    if (!window.confirm(`Invite ${approvedBookings.length} approved applicant(s) to the committee?`)) return
    setInvitingCommittee(true)
    try {
      const res = await bulkInviteApprovedAction(track, orientation, orientationYear)
      if (res.error) {
        alert(`Failed to invite: ${res.error}`)
      } else {
        alert(
          `Invited ${res.invited} new committee member(s).` +
          (res.alreadyInvited ? ` ${res.alreadyInvited} already invited.` : '') +
          (res.alreadyClaimed ? ` ${res.alreadyClaimed} already active.` : '') +
          (res.failed ? ` ${res.failed} failed.` : '')
        )
      }
    } catch (err: any) {
      alert(`Failed to trigger committee invites: ${err.message || String(err)}`)
    } finally {
      setInvitingCommittee(false)
    }
  }

  async function handleStatusChange(bookingId: string, status: 'pending' | 'failed' | 'approved') {
    const { error: updateErr } = await updateInterviewStatus(bookingId, status)
    if (updateErr) {
      alert(updateErr.message)
      return
    }
    onChanged()
  }

  async function handleCancel(b: HeadBooking) {
    if (!window.confirm(`Cancel ${b.applicant_name}'s booking? This frees the seat.`)) {
      return
    }
    setCancellingId(b.booking_id)
    const { error: cancelErr } = await cancelBooking(b.booking_id)
    setCancellingId(null)
    if (cancelErr) {
      alert(cancelErr.message)
      return
    }
    onChanged()
  }

  return (
    <div style={{ minHeight: '380px', display: 'flex', flexDirection: 'column' }}>
      {/* Combined Search & Filter Bar */}
      <div className="bookings-filter-bar" style={{ padding: '16px 20px', borderBottom: '1px solid #EAEEF4', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end', background: '#FAFBFD' }}>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter by Date Range</label>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '36px' }}>
          <input
            type="checkbox"
            id="show-past-bookings-toggle"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label htmlFor="show-past-bookings-toggle" style={{ fontSize: '13.5px', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
            Show past bookings
          </label>
        </div>

        {approvedBookings.length > 0 && (
          <div className="bulk-email-btn" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', height: '36px' }}>
            <button
              type="button"
              onClick={handleInviteCommittee}
              disabled={invitingCommittee}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: '#2563EB',
                color: '#fff',
                fontSize: '13.5px',
                fontWeight: 700,
                cursor: invitingCommittee ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 12px -3px rgba(37,99,235,.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
                opacity: invitingCommittee ? 0.7 : 1,
              }}
            >
              <span>🎭</span> {invitingCommittee ? 'Inviting...' : `Invite Approved to Committee (${approvedBookings.length})`}
            </button>
            <button
              type="button"
              onClick={handleBulkEmail}
              disabled={sendingBulk}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: '#10B981',
                color: '#fff',
                fontSize: '13.5px',
                fontWeight: 700,
                cursor: sendingBulk ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 12px -3px rgba(16,185,129,.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
                opacity: sendingBulk ? 0.7 : 1,
              }}
            >
              <span>✉️</span> {sendingBulk ? 'Sending...' : `Bulk Email Approved (${approvedBookings.length})`}
            </button>
          </div>
        )}
      </div>

      {loading && <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>}
      {error && <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>No bookings found.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={{ width: '100%' }}>
          <style>{`
            .tbl-mob { display: none !important; }
            .tbl-desk { display: table !important; width: 100%; }
            .booking-row { transition: background-color 0.15s; }
            .booking-row:hover { background-color: #F8FAFC; }
            .booking-card { transition: background-color 0.15s; }
            .booking-card:hover { background-color: #F8FAFC; }
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes scaleIn {
              from { transform: scale(0.95); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
            .status-badge-btn { transition: all 0.15s ease; }
            .status-badge-btn:hover { transform: translateY(-1px); filter: brightness(0.96); box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
            .status-badge-btn:active { transform: translateY(0); }
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
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Student ID</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Position</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Venue</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Time</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Experiences</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Status</th>
                <th style={{ padding: '16px 20px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.booking_id}
                  className="booking-row"
                  style={{ borderBottom: '1px solid #EAEEF4', cursor: 'pointer' }}
                  onClick={() => { setSelectedBooking(b); setNotesValue(b.interview_notes ?? ''); setNotesSaved(false) }}
                >
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{b.applicant_name}</div>
                    <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{b.applicant_email}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>{b.student_id ?? '-'}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: (b.track || track) === 'game_master' ? '#F3F0FF' : '#EFF4FF', color: (b.track || track) === 'game_master' ? '#7C3AED' : '#2563EB', fontSize: '11.5px', fontWeight: 700 }}>{formatTrack(b.track || track)}</span>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 600, color: '#475569' }}>A1 #123</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '13.5px', color: '#475569', fontWeight: 600, marginBottom: '2px' }}>{formatDateHeading(toLocalDateIso(b.starts_at))}</div>
                    <div style={{ fontSize: '12.5px', color: '#64748B' }}>{formatTimeRange(b.starts_at, b.ends_at)}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle', maxWidth: '200px' }}>
                    <p style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.experiences || <span style={{ opacity: 0.5 }}>-</span>}
                    </p>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = cycleStatus(b.interview_status)
                        handleStatusChange(b.booking_id, next)
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '6px 12px',
                        borderRadius: '99px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: 'none',
                        transition: 'all 0.15s ease',
                        background: b.interview_status === 'approved' ? '#ECFDF3' : b.interview_status === 'failed' ? '#FEE2E2' : '#F1F5F9',
                        color: b.interview_status === 'approved' ? '#15803D' : b.interview_status === 'failed' ? '#B91C1C' : '#475569',
                      }}
                      className="status-badge-btn"
                    >
                      {formatStatusText(b.interview_status)}
                    </button>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle', textAlign: 'right' }}>
                    <button
                      type="button"
                      disabled={cancellingId === b.booking_id}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCancel(b)
                      }}
                      style={cancelBtnStyle}
                    >
                      {cancellingId === b.booking_id ? 'Cancelling...' : 'Cancel'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile Cards */}
          <div className="tbl-mob">
            {filtered.map((b) => (
              <div
                key={b.booking_id}
                className="booking-card"
                style={{ borderBottom: '1px solid #EAEEF4', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px', cursor: 'pointer' }}
                onClick={() => { setSelectedBooking(b); setNotesValue(b.interview_notes ?? ''); setNotesSaved(false) }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{b.applicant_name}</div>
                    <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{b.applicant_email}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', background: '#F8FAFC', padding: '4px 8px', borderRadius: '6px' }}>{b.student_id ?? '-'}</span>
                    <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: (b.track || track) === 'game_master' ? '#F3F0FF' : '#EFF4FF', color: (b.track || track) === 'game_master' ? '#7C3AED' : '#2563EB', fontSize: '11.5px', fontWeight: 700 }}>{formatTrack(b.track || track)}</span>
                  </div>
                </div>
                <div style={{ background: '#F8FAFC', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '12.5px', color: '#64748B' }}><span style={{ fontWeight: 600, color: '#334155' }}>Date:</span> {formatDateHeading(toLocalDateIso(b.starts_at))}</div>
                  <div style={{ fontSize: '12.5px', color: '#64748B' }}><span style={{ fontWeight: 600, color: '#334155' }}>Time:</span> {formatTimeRange(b.starts_at, b.ends_at)}</div>
                  <div style={{ fontSize: '12.5px', color: '#64748B' }}><span style={{ fontWeight: 600, color: '#334155' }}>Venue:</span> {b.venue || '—'}</div>
                </div>
                {b.experiences && (
                  <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    <strong style={{ color: '#334155', display: 'block', marginBottom: '2px' }}>Experiences:</strong>
                    {b.experiences}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 600 }}>Status:</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = cycleStatus(b.interview_status)
                        handleStatusChange(b.booking_id, next)
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '5px 12px',
                        borderRadius: '99px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: 'none',
                        transition: 'all 0.15s ease',
                        background: b.interview_status === 'approved' ? '#ECFDF3' : b.interview_status === 'failed' ? '#FEE2E2' : '#F1F5F9',
                        color: b.interview_status === 'approved' ? '#15803D' : b.interview_status === 'failed' ? '#B91C1C' : '#475569',
                      }}
                      className="status-badge-btn"
                    >
                      {formatStatusText(b.interview_status)}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={cancellingId === b.booking_id}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCancel(b)
                    }}
                    style={cancelBtnStyle}
                  >
                    {cancellingId === b.booking_id ? 'Cancelling...' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Detail Modal Overlay */}
          {selectedBooking && (
            <div
            className="candidate-modal-overlay"
              onClick={() => setSelectedBooking(null)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(15, 23, 42, 0.4)',
                backdropFilter: 'blur(6px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 999,
                padding: '20px',
                animation: 'fadeIn 0.2s ease-out',
              }}
            >
              <div
                className="candidate-modal-inner"
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#fff',
                  borderRadius: '20px',
                  width: '100%',
                  maxWidth: '560px',
                  maxHeight: '90vh',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                  border: '1px solid #EAEEF4',
                  display: 'flex',
                  flexDirection: 'column',
                  animation: 'scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  overflow: 'hidden',
                }}
              >
                {/* Modal Header */}
                <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid #EAEEF4', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{
                      display: 'inline-flex',
                      padding: '4.5px 10px',
                      borderRadius: '99px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: '10px',
                      background: (selectedBooking.track || track) === 'game_master' ? '#F3F0FF' : '#EFF4FF',
                      color: (selectedBooking.track || track) === 'game_master' ? '#7C3AED' : '#2563EB',
                    }}>
                      {formatTrack(selectedBooking.track || track)}
                    </span>
                    <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                      {selectedBooking.applicant_name}
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedBooking(null)}
                    style={{
                      border: 'none',
                      background: '#F1F5F9',
                      color: '#64748B',
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                    }}
                  >
                    ×
                  </button>
                </div>

                {/* Modal Body */}
                <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
                  {/* Profile Details Grid */}
                  <div className="modal-profile-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px 20px' }}>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Email Address</label>
                      <div style={{ fontSize: '14.5px', color: '#0F172A', fontWeight: 600 }}>{selectedBooking.applicant_email}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Student ID</label>
                      <div style={{ fontSize: '14.5px', color: '#0F172A', fontWeight: 600 }}>{selectedBooking.student_id ?? '-'}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Position</label>
                      <div style={{ fontSize: '14.5px', color: '#0F172A', fontWeight: 600 }}>{formatTrack(selectedBooking.track || track)}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Venue</label>
                      <div style={{ fontSize: '14.5px', color: '#0F172A', fontWeight: 600 }}>{selectedBooking.venue || '—'}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Interview Time</label>
                      <div style={{ fontSize: '14.5px', color: '#0F172A', fontWeight: 600, lineHeight: 1.45 }}>
                        {formatDateHeading(toLocalDateIso(selectedBooking.starts_at))}<br />
                        <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>
                          {formatTimeRange(selectedBooking.starts_at, selectedBooking.ends_at)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Booked On</label>
                      <div style={{ fontSize: '14.5px', color: '#0F172A', fontWeight: 600 }}>
                        {formatDateHeading(toLocalDateIso(selectedBooking.created_at))}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Booking Code</label>
                      <div style={{ fontSize: '13.5px', fontFamily: '"JetBrains Mono", monospace', color: '#0F172A', fontWeight: 600 }}>
                        {selectedBooking.booking_id}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Interview Status</label>
                      <button
                        type="button"
                        onClick={() => {
                          const next = cycleStatus(selectedBooking.interview_status)
                          handleStatusChange(selectedBooking.booking_id, next)
                          setSelectedBooking({ ...selectedBooking, interview_status: next })
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '8px 16px',
                          borderRadius: '99px',
                          fontSize: '13px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          border: 'none',
                          transition: 'all 0.15s ease',
                          background: selectedBooking.interview_status === 'approved' ? '#ECFDF3' : selectedBooking.interview_status === 'failed' ? '#FEE2E2' : '#F1F5F9',
                          color: selectedBooking.interview_status === 'approved' ? '#15803D' : selectedBooking.interview_status === 'failed' ? '#B91C1C' : '#475569',
                          marginTop: '4px',
                          width: '100%',
                          maxWidth: '130px',
                        }}
                        className="status-badge-btn"
                      >
                        {formatStatusText(selectedBooking.interview_status)}
                      </button>
                    </div>
                  </div>

                  {/* Experiences Section */}
                  <div style={{ marginTop: '4px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Experiences & Answers</label>
                    <div style={{
                      background: '#F8FAFC',
                      border: '1px solid #EAEEF4',
                      borderRadius: '12px',
                      padding: '16px',
                      fontSize: '14px',
                      lineHeight: 1.6,
                      color: '#334155',
                      maxHeight: '220px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {selectedBooking.experiences || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>No experiences specified.</span>}
                    </div>
                  </div>

                  {/* Interview Evaluation Notes */}
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Evaluation Notes</label>
                      {notesSaved && (
                        <span style={{ fontSize: '11.5px', color: '#15803D', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span>✓</span> Saved
                        </span>
                      )}
                    </div>
                    <textarea
                      value={notesValue}
                      onChange={(e) => { setNotesValue(e.target.value); setNotesSaved(false) }}
                      placeholder="Add interview evaluation notes, strengths, concerns, recommendations..."
                      rows={4}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        border: '1px solid #E2E8F0',
                        borderRadius: '12px',
                        fontSize: '13.5px',
                        fontFamily: 'inherit',
                        color: '#0F172A',
                        outline: 'none',
                        resize: 'vertical',
                        lineHeight: 1.6,
                        background: '#FAFBFD',
                        boxSizing: 'border-box',
                        transition: 'border-color 0.15s',
                      }}
                    />
                    <button
                      type="button"
                      disabled={notesSaving}
                      onClick={async () => {
                        setNotesSaving(true)
                        const res = await saveInterviewNotesAction(selectedBooking.booking_id, notesValue)
                        setNotesSaving(false)
                        if (res.success) {
                          setNotesSaved(true)
                          setSelectedBooking({ ...selectedBooking, interview_notes: notesValue })
                        } else {
                          alert(`Failed to save notes: ${res.error}`)
                        }
                      }}
                      style={{
                        marginTop: '8px',
                        padding: '8px 18px',
                        borderRadius: '8px',
                        border: 'none',
                        background: notesSaving ? '#94A3B8' : '#334155',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '13px',
                        cursor: notesSaving ? 'not-allowed' : 'pointer',
                        transition: 'background 0.15s',
                        float: 'right',
                      }}
                    >
                      {notesSaving ? 'Saving...' : 'Save Notes'}
                    </button>
                    <div style={{ clear: 'both' }} />
                  </div>
                </div>

                {/* Modal Footer */}
                <div style={{ padding: '20px 28px 24px', borderTop: '1px solid #EAEEF4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={cancellingId === selectedBooking.booking_id}
                    onClick={async () => {
                      const b = selectedBooking
                      setSelectedBooking(null)
                      await handleCancel(b)
                    }}
                    style={{
                      padding: '10px 16px',
                      borderRadius: '10px',
                      border: 'none',
                      background: '#FEE2E2',
                      color: '#EF4444',
                      fontWeight: 700,
                      fontSize: '13.5px',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    Cancel Booking
                  </button>
                  <button
                    onClick={() => setSelectedBooking(null)}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '10px',
                      border: '1px solid #E2E8F0',
                      background: '#fff',
                      color: '#334155',
                      fontWeight: 700,
                      fontSize: '13.5px',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Custom Welcome Email Editor Modal */}
          {showEmailEditor && (
            <div className="email-editor-modal-overlay" style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(15, 23, 42, 0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '20px',
              animation: 'fadeIn 0.18s ease-out',
            }}>
              <div className="email-editor-modal-inner" style={{
                background: '#fff',
                border: '1px solid #EAEEF4',
                borderRadius: '20px',
                width: '100%',
                maxWidth: '680px',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                overflow: 'hidden',
                animation: 'scaleIn 0.18s ease-out',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: '90vh',
              }}>
                {/* Header */}
                <div style={{ padding: '20px 24px', borderBottom: '1px solid #EAEEF4', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#0F172A' }}>Customize Welcome Email</h3>
                    <p style={{ fontSize: '12.5px', color: '#64748B', margin: '2px 0 0 0' }}>Edit the template to welcome {approvedBookings.length} approved applicant(s)</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEmailEditor(false)}
                    style={{ background: 'none', border: 'none', fontSize: '20px', color: '#94A3B8', cursor: 'pointer', padding: '4px' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Form */}
                <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
                  {/* Subject */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>Subject Line</label>
                    <input
                      type="text"
                      value={customSubject}
                      onChange={(e) => setCustomSubject(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '14.5px', fontFamily: 'inherit', color: '#0F172A', outline: 'none' }}
                    />
                  </div>

                  {/* Body */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>Email Message</label>
                      <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>Supports double-newlines for paragraphs</span>
                    </div>
                    <textarea
                      value={customBody}
                      onChange={(e) => setCustomBody(e.target.value)}
                      rows={10}
                      style={{ width: '100%', padding: '12px 14px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '14px', fontFamily: 'inherit', color: '#0F172A', outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
                    />
                  </div>

                  {/* Tips / Variables */}
                  <div style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', borderRadius: '10px', padding: '12px 14px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E40AF', display: 'block', marginBottom: '4px' }}>💡 Available Placeholders</span>
                    <span style={{ fontSize: '12px', color: '#1E40AF', lineHeight: 1.4 }}>
                      Use <code>{`{name}`}</code> to insert the candidate's full name, and <code>{`{track}`}</code> to insert their position (Facilitator or Game Master). These will update dynamically for each recipient.
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ padding: '16px 24px', borderTop: '1px solid #EAEEF4', background: '#F8FAFC', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setShowEmailEditor(false)}
                    style={{ padding: '10px 18px', borderRadius: '10px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={executeBulkEmailSend}
                    disabled={sendingBulk || !customSubject.trim() || !customBody.trim()}
                    style={{
                      padding: '10px 22px',
                      borderRadius: '10px',
                      border: 'none',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '14px',
                      background: '#10B981',
                      cursor: (sendingBulk || !customSubject.trim() || !customBody.trim()) ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 12px -3px rgba(16,185,129,.35)',
                      opacity: (sendingBulk || !customSubject.trim() || !customBody.trim()) ? 0.7 : 1
                    }}
                  >
                    {sendingBulk ? 'Sending Welcomes...' : `Send Welcomes (${approvedBookings.length})`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

