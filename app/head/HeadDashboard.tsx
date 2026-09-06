'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BulkCreateForm } from '@/app/head/BulkCreateForm'
import { SlotsTable } from '@/app/head/SlotsTable'
import { BookingsTable } from '@/app/head/BookingsTable'
import { InvitesTable } from '@/app/head/InvitesTable'
import { getHeadSlots, getHeadBookings, type HeadBooking, type HeadSlot, type Track, type Orientation } from '@/lib/head'
import { isPastSlot } from '@/lib/booking-helpers'

type Props = {
  track: Track
  orientation: Orientation
  orientationYear?: number
  profileId: string
  isAdmin: boolean
  initialSlots?: HeadSlot[]
  initialBookings?: HeadBooking[]
}

export function HeadDashboard({
  track,
  orientation,
  orientationYear = 2026,
  profileId,
  initialSlots = [],
  initialBookings = [],
}: Props) {
  const [slots, setSlots] = useState<HeadSlot[]>(initialSlots)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)

  const [bookings, setBookings] = useState<HeadBooking[]>(initialBookings)
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [bookingsError, setBookingsError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'slots' | 'bookings' | 'invites'>('slots')

  // Each list reloads when its token bumps. The effects own cancellation so a
  // slow response for one track can't land after the head switched to another.
  const [slotsToken, setSlotsToken] = useState(0)
  const [bookingsToken, setBookingsToken] = useState(0)

  const refreshSlots = useCallback(() => setSlotsToken((n) => n + 1), [])
  const refreshBookings = useCallback(() => setBookingsToken((n) => n + 1), [])

  // Track whether this is the initial render to avoid redundant fetch
  const isInitialSlotsMount = useRef(true)
  const isInitialBookingsMount = useRef(true)

  useEffect(() => {
    if (isInitialSlotsMount.current) {
      isInitialSlotsMount.current = false
      if (initialSlots.length > 0) return
    }

    let active = true

    async function run() {
      setSlotsLoading(true)
      const { data, error } = await getHeadSlots(track, orientation, orientationYear)
      if (!active) return
      setSlotsLoading(false)
      if (error) {
        setSlotsError(error.message)
        setSlots([])
        return
      }
      setSlotsError(null)
      setSlots(data ?? [])
    }

    run()
    return () => {
      active = false
    }
  }, [track, orientation, orientationYear, slotsToken])

  useEffect(() => {
    if (isInitialBookingsMount.current) {
      isInitialBookingsMount.current = false
      if (initialBookings.length > 0) return
    }

    let active = true

    async function run() {
      setBookingsLoading(true)
      const { data, error } = await getHeadBookings(track, orientation, orientationYear)
      if (!active) return
      setBookingsLoading(false)
      if (error) {
        setBookingsError(error.message)
        setBookings([])
        return
      }
      setBookingsError(null)
      setBookings(data ?? [])
    }

    run()
    return () => {
      active = false
    }
  }, [track, orientation, orientationYear, bookingsToken])

  // "Slots" counts slot rows; "seats" counts capacity across them. Keeping the
  // two apart matters once a slot can seat more than one applicant.
  const totalSeats = slots.reduce((acc, slot) => acc + slot.capacity, 0)
  const bookedSeats = slots.reduce((acc, slot) => acc + slot.booked_count, 0)
  const upcomingSlots = slots.filter((slot) => !isPastSlot(slot.ends_at))
  const openSeatsLeft = upcomingSlots
    .filter((slot) => slot.status === 'open')
    .reduce((acc, slot) => acc + Math.max(0, slot.capacity - slot.booked_count), 0)
  const fillRate = totalSeats > 0 ? Math.round((bookedSeats / totalSeats) * 100) : 0

  const stats: { label: string; shortLabel: string; value: string; hint?: string }[] = [
    { label: 'Slots', shortLabel: 'Slots', value: String(slots.length), hint: `${upcomingSlots.length} upcoming` },
    { label: 'Seats booked', shortLabel: 'Booked', value: `${bookedSeats} / ${totalSeats}`, hint: `${fillRate}% filled` },
    { label: 'Seats still open', shortLabel: 'Open', value: String(openSeatsLeft), hint: 'upcoming & open' },
    { label: 'Applicants', shortLabel: 'Applicants', value: String(bookings.length), hint: 'active bookings' },
  ]

  const invitedBookings = bookings.filter((b) => b.invited_at)
  const registeredCount = invitedBookings.filter((b) => b.invite_claimed_at).length

  return (
    <>
      <div className="stats-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <span className="stat-card-label">
              <span className="stat-label-full">{stat.label}</span>
              <span className="stat-label-short">{stat.shortLabel}</span>
            </span>
            <span className="stat-card-value">{stat.value}</span>
            {stat.hint && <span className="stat-card-hint">{stat.hint}</span>}
          </div>
        ))}
      </div>

      <div style={{ marginTop: '24px', marginBottom: '20px' }}>
        <BulkCreateForm track={track} orientation={orientation} orientationYear={orientationYear} profileId={profileId} existingSlots={slots} onCreated={refreshSlots} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
        <div className="tab-group">
          <button
            type="button"
            onClick={() => setActiveTab('slots')}
            style={{
              flex: '1 0 auto',
              padding: '16px 20px',
              border: 'none',
              background: activeTab === 'slots' ? '#fff' : 'transparent',
              color: activeTab === 'slots' ? '#0F172A' : '#64748B',
              fontWeight: 700,
              fontSize: '14.5px',
              cursor: 'pointer',
              borderBottom: activeTab === 'slots' ? 'none' : '1px solid #EAEEF4',
              borderRight: '1px solid #EAEEF4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            <span>📅</span>
            <span><span className="tab-label-full">Available </span>Slots</span>
            <span className="tab-badge" style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'slots' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{slots.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bookings')}
            style={{
              flex: '1 0 auto',
              padding: '16px 20px',
              border: 'none',
              background: activeTab === 'bookings' ? '#fff' : 'transparent',
              color: activeTab === 'bookings' ? '#0F172A' : '#64748B',
              fontWeight: 700,
              fontSize: '14.5px',
              cursor: 'pointer',
              borderBottom: activeTab === 'bookings' ? 'none' : '1px solid #EAEEF4',
              borderRight: '1px solid #EAEEF4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            <span>👤</span>
            <span><span className="tab-label-full">Booked </span>Applicants</span>
            <span className="tab-badge" style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'bookings' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{bookings.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('invites')}
            style={{
              flex: '1 0 auto',
              padding: '16px 20px',
              border: 'none',
              background: activeTab === 'invites' ? '#fff' : 'transparent',
              color: activeTab === 'invites' ? '#0F172A' : '#64748B',
              fontWeight: 700,
              fontSize: '14.5px',
              cursor: 'pointer',
              borderBottom: activeTab === 'invites' ? 'none' : '1px solid #EAEEF4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            <span>📋</span>
            <span>Registration</span>
            <span className="tab-badge" style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'invites' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{registeredCount}/{invitedBookings.length}</span>
          </button>
        </div>

        <div style={{ padding: '0', overflowX: 'auto' }}>
          {activeTab === 'slots' && (
            <SlotsTable slots={slots} loading={slotsLoading} error={slotsError} onChanged={refreshSlots} />
          )}
          {activeTab === 'bookings' && (
            <BookingsTable bookings={bookings} loading={bookingsLoading} error={bookingsError} track={track} orientation={orientation} orientationYear={orientationYear} onChanged={refreshBookings} />
          )}
          {activeTab === 'invites' && (
            <InvitesTable bookings={bookings} loading={bookingsLoading} error={bookingsError} track={track} orientation={orientation} orientationYear={orientationYear} onChanged={refreshBookings} />
          )}
        </div>
      </div>
    </>
  )
}
