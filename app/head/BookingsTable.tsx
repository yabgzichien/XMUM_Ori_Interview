import { useMemo, useState } from 'react'
import { formatDateHeading, formatTimeRange, isPastSlot, toLocalDateIso } from '@/lib/booking-helpers'
import { cancelBooking, deleteBookings, type HeadBooking } from '@/lib/head'
import type { Orientation, Track } from '@/lib/head'
import { trackBadgeStyle, trackLabel } from '@/lib/tracks'
import { DateRangePicker, type DateRange } from '@/components/DateRangePicker'
import { saveInterviewNotesAction } from '@/app/actions/saveNotesAction'
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
  isAdmin?: boolean
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: 'none',
  background: 'var(--bg-card-hover, #F1F5F9)',
  color: 'var(--text-secondary, #475569)',
  fontWeight: 700,
  fontSize: '13px',
  cursor: 'pointer',
  transition: 'background .15s',
}

export function BookingsTable({ bookings, loading, error, track, orientation, orientationYear = 2026, onChanged, isAdmin = false }: Props) {
  const [filter, setFilter] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<HeadBooking | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null })
  const [showPast, setShowPast] = useState<boolean>(true)
  const [notesValue, setNotesValue] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { showToast, toastElement } = useToast()

  async function handleExportExcel() {
    setExporting(true)
    try {
      const exportTrack = track
      const params = new URLSearchParams({
        track: exportTrack,
        orientation,
        year: String(orientationYear),
      })
      if (dateRange.start) {
        params.set('startDate', toLocalDateIso(dateRange.start.toISOString()))
      }
      if (dateRange.end) {
        params.set('endDate', toLocalDateIso(dateRange.end.toISOString()))
      }

      const res = await fetch(`/api/export/bookings?${params.toString()}`)
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || `Export failed with status ${res.status}`)
      }

      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition')
      let filename = `${orientation}_${orientationYear}_${trackLabel(exportTrack).replace(/ /g, '_')}_Interview_Time_Slot_Export.xlsx`
      if (disposition) {
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;\n]+)/i)
        if (utf8Match && utf8Match[1]) {
          filename = decodeURIComponent(utf8Match[1])
        } else {
          const regularMatch = disposition.match(/filename="?([^";]+)"?/i)
          if (regularMatch && regularMatch[1]) {
            filename = decodeURIComponent(regularMatch[1])
          }
        }
      }

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      showToast('Excel file downloaded successfully.', 'success')
    } catch (err: unknown) {
      showToast(`Failed to export Excel: ${errorMessage(err)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

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

  // Only rows still visible under the current filters count as selected, so a
  // filter change can never delete records the admin can no longer see.
  const visibleSelected = useMemo(
    () => filtered.filter((b) => selectedIds.has(b.booking_id)).map((b) => b.booking_id),
    [filtered, selectedIds],
  )
  const allVisibleSelected = filtered.length > 0 && visibleSelected.length === filtered.length

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(filtered.map((b) => b.booking_id)))
  }

  async function handleDeleteSelected() {
    const ids = visibleSelected
    if (ids.length === 0) return
    if (!window.confirm(`Permanently delete ${ids.length} booking record${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) {
      return
    }
    setDeleting(true)
    const { data: deletedIds, error: deleteErr } = await deleteBookings(ids)
    setDeleting(false)
    if (deleteErr) {
      showToast(deleteErr.message, 'error')
      return
    }
    setSelectedIds(new Set())
    if (deletedIds.length < ids.length) {
      showToast(`Deleted ${deletedIds.length} of ${ids.length} records. The rest could not be deleted.`, 'error')
    } else {
      showToast(`Deleted ${deletedIds.length} booking record${deletedIds.length === 1 ? '' : 's'}.`, 'success')
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
      showToast(cancelErr.message, 'error')
      return
    }
    showToast(`${b.applicant_name}'s booking cancelled — the seat is free again.`, 'success')
    onChanged()
  }

  return (
    <div style={{ minHeight: '380px', display: 'flex', flexDirection: 'column' }}>
      {toastElement}
      {/* Combined Search & Filter Bar */}
      <div className="bookings-filter-bar" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-card, #EAEEF4)', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end', background: 'var(--bg-card-subtle, #FAFBFD)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</label>
          <input
            type="text"
            placeholder="Filter by name, email, or ID..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: '100%', maxWidth: '280px', padding: '8px 12px', border: '1px solid var(--border-input, #E2E8F0)', borderRadius: '8px', fontSize: '13.5px', fontFamily: 'inherit', color: 'var(--text-primary, #0F172A)', background: 'var(--bg-input, #fff)', outline: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter by Date Range</label>
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
          <label htmlFor="show-past-bookings-toggle" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-secondary, #334155)', cursor: 'pointer' }}>
            Show past bookings
          </label>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', height: '36px', flexWrap: 'wrap' }}>
          {isAdmin && visibleSelected.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={deleting}
                style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--text-secondary, #475569)', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={deleting}
                style={{
                  padding: '8px 15px',
                  borderRadius: '8px',
                  border: '1px solid var(--btn-danger-border, #FECACA)',
                  background: 'var(--btn-danger-bg, #FEE2E2)',
                  color: 'var(--btn-danger-text, #B91C1C)',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.7 : 1,
                }}
              >
                {deleting ? 'Deleting...' : `Delete selected (${visibleSelected.length})`}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting}
            style={{
              padding: '8px 15px',
              borderRadius: '8px',
              border: '1px solid var(--border-input, #CBD5E1)',
              background: 'var(--bg-card, #fff)',
              color: 'var(--text-secondary, #334155)',
              fontSize: '13.5px',
              fontWeight: 700,
              cursor: exporting ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
              opacity: exporting ? 0.7 : 1,
            }}
          >
            <span>📊</span> {exporting ? 'Exporting...' : 'Export to Excel'}
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: '20px', color: 'var(--text-muted, #64748B)', fontSize: '14px' }}>Loading...</div>}
      {error && <div style={{ padding: '20px', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '14px' }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted, #64748B)', fontSize: '14px' }}>No bookings found.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={{ width: '100%' }}>
          <style>{`
            .tbl-mob { display: none !important; }
            .tbl-desk { display: table !important; width: 100%; }
            .booking-row { transition: background-color 0.15s; }
            .booking-row:hover { background-color: var(--bg-card-hover, #F8FAFC); }
            .booking-card { transition: background-color 0.15s; }
            .booking-card:hover { background-color: var(--bg-card-hover, #F8FAFC); }
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
              <tr style={{ borderBottom: '1px solid var(--border-card, #EAEEF4)' }}>
                {isAdmin && (
                  <th style={{ padding: '16px 0 16px 20px', width: '20px' }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible bookings"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                  </th>
                )}
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-muted, #64748B)', letterSpacing: '.02em' }}>Applicant</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-muted, #64748B)', letterSpacing: '.02em' }}>Student ID</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-muted, #64748B)', letterSpacing: '.02em' }}>Position</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-muted, #64748B)', letterSpacing: '.02em' }}>Venue</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-muted, #64748B)', letterSpacing: '.02em' }}>Time</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-muted, #64748B)', letterSpacing: '.02em' }}>Contact Number</th>
                <th style={{ padding: '16px 20px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.booking_id}
                  className="booking-row"
                  style={{ borderBottom: '1px solid var(--border-card, #EAEEF4)', cursor: 'pointer' }}
                  onClick={() => { setSelectedBooking(b); setNotesValue(b.interview_notes ?? ''); setNotesSaved(false) }}
                >
                  {isAdmin && (
                    <td style={{ padding: '18px 0 18px 20px', verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${b.applicant_name}`}
                        checked={selectedIds.has(b.booking_id)}
                        onChange={() => toggleSelected(b.booking_id)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                    </td>
                  )}
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary, #0F172A)', marginBottom: '2px' }}>{b.applicant_name}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted, #64748B)', fontWeight: 500 }}>{b.applicant_email}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #0F172A)' }}>{b.student_id ?? '-'}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <span style={{
                      display: 'inline-flex',
                      padding: '3.5px 8px',
                      borderRadius: '6px',
                      ...trackBadgeStyle(b.track || track),
                      fontSize: '11.5px',
                      fontWeight: 700
                    }}>
                      {trackLabel(b.track || track)}
                    </span>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>{b.venue || '—'}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '13.5px', color: 'var(--text-secondary, #475569)', fontWeight: 600, marginBottom: '2px' }}>{formatDateHeading(toLocalDateIso(b.starts_at))}</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-muted, #64748B)' }}>{formatTimeRange(b.starts_at, b.ends_at)}</div>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle', maxWidth: '200px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary, #475569)', lineHeight: 1.5, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.experiences || <span style={{ opacity: 0.5 }}>-</span>}
                    </p>
                  </td>
                  <td style={{ padding: '18px 20px', verticalAlign: 'middle', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px' }}>
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
                style={{ borderBottom: '1px solid var(--border-card, #EAEEF4)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px', cursor: 'pointer' }}
                onClick={() => { setSelectedBooking(b); setNotesValue(b.interview_notes ?? ''); setNotesSaved(false) }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
                  {isAdmin && (
                    <label onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary, #475569)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(b.booking_id)}
                        onChange={() => toggleSelected(b.booking_id)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      Select
                    </label>
                  )}
                  <div style={{ minWidth: 0, maxWidth: '100%' }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary, #0F172A)', marginBottom: '2px', wordBreak: 'break-word' }}>{b.applicant_name}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted, #64748B)', fontWeight: 500, wordBreak: 'break-word' }}>{b.applicant_email}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary, #0F172A)', background: 'var(--bg-card-subtle, #F8FAFC)', padding: '4px 8px', borderRadius: '6px' }}>{b.student_id ?? '-'}</span>
                    <span style={{
                      display: 'inline-flex',
                      padding: '3.5px 8px',
                      borderRadius: '6px',
                      ...trackBadgeStyle(b.track || track),
                      fontSize: '11.5px',
                      fontWeight: 700
                    }}>{trackLabel(b.track || track)}</span>
                  </div>
                </div>
                <div style={{ background: 'var(--bg-card-subtle, #F8FAFC)', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted, #64748B)' }}><span style={{ fontWeight: 600, color: 'var(--text-secondary, #334155)' }}>Date:</span> {formatDateHeading(toLocalDateIso(b.starts_at))}</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted, #64748B)' }}><span style={{ fontWeight: 600, color: 'var(--text-secondary, #334155)' }}>Time:</span> {formatTimeRange(b.starts_at, b.ends_at)}</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted, #64748B)' }}><span style={{ fontWeight: 600, color: 'var(--text-secondary, #334155)' }}>Venue:</span> {b.venue || '—'}</div>
                </div>
                {b.experiences && (
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary, #475569)', lineHeight: 1.5, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    <strong style={{ color: 'var(--text-primary, #334155)', display: 'block', marginBottom: '2px' }}>Contact Number:</strong>
                    {b.experiences}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '4px' }}>
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
                  background: 'var(--bg-card, #fff)',
                  borderRadius: '20px',
                  width: '100%',
                  maxWidth: '560px',
                  maxHeight: '90vh',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                  border: '1px solid var(--border-card, #EAEEF4)',
                  display: 'flex',
                  flexDirection: 'column',
                  animation: 'scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  overflow: 'hidden',
                }}
              >
                {/* Modal Header */}
                <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid var(--border-card, #EAEEF4)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
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
                      ...trackBadgeStyle(selectedBooking.track || track),
                    }}>
                      {trackLabel(selectedBooking.track || track)}
                    </span>
                    <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary, #0F172A)', margin: 0 }}>
                      {selectedBooking.applicant_name}
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedBooking(null)}
                    style={{
                      border: 'none',
                      background: 'var(--bg-card-hover, #F1F5F9)',
                      color: 'var(--text-muted, #64748B)',
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
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Email Address</label>
                      <div style={{ fontSize: '14.5px', color: 'var(--text-primary, #0F172A)', fontWeight: 600 }}>{selectedBooking.applicant_email}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Student ID</label>
                      <div style={{ fontSize: '14.5px', color: 'var(--text-primary, #0F172A)', fontWeight: 600 }}>{selectedBooking.student_id ?? '-'}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Position</label>
                      <div style={{ fontSize: '14.5px', color: 'var(--text-primary, #0F172A)', fontWeight: 600 }}>{trackLabel(selectedBooking.track || track)}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Venue</label>
                      <div style={{ fontSize: '14.5px', color: 'var(--text-primary, #0F172A)', fontWeight: 600 }}>{selectedBooking.venue || '—'}</div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Interview Time</label>
                      <div style={{ fontSize: '14.5px', color: 'var(--text-primary, #0F172A)', fontWeight: 600, lineHeight: 1.45 }}>
                        {formatDateHeading(toLocalDateIso(selectedBooking.starts_at))}<br />
                        <span style={{ fontSize: '13px', color: 'var(--text-muted, #64748B)', fontWeight: 500 }}>
                          {formatTimeRange(selectedBooking.starts_at, selectedBooking.ends_at)}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Booked On</label>
                      <div style={{ fontSize: '14.5px', color: 'var(--text-primary, #0F172A)', fontWeight: 600 }}>
                        {formatDateHeading(toLocalDateIso(selectedBooking.created_at))}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Booking Code</label>
                      <div style={{ fontSize: '13.5px', fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-primary, #0F172A)', fontWeight: 600 }}>
                        {selectedBooking.booking_id}
                      </div>
                    </div>
                  </div>

                  {/* Contact Number Section */}
                  <div style={{ marginTop: '4px' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Contact Number</label>
                    <div style={{
                      background: 'var(--bg-card-subtle, #F8FAFC)',
                      border: '1px solid var(--border-card, #EAEEF4)',
                      borderRadius: '12px',
                      padding: '16px',
                      fontSize: '14px',
                      lineHeight: 1.6,
                      color: 'var(--text-secondary, #334155)',
                      maxHeight: '220px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {selectedBooking.experiences || <span style={{ color: 'var(--text-muted, #94A3B8)', fontStyle: 'italic' }}>No contact number specified.</span>}
                    </div>
                  </div>

                  {/* Interview Evaluation Notes */}
                  <div style={{ marginTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Evaluation Notes</label>
                      {notesSaved && (
                        <span style={{ fontSize: '11.5px', color: 'var(--badge-success-text, #15803D)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                        border: '1px solid var(--border-input, #E2E8F0)',
                        borderRadius: '12px',
                        fontSize: '13.5px',
                        fontFamily: 'inherit',
                        color: 'var(--text-primary, #0F172A)',
                        outline: 'none',
                        resize: 'vertical',
                        lineHeight: 1.6,
                        background: 'var(--bg-input, #FAFBFD)',
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
                          showToast(`Failed to save notes: ${res.error}`, 'error')
                        }
                      }}
                      style={{
                        marginTop: '8px',
                        padding: '8px 18px',
                        borderRadius: '8px',
                        border: 'none',
                        background: notesSaving ? 'var(--text-muted, #94A3B8)' : 'var(--text-secondary, #334155)',
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
                <div style={{ padding: '20px 28px 24px', borderTop: '1px solid var(--border-card, #EAEEF4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'inline-flex', gap: '10px' }}>
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
                        border: '1px solid var(--btn-danger-border, #FECACA)',
                        background: 'var(--btn-danger-bg, #FEE2E2)',
                        color: 'var(--btn-danger-text, #EF4444)',
                        fontWeight: 700,
                        fontSize: '13.5px',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      Cancel Booking
                    </button>
                  </div>
                  <button
                    onClick={() => setSelectedBooking(null)}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-input, #E2E8F0)',
                      background: 'var(--bg-card, #fff)',
                      color: 'var(--text-secondary, #334155)',
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
        </div>
      )}
    </div>
  )
}

