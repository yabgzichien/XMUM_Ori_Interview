'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type BookingInfo = {
  booking_id: string
  track: string
  starts_at: string
  ends_at: string
  applicant_name: string
  applicant_email: string
  student_id: string | null
  interview_status: string
  status: string
  created_at: string
  venue?: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kuala_Lumpur',
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kuala_Lumpur',
  })
}

function formatTrack(t: string) {
  if (t === 'facilitator') return 'Facilitator'
  if (t === 'game_master') return 'Game Master'
  return t
}

function BookingCard({
  b,
  studentId,
  onCancelled,
}: {
  b: BookingInfo
  studentId: string
  onCancelled: (id: string) => void
}) {
  const [cancelling, setCancelling] = useState(false)
  const [localStatus, setLocalStatus] = useState(b.status)
  const isPast = new Date(b.ends_at) < new Date()
  const isActive = localStatus === 'booked'

  async function handleCancel() {
    const confirmed = window.confirm(
      'Are you sure you want to cancel this interview booking? This action cannot be undone.'
    )
    if (!confirmed) return
    setCancelling(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('cancel_booking_public', {
        p_student_id: studentId,
        p_booking_id: b.booking_id,
      })
      if (error) throw new Error(error.message)
      setLocalStatus('cancelled')
      onCancelled(b.booking_id)
    } catch (err: any) {
      alert(`Failed to cancel: ${err.message || String(err)}`)
    } finally {
      setCancelling(false)
    }
  }

  const trackColor = b.track === 'facilitator'
    ? { grad: 'linear-gradient(135deg, #3B82F6, #2563EB)', light: '#EFF4FF', text: '#2563EB' }
    : { grad: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', light: '#F3F0FF', text: '#7C3AED' }

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #EAEEF4',
      borderRadius: '20px',
      overflow: 'hidden',
      boxShadow: '0 4px 16px -6px rgba(0,0,0,0.08)',
    }}>
      {/* Track stripe header */}
      <div style={{ background: trackColor.grad, padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: '99px',
            background: 'rgba(255,255,255,0.2)',
            border: '1px solid rgba(255,255,255,0.15)',
            fontSize: '10.5px',
            fontWeight: 700,
            color: '#fff',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '6px',
          }}>
            {formatTrack(b.track)}
          </span>
          <div style={{ fontSize: '17px', fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>{b.applicant_name}</div>
        </div>
        <div style={{
          padding: '5px 13px',
          borderRadius: '99px',
          fontWeight: 700,
          fontSize: '12.5px',
          background: isActive ? '#ECFDF3' : '#FEF2F2',
          color: isActive ? '#15803D' : '#B91C1C',
          border: isActive ? '1px solid #BBF7D0' : '1px solid #FECACA',
          whiteSpace: 'nowrap',
        }}>
          {isActive ? '✓ Active' : '✗ Cancelled'}
        </div>
      </div>

      {/* Details */}
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Date</div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A', lineHeight: 1.3 }}>{formatDate(b.starts_at)}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Time</div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>{formatTime(b.starts_at)} – {formatTime(b.ends_at)}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Venue</div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>{b.venue || 'TBA'}</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Student ID</div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A', fontFamily: '"JetBrains Mono", monospace', textTransform: 'uppercase' }}>{b.student_id || '—'}</div>
          </div>
        </div>

        {/* Cancel button */}
        {isActive && !isPast && (
          <button
            id={`cancel-booking-${b.booking_id}`}
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '12px',
              border: 'none',
              background: cancelling ? '#FCA5A5' : '#FEE2E2',
              color: '#B91C1C',
              fontSize: '14px',
              fontWeight: 800,
              cursor: cancelling ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {cancelling ? 'Cancelling...' : 'Cancel This Booking'}
          </button>
        )}

        {isActive && isPast && (
          <p style={{ textAlign: 'center', fontSize: '13px', color: '#94A3B8', fontStyle: 'italic', margin: 0 }}>
            This slot has already passed.
          </p>
        )}
      </div>
    </div>
  )
}

export function MyBookingClient() {
  const [studentId, setStudentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [bookings, setBookings] = useState<BookingInfo[]>([])
  const [searched, setSearched] = useState(false)
  const [lookupError, setLookupError] = useState('')

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    setLookupError('')
    setBookings([])
    setSearched(false)

    const trimmed = studentId.trim()
    if (!trimmed) {
      setLookupError('Please enter your Student ID.')
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('lookup_booking_public', {
        p_student_id: trimmed,
      })

      if (error) {
        setLookupError('Something went wrong. Please try again.')
        return
      }

      const rows = Array.isArray(data) ? data : (data ? [data] : [])
      setBookings(rows as BookingInfo[])
      setSearched(true)
    } catch (err: any) {
      setLookupError(err.message || 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  function handleCancelled(id: string) {
    setBookings(prev => prev.map(b => b.booking_id === id ? { ...b, status: 'cancelled' } : b))
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #F0FDF4 0%, #EFF6FF 50%, #F8FAFC 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      padding: '48px 16px 80px',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '32px', maxWidth: '440px' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '60px',
          height: '60px',
          background: 'linear-gradient(135deg, #10B981, #059669)',
          borderRadius: '18px',
          marginBottom: '14px',
          boxShadow: '0 8px 24px -6px rgba(16,185,129,.4)',
        }}>
          <span style={{ fontSize: '26px' }}>🎫</span>
        </div>
        <h1 style={{ fontSize: '26px', fontWeight: 900, color: '#0F172A', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
          Check My Booking
        </h1>
        <p style={{ fontSize: '14.5px', color: '#64748B', margin: 0, fontWeight: 500, lineHeight: 1.5 }}>
          Enter your Student ID to view or manage your interview booking.
        </p>
      </div>

      {/* Lookup Card */}
      <div className="my-booking-card" style={{
        width: '100%',
        maxWidth: '480px',
        background: '#fff',
        border: '1px solid #EAEEF4',
        borderRadius: '24px',
        boxShadow: '0 20px 40px -12px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        marginBottom: '24px',
      }}>
        <form onSubmit={handleLookup} style={{ padding: '28px 28px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label htmlFor="student-id-input" style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                Student ID
              </label>
              <input
                id="student-id-input"
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="e.g. DSC2404111"
                required
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1.5px solid #E2E8F0',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontFamily: '"JetBrains Mono", "Courier New", monospace',
                  color: '#0F172A',
                  outline: 'none',
                  boxSizing: 'border-box',
                  background: '#FAFBFD',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}
              />

            </div>

            {lookupError && (
              <div style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '10px',
                padding: '11px 14px',
                fontSize: '13.5px',
                color: '#B91C1C',
                fontWeight: 500,
              }}>
                {lookupError}
              </div>
            )}

            <button
              id="check-booking-btn"
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                border: 'none',
                background: loading ? '#94A3B8' : 'linear-gradient(135deg, #10B981, #059669)',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 8px 20px -6px rgba(16,185,129,.5)',
                transition: 'all 0.2s',
                letterSpacing: '-0.01em',
              }}
            >
              {loading ? 'Searching...' : 'Find My Booking'}
            </button>
          </div>
        </form>
      </div>

      {/* Results */}
      {searched && bookings.length === 0 && (
        <div style={{
          width: '100%',
          maxWidth: '480px',
          background: '#fff',
          border: '1px solid #EAEEF4',
          borderRadius: '20px',
          padding: '32px 24px',
          textAlign: 'center',
          boxShadow: '0 4px 16px -6px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔍</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#0F172A', marginBottom: '6px' }}>No bookings found</div>
          <div style={{ fontSize: '13.5px', color: '#64748B', lineHeight: 1.5 }}>
            No interview booking was found for <strong style={{ fontFamily: 'monospace', textTransform: 'uppercase' }}>{studentId.trim()}</strong>.<br />
            Double-check your Student ID and try again.
          </div>
        </div>
      )}

      {bookings.length > 0 && (
        <div style={{ width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#64748B', textAlign: 'center', marginBottom: '4px' }}>
            {bookings.length === 1 ? '1 booking found' : `${bookings.length} bookings found`}
          </div>
          {bookings.map(b => (
            <BookingCard key={b.booking_id} b={b} studentId={studentId.trim()} onCancelled={handleCancelled} />
          ))}
          <p style={{ textAlign: 'center', fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>
            Need help? Contact the XMUM Orientation Committee.
          </p>
        </div>
      )}
    </div>
  )
}
