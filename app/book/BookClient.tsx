'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getAvailableSlots, type Track, type Orientation } from '@/lib/bookings'
import { bookSlotAction } from '@/app/actions/bookingAction'
import { formatDateHeading, formatTimeRange, toLocalDateIso, type AvailableSlot } from '@/lib/booking-helpers'

function isTrack(value: string | null): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

function isOrientation(value: string | null): value is Orientation {
  return value === 'february' || value === 'april' || value === 'december'
}

const ORIENTATIONS: { key: Orientation; label: string; icon: string }[] = [
  { key: 'february', label: 'February', icon: '🌸' },
  { key: 'april', label: 'April', icon: '🌿' },
  { key: 'december', label: 'December', icon: '❄️' },
]

type Confirmation = {
  reference: string
  name: string
  track: Track
  slot: AvailableSlot
}

function getDayOfWeek(dateStr: string): string {
  if (!dateStr) return ''
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', { weekday: 'long' })
}

export function BookClient() {
  const searchParams = useSearchParams()
  const initTrack: Track = isTrack(searchParams.get('track'))
    ? (searchParams.get('track') as Track)
    : 'facilitator'
  const initOrientation: Orientation = isOrientation(searchParams.get('orientation'))
    ? (searchParams.get('orientation') as Orientation)
    : 'december'

  const [orientation, setOrientation] = useState<Orientation>(initOrientation)
  const [track, setTrack] = useState<Track>(initTrack)
  const [step, setStep] = useState(1)

  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [experiences, setExperiences] = useState('')
  const [links, setLinks] = useState('')
  const [filterDate, setFilterDate] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const filteredSlots = useMemo(() => {
    if (!filterDate) return slots
    return slots.filter(sl => toLocalDateIso(sl.starts_at) === filterDate)
  }, [slots, filterDate])

  const availableDates = useMemo(() => {
    const dates = slots.map(sl => toLocalDateIso(sl.starts_at))
    return Array.from(new Set(dates)).sort()
  }, [slots])

  const loadSlots = useCallback(async () => {
    setLoading(true)
    const { data } = await getAvailableSlots(track, orientation)
    setLoading(false)
    setSelectedId(null)
    setSlots(data ?? [])
  }, [track, orientation])

  useEffect(() => {
    loadSlots()
  }, [loadSlots])

  const selectedSlot = slots.find(s => s.id === selectedId) || null
  const noSlot = !selectedSlot
  const cantConfirm = !name || !studentId || !email || !experiences.trim() || submitting

  async function confirmBooking() {
    if (!selectedSlot) return
    setSubmitting(true)
    const { data, error } = await bookSlotAction(selectedSlot.id, { name, studentId, email, experiences, links })
    setSubmitting(false)
    if (data) {
      setConfirmation({
        reference: data.id.slice(0, 8).toUpperCase(),
        name: data.applicant_name,
        track,
        slot: selectedSlot,
      })
      setStep(3)
    } else if (error) {
      alert(error)
    }
  }

  function bookAnother() {
    setConfirmation(null)
    setName('')
    setStudentId('')
    setEmail('')
    setExperiences('')
    setStep(1)
    loadSlots()
  }

  // Derived styling helpers
  const facilitatorOpenCount = track === 'facilitator' ? slots.filter(s => s.capacity > s.booked_count).length : ''
  const gameMasterOpenCount = track === 'game_master' ? slots.filter(s => s.capacity > s.booked_count).length : ''

  const trackTabs = [
    { key: "facilitator", title: "Facilitator", icon: "🎯", count: typeof facilitatorOpenCount === 'number' ? facilitatorOpenCount : '' },
    { key: "game_master", title: "Game Master", icon: "🎮", count: typeof gameMasterOpenCount === 'number' ? gameMasterOpenCount : '' },
  ]

  const trackTabStyle = (active: boolean) => (
    `flex:1;display:flex;align-items:center;gap:12px;padding:15px 18px;border-radius:14px;cursor:pointer;text-align:left;transition:all .15s;border:1.5px solid ${active ? '#2563EB' : '#EAEEF4'};background:${active ? '#EFF4FF' : '#fff'}`
  )

  const slotStyle = (selected: boolean, full: boolean) => {
    if (full) return "text-align:left;cursor:not-allowed;opacity:.55;background:#fff;border:1.5px solid #EAEEF4;border-radius:14px;padding:16px;width:100%"
    return `text-align:left;cursor:pointer;border-radius:14px;padding:16px;width:100%;transition:transform .12s,border-color .12s,box-shadow .12s;${
      selected
        ? "background:#EFF4FF;border:1.5px solid #2563EB;box-shadow:0 8px 22px -12px rgba(37,99,235,.5)"
        : "background:#fff;border:1.5px solid #EAEEF4"
    }`
  }

  return (
    <main className="scr" style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 16px 48px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-.025em', margin: '0 0 4px' }}>Book an interview</h1>
        <p style={{ color: '#64748B', fontSize: '14px', margin: 0 }}>Choose your track, pick a time that works, and tell us a little about you.</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
        {[1, 2, 3].map(n => {
          const labels: Record<number, string> = { 1: "Choose slot", 2: "Your details", 3: "Confirmed" }
          const done = step > n, active = step === n
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '26px', height: '26px', borderRadius: '99px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', fontWeight: 700, background: done ? '#16A34A' : active ? '#2563EB' : '#EEF2F7', color: (done || active) ? '#fff' : '#94A3B8' }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: (active || done) ? '#0F172A' : '#94A3B8' }}>{labels[n]}</span>
              {n < 3 && <span style={{ width: '26px', height: '2px', background: '#E2E8F0', borderRadius: '2px' }}></span>}
            </div>
          )
        })}
      </div>

      {step === 1 && (
        <div className="scr">
          {/* Orientation Selection */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>Select Orientation</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              {ORIENTATIONS.map(o => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setOrientation(o.key)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '15px 18px',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all .15s',
                    border: `1.5px solid ${orientation === o.key ? '#2563EB' : '#EAEEF4'}`,
                    background: orientation === o.key ? '#EFF4FF' : '#fff',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>{o.icon}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>{o.label}</span>
                    <span style={{ fontSize: '12.5px', color: '#64748B', fontWeight: 500 }}>Orientation</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Track Selection */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
            {trackTabs.map(t => (
              <button key={t.key} type="button" onClick={() => { setTrack(t.key as Track); setSelectedId(null) }} style={Object.fromEntries(trackTabStyle(track === t.key).split(';').map(x=>x.split(':')).filter(x=>x.length===2).map(x=>[x[0].replace(/-([a-z])/g, g=>g[1].toUpperCase()), x[1]])) as React.CSSProperties}>
                <span style={{ fontSize: '20px' }}>{t.icon}</span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                  <span style={{ fontWeight: 700, fontSize: '15px' }}>{t.title}</span>
                  <span style={{ fontSize: '12.5px', color: '#64748B', fontWeight: 500 }}>{t.count !== '' ? `${t.count} slots open` : 'Loading...'}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Date Filter Buttons */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>Filter by Date</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => { setFilterDate(''); setSelectedId(null) }}
                style={{
                  padding: '8px 16px',
                  borderRadius: '99px',
                  border: '1.5px solid',
                  borderColor: filterDate === '' ? '#2563EB' : '#EAEEF4',
                  background: filterDate === '' ? '#EFF4FF' : '#fff',
                  color: filterDate === '' ? '#2563EB' : '#475569',
                  fontSize: '13.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                All dates
              </button>
              {availableDates.map(d => {
                const label = formatDateHeading(d).replace(/, \d{4}$/, '') // Mon, 15 Jun
                const slotsForDate = slots.filter(sl => toLocalDateIso(sl.starts_at) === d)
                const hasOpen = slotsForDate.some(sl => sl.capacity - sl.booked_count > 0)
                const isActive = filterDate === d
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setFilterDate(d); setSelectedId(null) }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '99px',
                      border: '1.5px solid',
                      borderColor: isActive ? '#2563EB' : '#EAEEF4',
                      background: isActive ? '#EFF4FF' : '#fff',
                      color: isActive ? '#2563EB' : '#475569',
                      fontSize: '13.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      opacity: hasOpen ? 1 : 0.65,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    {label}
                    {!hasOpen && <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8' }}>(Full)</span>}
                  </button>
                )
              })}
            </div>
            
            {filterDate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px', background: '#F8FAFC', border: '1px solid #EAEEF4', borderRadius: '10px', padding: '6px 12px', width: 'fit-content' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>
                  {getDayOfWeek(filterDate)}
                </span>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#94A3B8' }}></span>
                {(() => {
                  const slotsForDate = slots.filter(sl => toLocalDateIso(sl.starts_at) === filterDate)
                  const hasOpen = slotsForDate.some(sl => sl.capacity - sl.booked_count > 0)
                  if (hasOpen) {
                    return <span style={{ fontSize: '13px', color: '#10B981', fontWeight: 600 }}>Open interviews available</span>
                  } else {
                    return <span style={{ fontSize: '13px', color: '#F97316', fontWeight: 600 }}>All interviews fully booked</span>
                  }
                })()}
              </div>
            )}
          </div>

          <div className="slots-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {loading ? (
              <div style={{ fontSize: '14px', color: '#64748B', padding: '20px' }}>Loading slots...</div>
            ) : filteredSlots.length === 0 ? (
              <div style={{ gridColumn: 'span 2', padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px', background: '#F8FAFC', borderRadius: '14px', border: '1px dashed #E2E8F0' }}>
                No slots found for this date. Try another date or clear the filter.
              </div>
            ) : filteredSlots.map(sl => {
              const seatsLeft = sl.capacity - sl.booked_count
              const status = seatsLeft <= 0 ? 'full' : (seatsLeft <= 2 ? 'few' : 'open')
              const selected = sl.id === selectedId
              return (
                <button key={sl.id} type="button" onClick={() => status !== 'full' && setSelectedId(sl.id)} style={Object.fromEntries(slotStyle(selected, status==='full').split(';').map(x=>x.split(':')).filter(x=>x.length===2).map(x=>[x[0].replace(/-([a-z])/g, g=>g[1].toUpperCase()), x[1]])) as React.CSSProperties}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '3px' }}>{formatDateHeading(toLocalDateIso(sl.starts_at))}</div>
                      <div style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '-.01em', color: '#0F172A' }}>{formatTimeRange(sl.starts_at, sl.ends_at)}</div>
                    </div>
                    {status === 'open' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: '#ECFDF3', color: '#15803D', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{seatsLeft} left</span>}
                    {status === 'few' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: '#FFF7ED', color: '#C2410C', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{seatsLeft} left</span>}
                    {status === 'full' && <span style={{ padding: '4px 9px', borderRadius: '99px', background: '#F1F5F9', color: '#94A3B8', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>Full</span>}
                  </div>
                  {selected && <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: '#2563EB', fontSize: '13px', fontWeight: 700 }}>✓ Selected</div>}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
            <span style={{ fontSize: '13.5px', color: '#94A3B8' }}>{selectedSlot ? `${formatDateHeading(toLocalDateIso(selectedSlot.starts_at))} · ${formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at)}` : "Select a slot to continue"}</span>
            <button type="button" disabled={noSlot} onClick={() => setStep(2)} style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: noSlot ? '#CBD5E1' : '#2563EB', cursor: noSlot ? 'not-allowed' : 'pointer', boxShadow: noSlot ? 'none' : '0 8px 18px -7px rgba(37,99,235,.5)' }}>Continue →</button>
          </div>
        </div>
      )}

      {step === 2 && selectedSlot && (
        <div className="scr book-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr .7fr', gap: '16px', alignItems: 'start' }}>
          <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '20px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 14px', letterSpacing: '-.01em' }}>Your details</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Full name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Aisha Rahman" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', background: '#fff', color: '#0F172A' }} />
              </div>
              <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Student ID</label>
                  <input value={studentId} onChange={e => setStudentId(e.target.value)} placeholder="AC22XXXXX" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', background: '#fff', color: '#0F172A' }} />
                </div>
                <div>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Email</label>
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@xmu.edu.my" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', background: '#fff', color: '#0F172A' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Relevant experience</label>
                <textarea value={experiences} onChange={e => setExperiences(e.target.value)} placeholder="Clubs, events, leadership, gaming, or anything you'd like us to know." rows={4} style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', background: '#fff', color: '#0F172A', resize: 'vertical', lineHeight: 1.5 }}></textarea>
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Relevant links <span style={{ color: '#94A3B8', fontWeight: 500 }}>(optional)</span></label>
                <input value={links} onChange={e => setLinks(e.target.value)} placeholder="e.g. Portfolio, GitHub, LinkedIn" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', background: '#fff', color: '#0F172A' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <button type="button" onClick={() => setStep(1)} style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>← Back</button>
              <button type="button" onClick={confirmBooking} disabled={cantConfirm} style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: cantConfirm ? '#CBD5E1' : '#16A34A', cursor: cantConfirm ? 'not-allowed' : 'pointer', boxShadow: cantConfirm ? 'none' : '0 8px 18px -7px rgba(22,163,74,.45)' }}>{submitting ? 'Booking...' : 'Confirm booking'}</button>
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '16px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', position: 'sticky', top: '80px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: '10px' }}>Your slot</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: track === 'facilitator' ? '#EFF4FF' : '#F3F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>
                {track === 'facilitator' ? '🎯' : '🎮'}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>{track === 'facilitator' ? 'Facilitator' : 'Game Master'}</div>
                <div style={{ fontSize: '12.5px', color: '#64748B' }}>Interview track</div>
              </div>
            </div>
            <div style={{ borderTop: '1px dashed #E2E8F0', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '13px', color: '#64748B' }}>Date</span><span style={{ fontSize: '13.5px', fontWeight: 700 }}>{formatDateHeading(toLocalDateIso(selectedSlot.starts_at))}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '13px', color: '#64748B' }}>Time</span><span style={{ fontSize: '13.5px', fontWeight: 700 }}>{formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at)}</span></div>
            </div>
          </div>
        </div>
      )}

      {step === 3 && confirmation && (
        <div className="scr" style={{ maxWidth: '560px', margin: '0 auto' }}>
          <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '20px', padding: '28px 24px', textAlign: 'center', boxShadow: '0 14px 40px -18px rgba(16,24,40,.2)' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '99px', background: '#ECFDF3', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', animation: 'pop .4s ease' }}>
              <span style={{ fontSize: '30px', color: '#16A34A' }}>✓</span>
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>You're booked!</h2>
            <p style={{ color: '#64748B', fontSize: '14px', margin: '0 0 18px', lineHeight: 1.55 }}>We've emailed a confirmation to <strong style={{ color: '#334155' }}>{email}</strong>. Bring your student ID on the day.</p>
            <div style={{ background: '#F8FAFC', border: '1px solid #EAEEF4', borderRadius: '14px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: '6px' }}>Reference code</div>
              <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '24px', fontWeight: 600, letterSpacing: '.06em', color: '#2563EB' }}>{confirmation.reference}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', textAlign: 'left', marginBottom: '18px' }}>
              <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '13px 15px' }}><div style={{ fontSize: '11.5px', color: '#94A3B8', fontWeight: 600, marginBottom: '2px' }}>Track</div><div style={{ fontSize: '14px', fontWeight: 700 }}>{track === 'facilitator' ? 'Facilitator' : 'Game Master'}</div></div>
              <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '13px 15px' }}><div style={{ fontSize: '11.5px', color: '#94A3B8', fontWeight: 600, marginBottom: '2px' }}>When</div><div style={{ fontSize: '14px', fontWeight: 700 }}>{formatDateHeading(toLocalDateIso(confirmation.slot.starts_at))}</div></div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button type="button" onClick={bookAnother} style={{ padding: '12px 18px', borderRadius: '11px', border: '1px solid #E2E8F0', background: '#fff', color: '#1E293B', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>Book another</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
