'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getTrackSettings, updateTrackWindow, type Track } from '@/lib/head'

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

// Converts a <input type="datetime-local"> value back to an ISO string, or
// null if blank.
function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null
  return new Date(value).toISOString()
}

type Props = {
  track: Track
}

export function WindowForm({ track }: Props) {
  const [windowOpen, setWindowOpen] = useState('')
  const [windowClose, setWindowClose] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // No synchronous setState before the await — safe to call from the effect.
  const load = useCallback(async () => {
    const { data, error: loadError } = await getTrackSettings(track)
    setLoading(false)
    setSaved(false)
    if (loadError) {
      setError(loadError.message)
      return
    }
    setError(null)
    setWindowOpen(toDatetimeLocalValue(data?.window_open ?? null))
    setWindowClose(toDatetimeLocalValue(data?.window_close ?? null))
  }, [track])

  useEffect(() => {
    // Fetch-on-mount/track-change; state is only set after the await inside load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    const { error: saveError } = await updateTrackWindow(
      track,
      fromDatetimeLocalValue(windowOpen),
      fromDatetimeLocalValue(windowClose),
    )
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setSaved(true)
  }

  return (
    <section>
      <h2 className="text-lg font-medium">Booking window</h2>
      <p className="mt-1 text-sm text-zinc-500">Leave blank = always open.</p>

      {loading ? (
        <p className="mt-3 text-sm text-zinc-500">Loading...</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Opens
            <input
              type="datetime-local"
              value={windowOpen}
              onChange={(e) => setWindowOpen(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Closes
            <input
              type="datetime-local"
              value={windowClose}
              onChange={(e) => setWindowClose(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          {saved && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  )
}
