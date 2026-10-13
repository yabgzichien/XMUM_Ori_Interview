'use client'

import { useEffect, useState } from 'react'
import { setBookingWindow, type Orientation, type Track } from '@/lib/head'
import { formatWindowTime, isWindowClosed, type BookingWindow } from '@/lib/booking-window'
import { trackLabel } from '@/lib/tracks'

type Props = {
  track: Track
  orientation: Orientation
  orientationYear: number
  initialWindow: BookingWindow | null
}

// <input type="datetime-local"> works in the browser's local time; the admin
// is in Malaysia, so local time is MYT in practice.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const btnStyle: React.CSSProperties = { padding: '9px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }

export function BookingWindowPanel({ track, orientation, orientationYear, initialWindow }: Props) {
  const [bookingWindow, setBookingWindowState] = useState<BookingWindow | null>(initialWindow)
  const [closeAt, setCloseAt] = useState(toLocalInput(initialWindow?.window_close ?? null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Re-evaluate once a minute so a scheduled close flips the badge on its own.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const closed = isWindowClosed(bookingWindow, now)
  const scheduledClose = !closed && bookingWindow?.window_close ? bookingWindow.window_close : null

  async function save(windowClose: string | null) {
    setSaving(true)
    setError(null)
    const { data, error: err } = await setBookingWindow(track, orientation, null, windowClose, orientationYear)
    setSaving(false)
    if (err || !data) {
      setError(err?.message || 'Could not update the booking window.')
      return
    }
    setBookingWindowState({ window_open: data.window_open, window_close: data.window_close })
    setCloseAt(toLocalInput(data.window_close))
    setNow(Date.now())
  }

  function scheduleClose() {
    if (!closeAt) return
    const at = new Date(closeAt)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      setError('Pick a closing time in the future, or use Close now.')
      return
    }
    save(at.toISOString())
  }

  return (
    <div style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #EAEEF4)', borderRadius: '18px', padding: '18px 20px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary, #0F172A)' }}>{trackLabel(track)} booking link</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted, #64748B)', marginTop: '2px' }}>
            {closed
              ? 'Closed. Applicants cannot book new interview slots.'
              : scheduledClose
              ? `Open. Closes automatically ${formatWindowTime(scheduledClose)}.`
              : 'Open with no closing time. Close it manually when you are done.'}
          </div>
        </div>
        <span style={{
          padding: '4px 10px',
          borderRadius: '99px',
          fontSize: '12px',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          background: closed ? 'var(--badge-danger-bg, #FEF2F2)' : 'var(--badge-success-bg, #ECFDF3)',
          color: closed ? 'var(--badge-danger-text, #B91C1C)' : 'var(--badge-success-text, #15803D)',
          border: `1px solid ${closed ? 'var(--badge-danger-border, #FECACA)' : 'var(--badge-success-border, #BBF7D0)'}`,
        }}>
          {closed ? 'Closed' : 'Open'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
        {closed ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => save(null)}
            style={{ ...btnStyle, border: 'none', color: '#fff', background: 'var(--btn-accent-bg, #2563EB)' }}
          >
            {saving ? 'Saving…' : 'Open booking link'}
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (!confirm('Close the booking link now? Applicants already booked keep their slots.')) return
              save(new Date().toISOString())
            }}
            style={{ ...btnStyle, border: '1px solid var(--btn-danger-border, #FECACA)', color: 'var(--btn-danger-text, #B91C1C)', background: 'var(--btn-danger-bg, #FEE2E2)' }}
          >
            {saving ? 'Saving…' : 'Close now'}
          </button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label htmlFor="booking-close-at" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted, #64748B)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Auto-close at
          </label>
          <input
            id="booking-close-at"
            type="datetime-local"
            value={closeAt}
            onChange={(e) => setCloseAt(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid var(--border-input, #E2E8F0)', borderRadius: '8px', fontSize: '13.5px', fontFamily: 'inherit', color: 'var(--text-primary, #0F172A)', background: 'var(--bg-input, #fff)' }}
          />
        </div>
        <button
          type="button"
          disabled={saving || !closeAt}
          onClick={scheduleClose}
          style={{ ...btnStyle, border: '1px solid var(--border-input, #E2E8F0)', color: 'var(--text-secondary, #334155)', background: 'var(--bg-card, #fff)' }}
        >
          {closed ? 'Open until this time' : 'Set closing time'}
        </button>
        {scheduledClose && (
          <button
            type="button"
            disabled={saving}
            onClick={() => save(null)}
            style={{ ...btnStyle, border: 'none', background: 'transparent', color: 'var(--text-secondary, #475569)', textDecoration: 'underline' }}
          >
            Remove closing time
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--badge-danger-bg, #FEF2F2)', border: '1px solid var(--badge-danger-border, #FECACA)', color: 'var(--badge-danger-text, #B91C1C)', fontSize: '13px', fontWeight: 600 }}>
          {error}
        </div>
      )}
    </div>
  )
}
