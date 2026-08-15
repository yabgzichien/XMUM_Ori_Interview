'use client'

import { useState, useMemo } from 'react'
import { generateSlotTimes } from '@/lib/slot-generation'
import { createSlots, type Track, type Orientation } from '@/lib/head'

type Props = {
  track: Track
  orientation: Orientation
  orientationYear?: number
  profileId: string
  onCreated: () => void
}

export function BulkCreateForm({ track, orientation, orientationYear = 2026, profileId, onCreated }: Props) {
  const [dates, setDates] = useState<string[]>([])
  const [dateInput, setDateInput] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [intervalMinutes, setIntervalMinutes] = useState(15)
  const [capacity, setCapacity] = useState(1)
  const [venue, setVenue] = useState('')
  
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdCount, setCreatedCount] = useState<number | null>(null)
  
  const [showConfirm, setShowConfirm] = useState(false)

  const handleAddDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val && !dates.includes(val)) {
      setDates(prev => [...prev, val].sort())
    }
    setDateInput('') // Reset the input to allow selecting the same date again if removed
  }

  const handleRemoveDate = (dateToRemove: string) => {
    setDates(prev => prev.filter(d => d !== dateToRemove))
  }

  // Live preview calculations
  const previewSlots = useMemo(() => {
    if (dates.length === 0 || !startTime || !endTime || intervalMinutes <= 0) return []
    
    let allTimes: ReturnType<typeof generateSlotTimes> = []
    
    try {
      for (const d of dates) {
        const times = generateSlotTimes({ date: d, startTime, endTime, intervalMinutes })
        allTimes = [...allTimes, ...times]
      }
    } catch (err) {
      // Ignore errors for preview (e.g., end before start)
      return []
    }
    
    return allTimes.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  }, [dates, startTime, endTime, intervalMinutes])

  const slotsPerDay = dates.length > 0 && previewSlots.length > 0 ? previewSlots.length / dates.length : 0
  const totalSlots = previewSlots.length

  async function handleInitialSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCreatedCount(null)
    
    if (dates.length === 0) {
      setError('Please select at least one date.')
      return
    }
    if (previewSlots.length === 0) {
      setError('No slots fit in that time range or invalid inputs.')
      return
    }
    
    // Check for past dates
    const hasPastSlots = previewSlots.some(t => new Date(t.starts_at).getTime() <= Date.now())
    if (hasPastSlots) {
      setError('Some slots are in the past. Pick future times.')
      return
    }

    setShowConfirm(true)
  }

  async function handleConfirmCreate() {
    setError(null)
    setSubmitting(true)
    
    const rows = previewSlots.map((t) => ({
      track,
      orientation,
      orientation_year: orientationYear,
      starts_at: t.starts_at,
      ends_at: t.ends_at,
      capacity,
      status: 'open' as const,
      created_by: profileId,
      venue: venue.trim() || '',
    }))
    
    const { error: createError } = await createSlots(rows)
    setSubmitting(false)
    
    if (createError) {
      setError(createError.message)
      return
    }
    
    setCreatedCount(totalSlots)
    setShowConfirm(false)
    setDates([])
    setStartTime('')
    setEndTime('')
    setVenue('')
    
    onCreated()
    setTimeout(() => setCreatedCount(null), 3000)
  }

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="form-card" style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '26px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', transition: 'all 0.2s ease-in-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>➕</div>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 2px', color: '#0F172A' }}>Add slots</h2>
          <p style={{ fontSize: '12.5px', color: '#64748B', margin: 0 }}>Create back-to-back interview slots.</p>
        </div>
      </div>
      
      {!showConfirm ? (
        <form onSubmit={handleInitialSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '8px', display: 'block' }}>Dates</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: dates.length > 0 ? '8px' : '0' }}>
              {dates.map(d => (
                <div key={d} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#E0E7FF', color: '#2563EB', padding: '4px 10px', borderRadius: '14px', fontSize: '13px', fontWeight: 600 }}>
                  <span>{d}</span>
                  <button type="button" onClick={() => handleRemoveDate(d)} style={{ background: 'none', border: 'none', color: '#2563EB', cursor: 'pointer', padding: 0, fontSize: '16px', lineHeight: 1, marginTop: '-2px' }}>&times;</button>
                </div>
              ))}
            </div>
            <input
              type="date"
              value={dateInput}
              onChange={handleAddDate}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569', transition: 'border-color 0.15s' }}
            />
          </div>

          <div className="bulk-form-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569', transition: 'border-color 0.15s' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569', transition: 'border-color 0.15s' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Interval (min)</label>
              <input
                type="number"
                min={1}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                required
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569', transition: 'border-color 0.15s' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Capacity / Slot</label>
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                required
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569', transition: 'border-color 0.15s' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Venue / Location <span style={{ color: '#94A3B8', fontWeight: 400 }}>(Optional)</span></label>
            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. A1 #123"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569', transition: 'border-color 0.15s' }}
            />
          </div>

          {totalSlots > 0 && (
            <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '16px', border: '1px solid #E2E8F0', marginTop: '4px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px', color: '#0F172A' }}>Preview: {totalSlots} Total Slots</h3>
              <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 12px' }}>{slotsPerDay} slots per day &times; {dates.length} days</p>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {previewSlots.slice(0, 6).map((slot, idx) => (
                  <div key={idx} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px', fontSize: '11.5px', color: '#475569', fontWeight: 500 }}>
                    {formatTime(slot.starts_at)} – {formatTime(slot.ends_at)}
                  </div>
                ))}
                {totalSlots > 6 && (
                  <div style={{ background: 'transparent', padding: '4px 8px', fontSize: '11.5px', color: '#64748B', fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>
                    ... and {totalSlots - 6} more
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
            <button type="submit" style={{ padding: '10.5px 24px', borderRadius: '9px', background: '#2563EB', border: 'none', color: '#fff', fontWeight: 600, fontSize: '14px', cursor: 'pointer', transition: 'background 0.15s' }}>
              Review & Create
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '20px', border: '1px solid #E2E8F0' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 16px', color: '#0F172A' }}>Confirm Creation</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', color: '#475569' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr' }}>
                <span style={{ fontWeight: 600, color: '#334155' }}>Dates:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {dates.map(d => <span key={d} style={{ background: '#E2E8F0', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', color: '#334155', fontWeight: 500 }}>{d}</span>)}
                </div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr' }}>
                <span style={{ fontWeight: 600, color: '#334155' }}>Time:</span>
                <span>{startTime} to {endTime}</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr' }}>
                <span style={{ fontWeight: 600, color: '#334155' }}>Format:</span>
                <span>{intervalMinutes} min interval, {capacity} capacity</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr' }}>
                <span style={{ fontWeight: 600, color: '#334155' }}>Venue:</span>
                <span>{venue || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>None provided</span>}</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', marginTop: '8px', paddingTop: '12px', borderTop: '1px dashed #CBD5E1' }}>
                <span style={{ fontWeight: 700, color: '#0F172A' }}>Total Slots:</span>
                <span style={{ fontWeight: 700, color: '#2563EB' }}>{totalSlots}</span>
              </div>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button 
              type="button" 
              onClick={() => setShowConfirm(false)}
              disabled={submitting}
              style={{ padding: '10.5px 20px', borderRadius: '9px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: '14px', cursor: 'pointer', transition: 'all 0.15s' }}
            >
              Go Back
            </button>
            <button 
              type="button"
              onClick={handleConfirmCreate}
              disabled={submitting} 
              style={{ padding: '10.5px 24px', borderRadius: '9px', background: '#2563EB', border: 'none', color: '#fff', fontWeight: 600, fontSize: '14px', cursor: 'pointer', transition: 'all 0.15s', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? 'Creating...' : 'Confirm & Create'}
            </button>
          </div>
        </div>
      )}
      
      {createdCount !== null && (
        <p style={{ marginTop: '16px', fontSize: '13px', color: '#16A34A', fontWeight: 600, padding: '12px', background: '#DCFCE7', borderRadius: '8px', border: '1px solid #BBF7D0' }}>
          ✓ Successfully created {createdCount} slot(s).
        </p>
      )}
      {error && (
        <p style={{ marginTop: '16px', fontSize: '13px', color: '#B91C1C', padding: '12px', background: '#FEE2E2', borderRadius: '8px', border: '1px solid #FECACA' }}>
          ⚠ {error}
        </p>
      )}
    </div>
  )
}
