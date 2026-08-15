'use client'

import { useMemo, useState } from 'react'
import { formatDateHeading, formatTimeRange, isPastSlot, toLocalDateIso } from '@/lib/booking-helpers'
import { deleteSlot, updateSlot, type HeadSlot } from '@/lib/head'
import { DateRangePicker, type DateRange } from '@/components/DateRangePicker'

type Props = {
  slots: HeadSlot[]
  loading: boolean
  error: string | null
  onChanged: () => void
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

const closeBtnStyle: React.CSSProperties = {
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

function useSlotActions(slot: HeadSlot, onChanged: () => void) {
  const [capacity, setCapacity] = useState(slot.capacity.toString())
  const [busy, setBusy] = useState(false)
  const isPast = isPastSlot(slot.ends_at)

  async function handleSaveCapacity() {
    const newCap = Number(capacity)
    if (isNaN(newCap) || newCap < slot.booked_count) {
      alert(`Capacity can't be below current bookings (${slot.booked_count}).`)
      setCapacity(slot.capacity.toString())
      return
    }
    if (newCap === slot.capacity) return
    setBusy(true)
    const { error: saveError } = await updateSlot(slot.id, { capacity: newCap })
    setBusy(false)
    if (saveError) {
      alert(saveError.message)
      return
    }
    onChanged()
  }

  async function handleClose() {
    setBusy(true)
    const { error: closeError } = await updateSlot(slot.id, { status: 'closed' })
    setBusy(false)
    if (closeError) {
      alert(closeError.message)
      return
    }
    onChanged()
  }

  async function handleDelete() {
    if (slot.booked_count > 0) return
    if (!window.confirm('Delete this slot?')) return
    setBusy(true)
    const { error: deleteError } = await deleteSlot(slot.id)
    setBusy(false)
    if (deleteError) {
      alert(deleteError.message)
      return
    }
    onChanged()
  }

  return { capacity, setCapacity, busy, isPast, handleSaveCapacity, handleClose, handleDelete }
}

function SlotRowDesktop({ slot, onChanged }: { slot: HeadSlot; onChanged: () => void }) {
  const { capacity, setCapacity, busy, isPast, handleSaveCapacity, handleClose, handleDelete } = useSlotActions(slot, onChanged)
  const dateHeading = formatDateHeading(toLocalDateIso(slot.starts_at))
  const timeHeading = formatTimeRange(slot.starts_at, slot.ends_at)

  return (
    <tr style={{ borderBottom: '1px solid #EAEEF4', opacity: isPast ? 0.6 : 1 }}>
      <td style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{dateHeading}</div>
        <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{timeHeading}</div>
      </td>
      <td style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: '14.5px', fontWeight: 600, color: '#475569' }}>{slot.venue || '—'}</div>
      </td>
      <td style={{ padding: '18px 20px' }}>
        <input
          type="number"
          min={1}
          value={capacity}
          onBlur={handleSaveCapacity}
          onChange={(e) => setCapacity(e.target.value)}
          disabled={busy || isPast}
          style={{ width: '50px', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', textAlign: 'center', color: '#0F172A' }}
        />
      </td>
      <td style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: '14.5px', fontWeight: 600, color: '#0F172A' }}>{slot.booked_count}</div>
      </td>
      <td style={{ padding: '18px 20px' }}>
        {slot.status === 'open' ? (
          <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: '#ECFDF3', color: '#15803D', fontSize: '11.5px', fontWeight: 700 }}>Open</span>
        ) : (
          <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: '#F1F5F9', color: '#475569', fontSize: '11.5px', fontWeight: 700 }}>Closed</span>
        )}
      </td>
      <td style={{ padding: '18px 20px', textAlign: 'right' }}>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {slot.status === 'open' && !isPast && (
            <button disabled={busy} onClick={handleClose} type="button" style={closeBtnStyle}>Close</button>
          )}
          <button
            disabled={busy || slot.booked_count > 0}
            onClick={handleDelete}
            type="button"
            style={{ ...deleteBtnStyle, opacity: slot.booked_count > 0 ? 0.5 : 1, cursor: slot.booked_count > 0 ? 'not-allowed' : 'pointer' }}
            title={slot.booked_count > 0 ? 'Cannot delete slot with bookings' : 'Delete slot'}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

function SlotRowMobile({ slot, onChanged }: { slot: HeadSlot; onChanged: () => void }) {
  const { capacity, setCapacity, busy, isPast, handleSaveCapacity, handleClose, handleDelete } = useSlotActions(slot, onChanged)
  const dateHeading = formatDateHeading(toLocalDateIso(slot.starts_at))
  const timeHeading = formatTimeRange(slot.starts_at, slot.ends_at)

  return (
    <div style={{ borderBottom: '1px solid #EAEEF4', padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', opacity: isPast ? 0.6 : 1 }}>
      <div>
        <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{dateHeading}</div>
        <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>{timeHeading}</div>
        <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '6px', fontWeight: 600 }}>
          <span style={{ color: '#64748B', fontWeight: 500 }}>Venue:</span> {slot.venue || '—'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
          <div style={{ fontSize: '12.5px' }}>
            <span style={{ color: '#64748B' }}>Cap:</span>{' '}
            <input
              type="number"
              min={1}
              value={capacity}
              onBlur={handleSaveCapacity}
              onChange={(e) => setCapacity(e.target.value)}
              disabled={busy || isPast}
              style={{ width: '40px', padding: '4px 6px', border: '1px solid #E2E8F0', borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', textAlign: 'center', color: '#0F172A' }}
            />
          </div>
          <div style={{ fontSize: '12.5px' }}>
            <span style={{ color: '#64748B' }}>Booked:</span>{' '}
            <strong style={{ color: '#0F172A' }}>{slot.booked_count}</strong>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
        {slot.status === 'open' ? (
          <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: '#ECFDF3', color: '#15803D', fontSize: '11.5px', fontWeight: 700 }}>Open</span>
        ) : (
          <span style={{ display: 'inline-flex', padding: '3.5px 8px', borderRadius: '6px', background: '#F1F5F9', color: '#475569', fontSize: '11.5px', fontWeight: 700 }}>Closed</span>
        )}
        <div style={{ display: 'flex', gap: '6px' }}>
          {slot.status === 'open' && !isPast && (
            <button disabled={busy} onClick={handleClose} type="button" style={closeBtnStyle}>Close</button>
          )}
          <button
            disabled={busy || slot.booked_count > 0}
            onClick={handleDelete}
            type="button"
            style={{ ...deleteBtnStyle, opacity: slot.booked_count > 0 ? 0.5 : 1, cursor: slot.booked_count > 0 ? 'not-allowed' : 'pointer' }}
            title={slot.booked_count > 0 ? 'Cannot delete slot with bookings' : 'Delete slot'}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export function SlotsTable({ slots, loading, error, onChanged }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>({ start: null, end: null })
  const [showPast, setShowPast] = useState<boolean>(true)

  const filteredSlots = useMemo(() => {
    return slots.filter((slot) => {
      if (dateRange.start || dateRange.end) {
        const slotDateStr = toLocalDateIso(slot.starts_at)
        if (dateRange.start) {
          const startStr = toLocalDateIso(dateRange.start.toISOString())
          if (slotDateStr < startStr) return false
        }
        if (dateRange.end) {
          const endStr = toLocalDateIso(dateRange.end.toISOString())
          if (slotDateStr > endStr) return false
        }
      }
      const isPast = isPastSlot(slot.ends_at)
      if (!showPast && isPast) {
        return false
      }
      return true
    })
  }, [slots, dateRange, showPast])

  return (
    <>
      {loading && <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>}
      {error && <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>}

      {!loading && !error && slots.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>No slots yet.</div>
      )}

      {!loading && !error && slots.length > 0 && (
        <div style={{ width: '100%', minHeight: '380px' }}>
          <style>{`
            .tbl-mob { display: none !important; }
            .tbl-desk { display: table !important; width: 100%; }
            @media (max-width: 840px) {
              .tbl-desk { display: none !important; }
              .tbl-mob { display: grid !important; }
            }
          `}</style>

          {/* Filter Bar */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #EAEEF4', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end', background: '#FAFBFD' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter by Date Range</label>
              <DateRangePicker value={dateRange} onChange={setDateRange} />
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '36px' }}>
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
          </div>

          {/* Desktop Table */}
          <table className="tbl-desk" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #EAEEF4' }}>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Date & Time</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Venue</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Total Cap.</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Booked</th>
                <th style={{ padding: '16px 20px', fontSize: '12.5px', fontWeight: 600, color: '#64748B', letterSpacing: '.02em' }}>Status</th>
                <th style={{ padding: '16px 20px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredSlots.map((slot) => (
                <SlotRowDesktop key={slot.id} slot={slot} onChanged={onChanged} />
              ))}
            </tbody>
          </table>

          {/* Mobile Cards */}
          <div className="tbl-mob">
            {filteredSlots.map((slot) => (
              <SlotRowMobile key={slot.id} slot={slot} onChanged={onChanged} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
