'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDateHeading, formatTimeRange, isPastSlot, toLocalDateIso } from '@/lib/booking-helpers'
import { bulkDeleteSlots, bulkUpdateSlots, deleteSlot, updateSlot, type HeadSlot } from '@/lib/head'
import { DateRangePicker, type DateRange } from '@/components/DateRangePicker'
import { useToast } from '@/components/Toast'

type Props = {
  slots: HeadSlot[]
  loading: boolean
  error: string | null
  onChanged: () => void
}

type StatusFilter = 'all' | 'open' | 'closed'

const actionBtnBase: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: '8px',
  border: 'none',
  fontWeight: 700,
  fontSize: '12.5px',
  cursor: 'pointer',
  transition: 'background .15s, opacity .15s',
  whiteSpace: 'nowrap',
}

const deleteBtnStyle: React.CSSProperties = { ...actionBtnBase, background: '#FEE2E2', color: '#EF4444' }
const neutralBtnStyle: React.CSSProperties = { ...actionBtnBase, background: '#F1F5F9', color: '#475569' }
const reopenBtnStyle: React.CSSProperties = { ...actionBtnBase, background: '#ECFDF3', color: '#15803D' }

const cellInputStyle: React.CSSProperties = {
  padding: '7px 9px',
  border: '1px solid #E2E8F0',
  borderRadius: '8px',
  fontSize: '13.5px',
  fontFamily: 'inherit',
  color: '#0F172A',
  background: '#fff',
  boxSizing: 'border-box',
}

/**
 * Shared per-row behaviour. `feedback` surfaces failures inline instead of in a
 * browser alert, so a rejected edit doesn't interrupt a run of quick fixes.
 */
function useSlotActions(slot: HeadSlot, onChanged: () => void) {
  const [capacity, setCapacity] = useState(slot.capacity.toString())
  const [venue, setVenue] = useState(slot.venue ?? '')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const isPast = isPastSlot(slot.ends_at)
  const seatsLeft = Math.max(0, slot.capacity - slot.booked_count)

  async function patch(update: Partial<Pick<HeadSlot, 'capacity' | 'status' | 'venue'>>) {
    setBusy(true)
    setFeedback(null)
    const { error } = await updateSlot(slot.id, update)
    setBusy(false)
    if (error) {
      setFeedback(error.message)
      return false
    }
    onChanged()
    return true
  }

  async function handleSaveCapacity() {
    const next = Number(capacity)
    if (!Number.isFinite(next) || next < 1) {
      setFeedback('Capacity must be at least 1.')
      setCapacity(slot.capacity.toString())
      return
    }
    if (next < slot.booked_count) {
      setFeedback(`Capacity can't drop below the ${slot.booked_count} seat(s) already booked.`)
      setCapacity(slot.capacity.toString())
      return
    }
    if (next === slot.capacity) {
      setFeedback(null)
      return
    }
    if (!(await patch({ capacity: next }))) setCapacity(slot.capacity.toString())
  }

  async function handleSaveVenue() {
    const next = venue.trim()
    if (!next) {
      setFeedback('Venue cannot be empty.')
      setVenue(slot.venue ?? '')
      return
    }
    if (next === (slot.venue ?? '')) return
    if (!(await patch({ venue: next }))) setVenue(slot.venue ?? '')
  }

  async function handleToggleStatus() {
    await patch({ status: slot.status === 'open' ? 'closed' : 'open' })
  }

  async function handleDelete() {
    if (slot.booked_count > 0) return
    if (!window.confirm('Delete this slot? It disappears from the public booking page.')) return
    setBusy(true)
    setFeedback(null)
    const { error } = await deleteSlot(slot.id)
    setBusy(false)
    if (error) {
      setFeedback(error.message)
      return
    }
    onChanged()
  }

  return {
    capacity, setCapacity,
    venue, setVenue,
    busy, isPast, seatsLeft, feedback,
    handleSaveCapacity, handleSaveVenue, handleToggleStatus, handleDelete,
  }
}

function StatusPill({ status, isPast }: { status: HeadSlot['status']; isPast: boolean }) {
  if (isPast) {
    return <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: '#F1F5F9', color: '#94A3B8', fontSize: '11.5px', fontWeight: 700 }}>Past</span>
  }
  return status === 'open' ? (
    <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: '#ECFDF3', color: '#15803D', fontSize: '11.5px', fontWeight: 700 }}>Open</span>
  ) : (
    <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: '#FEF3C7', color: '#B45309', fontSize: '11.5px', fontWeight: 700 }}>Closed</span>
  )
}

function SeatsBar({ booked, capacity }: { booked: number; capacity: number }) {
  const pct = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0
  const full = booked >= capacity
  return (
    <div style={{ minWidth: '86px' }}>
      <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A', marginBottom: '4px' }}>
        {booked}<span style={{ color: '#94A3B8', fontWeight: 600 }}> / {capacity}</span>
      </div>
      <div style={{ height: '4px', borderRadius: '99px', background: '#EEF2F7', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: full ? '#F97316' : '#2563EB', borderRadius: '99px', transition: 'width .2s' }} />
      </div>
    </div>
  )
}

function RowActions({
  slot, busy, isPast, onToggleStatus, onDelete,
}: {
  slot: HeadSlot
  busy: boolean
  isPast: boolean
  onToggleStatus: () => void
  onDelete: () => void
}) {
  const hasBookings = slot.booked_count > 0
  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      {!isPast && (
        <button
          disabled={busy}
          onClick={onToggleStatus}
          type="button"
          style={slot.status === 'open' ? neutralBtnStyle : reopenBtnStyle}
          title={slot.status === 'open' ? 'Hide this slot from applicants' : 'Make this slot bookable again'}
        >
          {slot.status === 'open' ? 'Close' : 'Reopen'}
        </button>
      )}
      <button
        disabled={busy || hasBookings}
        onClick={onDelete}
        type="button"
        style={{ ...deleteBtnStyle, opacity: hasBookings ? 0.5 : 1, cursor: hasBookings ? 'not-allowed' : 'pointer' }}
        title={hasBookings ? 'Cancel its bookings first' : 'Delete slot'}
      >
        Delete
      </button>
    </div>
  )
}

function SlotRowDesktop({
  slot, onChanged, selected, onToggleSelect,
}: {
  slot: HeadSlot
  onChanged: () => void
  selected: boolean
  onToggleSelect: () => void
}) {
  const a = useSlotActions(slot, onChanged)

  return (
    <>
      <tr style={{ borderBottom: a.feedback ? 'none' : '1px solid #EAEEF4', opacity: a.isPast ? 0.62 : 1, background: selected ? '#F5F8FF' : 'transparent' }}>
        <td style={{ padding: '16px 12px 16px 20px', width: '32px' }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            aria-label="Select slot"
          />
        </td>
        <td style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>
            {formatDateHeading(toLocalDateIso(slot.starts_at))}
          </div>
          <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>
            {formatTimeRange(slot.starts_at, slot.ends_at)}
          </div>
        </td>
        <td style={{ padding: '16px 20px' }}>
          <input
            type="text"
            value={a.venue}
            placeholder="Venue required"
            onChange={(e) => a.setVenue(e.target.value)}
            onBlur={a.handleSaveVenue}
            disabled={a.busy || a.isPast}
            style={{ ...cellInputStyle, width: '130px' }}
          />
        </td>
        <td style={{ padding: '16px 20px' }}>
          <input
            type="number"
            min={1}
            value={a.capacity}
            onChange={(e) => a.setCapacity(e.target.value)}
            onBlur={a.handleSaveCapacity}
            disabled={a.busy || a.isPast}
            style={{ ...cellInputStyle, width: '62px', textAlign: 'center' }}
          />
        </td>
        <td style={{ padding: '16px 20px' }}>
          <SeatsBar booked={slot.booked_count} capacity={slot.capacity} />
        </td>
        <td style={{ padding: '16px 20px' }}>
          <StatusPill status={slot.status} isPast={a.isPast} />
        </td>
        <td style={{ padding: '16px 20px', textAlign: 'right' }}>
          <RowActions slot={slot} busy={a.busy} isPast={a.isPast} onToggleStatus={a.handleToggleStatus} onDelete={a.handleDelete} />
        </td>
      </tr>
      {a.feedback && (
        <tr style={{ borderBottom: '1px solid #EAEEF4' }}>
          <td colSpan={7} style={{ padding: '0 20px 12px' }}>
            <div style={{ fontSize: '12.5px', color: '#B91C1C', fontWeight: 600, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '7px 10px' }}>
              {a.feedback}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function SlotRowMobile({
  slot, onChanged, selected, onToggleSelect,
}: {
  slot: HeadSlot
  onChanged: () => void
  selected: boolean
  onToggleSelect: () => void
}) {
  const a = useSlotActions(slot, onChanged)

  return (
    <div style={{ borderBottom: '1px solid #EAEEF4', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px', opacity: a.isPast ? 0.62 : 1, background: selected ? '#F5F8FF' : 'transparent' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            style={{ width: '16px', height: '16px', cursor: 'pointer', marginTop: '3px' }}
            aria-label="Select slot"
          />
          <div>
            <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>
              {formatDateHeading(toLocalDateIso(slot.starts_at))}
            </div>
            <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>
              {formatTimeRange(slot.starts_at, slot.ends_at)}
            </div>
          </div>
        </div>
        <StatusPill status={slot.status} isPast={a.isPast} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: '10px', alignItems: 'end' }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '4px' }}>Venue</span>
          <input
            type="text"
            value={a.venue}
            placeholder="Venue required"
            onChange={(e) => a.setVenue(e.target.value)}
            onBlur={a.handleSaveVenue}
            disabled={a.busy || a.isPast}
            style={{ ...cellInputStyle, width: '100%' }}
          />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '4px' }}>Seats</span>
          <input
            type="number"
            min={1}
            value={a.capacity}
            onChange={(e) => a.setCapacity(e.target.value)}
            onBlur={a.handleSaveCapacity}
            disabled={a.busy || a.isPast}
            style={{ ...cellInputStyle, width: '100%', textAlign: 'center' }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <SeatsBar booked={slot.booked_count} capacity={slot.capacity} />
        <RowActions slot={slot} busy={a.busy} isPast={a.isPast} onToggleStatus={a.handleToggleStatus} onDelete={a.handleDelete} />
      </div>

      {a.feedback && (
        <div style={{ fontSize: '12.5px', color: '#B91C1C', fontWeight: 600, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '7px 10px' }}>
          {a.feedback}
        </div>
      )}
    </div>
  )
}

function BulkEditModal({
  count, onClose, onApply,
}: {
  count: number
  onClose: () => void
  onApply: (patch: Partial<Pick<HeadSlot, 'capacity' | 'status' | 'venue'>>) => Promise<void>
}) {
  const [applyCapacity, setApplyCapacity] = useState(false)
  const [capacity, setCapacity] = useState('')
  const [applyVenue, setApplyVenue] = useState(false)
  const [venue, setVenue] = useState('')
  const [status, setStatus] = useState<'no-change' | 'open' | 'closed'>('no-change')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const nothingToApply = !applyCapacity && !applyVenue && status === 'no-change'

  async function handleApply() {
    setFormError(null)
    const patch: Partial<Pick<HeadSlot, 'capacity' | 'status' | 'venue'>> = {}

    if (applyCapacity) {
      const next = Number(capacity)
      if (!Number.isFinite(next) || next < 1) {
        setFormError('Capacity must be at least 1.')
        return
      }
      patch.capacity = next
    }
    if (applyVenue) {
      if (!venue.trim()) {
        setFormError('Venue cannot be empty.')
        return
      }
      patch.venue = venue.trim()
    }
    if (status !== 'no-change') patch.status = status

    setBusy(true)
    await onApply(patch)
    setBusy(false)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 999, padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '440px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,.1), 0 10px 10px -5px rgba(0,0,0,.04)',
          border: '1px solid #EAEEF4', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EAEEF4' }}>
          <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#0F172A', margin: '0 0 2px' }}>Bulk edit slots</h3>
          <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Applies to {count} selected slot{count === 1 ? '' : 's'}. Leave a field off to keep it unchanged.</p>
        </div>

        <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={applyCapacity} onChange={(e) => setApplyCapacity(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#334155' }}>Set capacity</span>
            </label>
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              disabled={!applyCapacity}
              placeholder="e.g. 2"
              style={{ ...cellInputStyle, width: '100%', opacity: applyCapacity ? 1 : 0.5 }}
            />
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={applyVenue} onChange={(e) => setApplyVenue(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#334155' }}>Set venue</span>
            </label>
            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              disabled={!applyVenue}
              placeholder="e.g. A1#G02"
              style={{ ...cellInputStyle, width: '100%', opacity: applyVenue ? 1 : 0.5 }}
            />
          </div>

          <div>
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '8px' }}>Set status</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {([
                { value: 'no-change', label: 'No change' },
                { value: 'open', label: 'Open' },
                { value: 'closed', label: 'Closed' },
              ] as const).map((opt) => {
                const active = status === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatus(opt.value)}
                    style={{
                      padding: '8px 14px', borderRadius: '8px', border: `1px solid ${active ? '#2563EB' : '#E2E8F0'}`,
                      background: active ? '#EFF4FF' : '#fff', color: active ? '#2563EB' : '#64748B',
                      fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {formError && (
            <div style={{ fontSize: '12.5px', color: '#B91C1C', fontWeight: 600, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '7px 10px' }}>
              {formError}
            </div>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #EAEEF4', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...actionBtnBase, padding: '10px 16px', background: '#F1F5F9', color: '#475569' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={busy || nothingToApply}
            style={{
              ...actionBtnBase, padding: '10px 16px', background: nothingToApply ? '#CBD5E1' : '#2563EB', color: '#fff',
              cursor: busy || nothingToApply ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Applying…' : `Apply to ${count} slot${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SlotsTable({ slots, loading, error, onChanged }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null })
  const [showPast, setShowPast] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const { showToast, toastElement } = useToast()

  const filteredSlots = useMemo(() => {
    return slots.filter((slot) => {
      if (dateRange.start || dateRange.end) {
        const slotDate = toLocalDateIso(slot.starts_at)
        if (dateRange.start && slotDate < toLocalDateIso(dateRange.start.toISOString())) return false
        if (dateRange.end && slotDate > toLocalDateIso(dateRange.end.toISOString())) return false
      }
      if (!showPast && isPastSlot(slot.ends_at)) return false
      if (statusFilter !== 'all' && slot.status !== statusFilter) return false
      return true
    })
  }, [slots, dateRange, showPast, statusFilter])

  const hiddenCount = slots.length - filteredSlots.length

  // Selection can only ever reference slots that are still on screen — prune
  // anything that fell out of the current filter or was deleted elsewhere.
  useEffect(() => {
    const visibleIds = new Set(filteredSlots.map((s) => s.id))
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filteredSlots])

  const selectedSlots = useMemo(() => filteredSlots.filter((s) => selectedIds.has(s.id)), [filteredSlots, selectedIds])
  const deletableSelected = useMemo(() => selectedSlots.filter((s) => s.booked_count === 0), [selectedSlots])
  const editableSelected = useMemo(() => selectedSlots.filter((s) => !isPastSlot(s.ends_at)), [selectedSlots])

  const allVisibleSelected = filteredSlots.length > 0 && filteredSlots.every((s) => selectedIds.has(s.id))
  const someVisibleSelected = filteredSlots.some((s) => selectedIds.has(s.id))

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) return new Set()
      return new Set(filteredSlots.map((s) => s.id))
    })
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function handleBulkEdit(patch: Partial<Pick<HeadSlot, 'capacity' | 'status' | 'venue'>>) {
    const ids = editableSelected.map((s) => s.id)
    const { error: err } = await bulkUpdateSlots(ids, patch)
    if (err) {
      showToast(err.message, 'error')
      return
    }
    showToast(`Updated ${ids.length} slot${ids.length === 1 ? '' : 's'}.`, 'success')
    setShowBulkEdit(false)
    clearSelection()
    onChanged()
  }

  async function handleBulkDelete() {
    if (deletableSelected.length === 0) return
    const skipped = selectedSlots.length - deletableSelected.length
    const confirmMsg = skipped > 0
      ? `Delete ${deletableSelected.length} slot(s)? ${skipped} selected slot(s) have bookings and will be skipped.`
      : `Delete ${deletableSelected.length} slot(s)? This disappears from the public booking page.`
    if (!window.confirm(confirmMsg)) return

    setBulkDeleting(true)
    const { error: err } = await bulkDeleteSlots(deletableSelected.map((s) => s.id))
    setBulkDeleting(false)
    if (err) {
      showToast(err.message, 'error')
      return
    }
    showToast(`Deleted ${deletableSelected.length} slot${deletableSelected.length === 1 ? '' : 's'}.`, 'success')
    clearSelection()
    onChanged()
  }

  if (loading) return <div style={{ padding: '28px 20px', color: '#64748B', fontSize: '14px' }}>Loading slots…</div>
  if (error) return <div style={{ padding: '28px 20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>

  if (slots.length === 0) {
    return (
      <div style={{ padding: '48px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '30px', marginBottom: '10px' }}>🗓️</div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#0F172A', marginBottom: '4px' }}>No slots yet</div>
        <div style={{ fontSize: '13.5px', color: '#64748B' }}>Use “Add interview slots” above to open your first interview times.</div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', minHeight: '380px' }}>
      <style>{`
        .slots-tbl-mob { display: none !important; }
        .slots-tbl-desk { display: table !important; width: 100%; }
        @media (max-width: 840px) {
          .slots-tbl-desk { display: none !important; }
          .slots-tbl-mob { display: block !important; }
        }
      `}</style>

      {/* Filter bar */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #EAEEF4', display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'flex-end', background: '#FAFBFD' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date range</label>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['all', 'open', 'closed'] as StatusFilter[]).map((value) => {
              const active = statusFilter === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  style={{
                    padding: '8px 14px',
                    height: '38px',
                    borderRadius: '8px',
                    border: `1px solid ${active ? '#2563EB' : '#E2E8F0'}`,
                    background: active ? '#EFF4FF' : '#fff',
                    color: active ? '#2563EB' : '#64748B',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {value}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '38px' }}>
          <input
            type="checkbox"
            id="show-past-toggle"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label htmlFor="show-past-toggle" style={{ fontSize: '13.5px', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
            Show past slots
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '38px' }}>
          <input
            type="checkbox"
            id="select-all-toggle"
            checked={allVisibleSelected}
            ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected }}
            onChange={toggleSelectAll}
            disabled={filteredSlots.length === 0}
            style={{ width: '16px', height: '16px', cursor: filteredSlots.length === 0 ? 'default' : 'pointer' }}
          />
          <label htmlFor="select-all-toggle" style={{ fontSize: '13.5px', fontWeight: 600, color: '#334155', cursor: filteredSlots.length === 0 ? 'default' : 'pointer' }}>
            Select all
          </label>
        </div>

        {hiddenCount > 0 && (
          <span style={{ fontSize: '12.5px', color: '#94A3B8', fontWeight: 600, marginLeft: 'auto', alignSelf: 'center' }}>
            {hiddenCount} hidden by filters
          </span>
        )}
      </div>

      {/* Bulk action toolbar */}
      {selectedSlots.length > 0 && (
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #EAEEF4', background: '#EFF4FF', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#1E3A8A' }}>
            {selectedSlots.length} selected
          </span>
          <button
            type="button"
            onClick={() => setShowBulkEdit(true)}
            disabled={editableSelected.length === 0}
            title={editableSelected.length === 0 ? 'Selected slots are all past and cannot be edited' : undefined}
            style={{ ...actionBtnBase, padding: '7px 14px', background: editableSelected.length === 0 ? '#E2E8F0' : '#2563EB', color: editableSelected.length === 0 ? '#94A3B8' : '#fff', cursor: editableSelected.length === 0 ? 'not-allowed' : 'pointer' }}
          >
            Edit selected{editableSelected.length !== selectedSlots.length ? ` (${editableSelected.length})` : ''}
          </button>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={bulkDeleting || deletableSelected.length === 0}
            title={deletableSelected.length === 0 ? 'Selected slots all have bookings' : undefined}
            style={{ ...deleteBtnStyle, padding: '7px 14px', opacity: deletableSelected.length === 0 ? 0.5 : 1, cursor: bulkDeleting || deletableSelected.length === 0 ? 'not-allowed' : 'pointer' }}
          >
            {bulkDeleting ? 'Deleting…' : `Delete selected${deletableSelected.length !== selectedSlots.length ? ` (${deletableSelected.length})` : ''}`}
          </button>
          <button type="button" onClick={clearSelection} style={{ ...neutralBtnStyle, padding: '7px 14px', marginLeft: 'auto' }}>
            Clear selection
          </button>
        </div>
      )}

      {filteredSlots.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
          No slots match these filters.
        </div>
      ) : (
        <>
          <table className="slots-tbl-desk" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #EAEEF4' }}>
                <th style={{ padding: '14px 12px 14px 20px', width: '32px' }} />
                {['Date & time', 'Venue', 'Seats', 'Booked', 'Status'].map((heading) => (
                  <th key={heading} style={{ padding: '14px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>
                    {heading}
                  </th>
                ))}
                <th style={{ padding: '14px 20px' }} />
              </tr>
            </thead>
            <tbody>
              {filteredSlots.map((slot) => (
                <SlotRowDesktop
                  key={slot.id}
                  slot={slot}
                  onChanged={onChanged}
                  selected={selectedIds.has(slot.id)}
                  onToggleSelect={() => toggleSelectOne(slot.id)}
                />
              ))}
            </tbody>
          </table>

          <div className="slots-tbl-mob">
            {filteredSlots.map((slot) => (
              <SlotRowMobile
                key={slot.id}
                slot={slot}
                onChanged={onChanged}
                selected={selectedIds.has(slot.id)}
                onToggleSelect={() => toggleSelectOne(slot.id)}
              />
            ))}
          </div>
        </>
      )}

      {showBulkEdit && (
        <BulkEditModal
          count={editableSelected.length}
          onClose={() => setShowBulkEdit(false)}
          onApply={handleBulkEdit}
        />
      )}

      {toastElement}
    </div>
  )
}
