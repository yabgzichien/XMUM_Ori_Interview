'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatDateHeading, formatTimeRange, toLocalDateIso } from '@/lib/booking-helpers'
import { cancelBooking, type HeadBooking } from '@/lib/head'

type Props = {
  bookings: HeadBooking[]
  loading: boolean
  error: string | null
  onChanged: () => void
}

export function BookingsTable({ bookings, loading, error, onChanged }: Props) {
  const [filter, setFilter] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return bookings
    return bookings.filter(
      (b) =>
        b.applicant_name?.toLowerCase().includes(needle) ||
        b.applicant_email?.toLowerCase().includes(needle),
    )
  }, [bookings, filter])

  async function handleCancel(b: HeadBooking) {
    if (!window.confirm(`Cancel ${b.applicant_name}'s booking? This frees the seat.`)) {
      return
    }
    setCancelError(null)
    setCancellingId(b.booking_id)
    const { error } = await cancelBooking(b.booking_id)
    setCancellingId(null)
    if (error) {
      setCancelError(error.message)
      return
    }
    onChanged()
  }

  return (
    <section>
      <h2 className="text-lg font-medium">Bookings</h2>

      <input
        type="text"
        placeholder="Filter by name or email"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mt-3 w-full max-w-sm rounded-md border border-border bg-background px-2 py-1 text-sm"
      />

      {loading && <p className="mt-3 text-sm text-zinc-500">Loading...</p>}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {cancelError && <p className="mt-3 text-sm text-destructive">{cancelError}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="mt-3 text-sm text-zinc-500">No bookings found.</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-xs text-zinc-500">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Student ID</th>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Time</th>
                <th className="py-2 pr-3 font-medium">Experiences</th>
                <th className="py-2 pr-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.booking_id} className="border-b border-border align-top text-sm last:border-0">
                  <td className="py-2 pr-3">{b.applicant_name}</td>
                  <td className="py-2 pr-3">{b.applicant_email}</td>
                  <td className="py-2 pr-3">{b.student_id ?? '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatDateHeading(toLocalDateIso(b.starts_at))}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatTimeRange(b.starts_at, b.ends_at)}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="block max-w-xs whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
                      {b.experiences || '—'}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={cancellingId === b.booking_id}
                      onClick={() => handleCancel(b)}
                    >
                      {cancellingId === b.booking_id ? 'Cancelling...' : 'Cancel'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
