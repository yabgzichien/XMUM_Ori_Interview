'use client'

import { useCallback, useEffect, useState } from 'react'
import { getTrackSettings, updateTrackWindow, type Track, type Orientation } from '@/lib/head'

// Converts an ISO timestamp (or null) to the value a <input type="datetime-local">
// expects, in local time.
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null
  return new Date(value).toISOString()
}

type Props = {
  track: Track
  orientation: Orientation
  orientationYear?: number
}

export function WindowForm({ track, orientation, orientationYear = 2026 }: Props) {
  const [windowOpen, setWindowOpen] = useState('')
  const [windowClose, setWindowClose] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const { data, error: loadError } = await getTrackSettings(track, orientation, orientationYear)
    setLoading(false)
    setSaved(false)
    if (loadError) {
      setError(loadError.message)
      return
    }
    setError(null)
    setWindowOpen(toDatetimeLocalValue(data?.window_open ?? null))
    setWindowClose(toDatetimeLocalValue(data?.window_close ?? null))
  }, [track, orientation, orientationYear])

  useEffect(() => {
    load()
  }, [load])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    const { error: saveError } = await updateTrackWindow(
      track,
      orientation,
      fromDatetimeLocalValue(windowOpen),
      fromDatetimeLocalValue(windowClose),
      orientationYear,
    )
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="form-card" style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '26px', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>⚙️</div>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 2px' }}>Booking window</h2>
          <p style={{ fontSize: '12.5px', color: '#64748B', margin: 0 }}>Leave blank = always open.</p>
        </div>
      </div>
      
      {loading ? (
        <p style={{ fontSize: '13px', color: '#94A3B8' }}>Loading...</p>
      ) : (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Opens</label>
            <input
              type="datetime-local"
              value={windowOpen}
              onChange={(e) => setWindowOpen(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', marginBottom: '5px', display: 'block' }}>Closes</label>
            <input
              type="datetime-local"
              value={windowClose}
              onChange={(e) => setWindowClose(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: '9px', fontSize: '14px', fontFamily: 'inherit', color: '#475569' }}
            />
          </div>
          <button type="button" disabled={saving} onClick={handleSave} style={{ padding: '10.5px 18px', borderRadius: '9px', border: 'none', background: saved ? '#16A34A' : '#2563EB', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', boxShadow: saved ? 'none' : '0 4px 12px -4px rgba(37,99,235,.4)', transition: 'all 0.2s', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      )}
      
      {error && <p style={{ marginTop: '10px', fontSize: '13px', color: '#B91C1C' }}>{error}</p>}
    </div>
  )
}
