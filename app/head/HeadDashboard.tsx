'use client'

import { useCallback, useEffect, useState } from 'react'
import { BulkCreateForm } from '@/app/head/BulkCreateForm'
import { SlotsTable } from '@/app/head/SlotsTable'
import { BookingsTable } from '@/app/head/BookingsTable'
import { getHeadSlots, getHeadBookings, type HeadBooking, type HeadSlot, type Track, type Orientation } from '@/lib/head'
import { isPastSlot } from '@/lib/booking-helpers'

type Props = {
  track: Track
  orientation: Orientation
  orientationYear?: number
  profileId: string
  isAdmin: boolean
}

export function HeadDashboard({ track, orientation, orientationYear = 2026, profileId }: Props) {
  const [slots, setSlots] = useState<HeadSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(true)
  const [slotsError, setSlotsError] = useState<string | null>(null)

  const [bookings, setBookings] = useState<HeadBooking[]>([])
  const [bookingsLoading, setBookingsLoading] = useState(true)
  const [bookingsError, setBookingsError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'slots' | 'bookings'>('slots')

  // Each list reloads when its token bumps. The effects own cancellation so a
  // slow response for one track can't land after the head switched to another.
  const [slotsToken, setSlotsToken] = useState(0)
  const [bookingsToken, setBookingsToken] = useState(0)

  const refreshSlots = useCallback(() => setSlotsToken((n) => n + 1), [])
  const refreshBookings = useCallback(() => setBookingsToken((n) => n + 1), [])

  useEffect(() => {
    let active = true

    async function run() {
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
    let active = true

    async function run() {
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

  const stats: { label: string; value: string; hint?: string }[] = [
    { label: 'Slots', value: String(slots.length), hint: `${upcomingSlots.length} upcoming` },
    { label: 'Seats booked', value: `${bookedSeats} / ${totalSeats}`, hint: `${fillRate}% filled` },
    { label: 'Seats still open', value: String(openSeatsLeft), hint: 'upcoming & open' },
    { label: 'Applicants', value: String(bookings.length), hint: 'active bookings' },
  ]

  return (
    <>
      <div className="stats-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '12px', padding: '12px 18px', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#64748B', marginBottom: '4px' }}>{stat.label}</span>
            <span style={{ fontSize: '22px', fontWeight: 800, color: '#0F172A', lineHeight: 1.15 }}>{stat.value}</span>
            {stat.hint && <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#94A3B8', marginTop: '2px' }}>{stat.hint}</span>}
          </div>
        ))}
      </div>

      <div style={{ marginTop: '24px', marginBottom: '20px' }}>
        <BulkCreateForm track={track} orientation={orientation} orientationYear={orientationYear} profileId={profileId} existingSlots={slots} onCreated={refreshSlots} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', overflow: 'hidden' }}>
        <div className="tab-group" style={{ display: 'flex', borderBottom: '1px solid #EAEEF4', background: '#F8FAFC' }}>
          <button type="button" onClick={() => setActiveTab('slots')} style={{ flex: 1, padding: '16px 20px', border: 'none', background: activeTab === 'slots' ? '#fff' : 'transparent', color: activeTab === 'slots' ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '14.5px', cursor: 'pointer', borderBottom: activeTab === 'slots' ? 'none' : '1px solid #EAEEF4', borderRight: '1px solid #EAEEF4', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'background 0.2s' }}>
            <span>📅</span> Available Slots
            <span style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'slots' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{slots.length}</span>
          </button>
          <button type="button" onClick={() => setActiveTab('bookings')} style={{ flex: 1, padding: '16px 20px', border: 'none', background: activeTab === 'bookings' ? '#fff' : 'transparent', color: activeTab === 'bookings' ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '14.5px', cursor: 'pointer', borderBottom: activeTab === 'bookings' ? 'none' : '1px solid #EAEEF4', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'background 0.2s' }}>
            <span>👤</span> Booked Applicants
            <span style={{ padding: '2px 8px', borderRadius: '99px', background: activeTab === 'bookings' ? '#F1F5F9' : '#E2E8F0', color: '#475569', fontSize: '11.5px', fontWeight: 800 }}>{bookings.length}</span>
          </button>
        </div>

        <div style={{ padding: '0', overflowX: 'auto' }}>
          {activeTab === 'slots' ? (
            <SlotsTable slots={slots} loading={slotsLoading} error={slotsError} onChanged={refreshSlots} />
          ) : (
            <BookingsTable bookings={bookings} loading={bookingsLoading} error={bookingsError} track={track} orientation={orientation} orientationYear={orientationYear} onChanged={refreshBookings} />
          )}
        </div>
      </div>
    </>
  )
}
