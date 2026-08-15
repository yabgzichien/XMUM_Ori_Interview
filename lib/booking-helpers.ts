// Pure, dependency-free helpers for the applicant booking UI. No Supabase
// imports here so these can be unit-tested in isolation.

export type AvailableSlot = {
  id: string
  track: string
  orientation: string
  starts_at: string
  ends_at: string
  capacity: number
  booked_count: number
  seats_left: number
  venue?: string
}

/** Returns the local calendar date (YYYY-MM-DD) for an ISO timestamp. */
export function toLocalDateIso(iso: string): string {
  const d = new Date(iso)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Groups slots by local calendar date. Each group's slots are sorted by
 * start time ascending; groups are sorted by date ascending.
 */
export function groupSlotsByDate(
  slots: AvailableSlot[],
): { date: string; slots: AvailableSlot[] }[] {
  const byDate = new Map<string, AvailableSlot[]>()

  for (const slot of slots) {
    const date = toLocalDateIso(slot.starts_at)
    const existing = byDate.get(date)
    if (existing) {
      existing.push(slot)
    } else {
      byDate.set(date, [slot])
    }
  }

  const groups = Array.from(byDate.entries()).map(([date, daySlots]) => ({
    date,
    slots: [...daySlots].sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    ),
  }))

  groups.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return groups
}

/** True if the slot still has seats and starts in the future. */
export function isBookable(slot: AvailableSlot, now: Date = new Date()): boolean {
  return slot.seats_left > 0 && new Date(slot.starts_at) > now
}

/** True if the slot has already ended (so it won't show in the public Book tab). */
export function isPastSlot(endsAt: string, now: Date = new Date()): boolean {
  return new Date(endsAt).getTime() <= now.getTime()
}

/**
 * Mirrors the DB's `within_cutoff` check: true if `now` is still before
 * `startsAt - cutoffHours`, i.e. the booking may still be cancelled/rescheduled.
 */
export function canModifyBooking(
  startsAt: string,
  cutoffHours: number,
  now: Date = new Date(),
): boolean {
  const cutoff = new Date(startsAt).getTime() - cutoffHours * 3600_000
  return now.getTime() < cutoff
}

/** Formats a start/end ISO pair as e.g. "6:30 PM – 6:45 PM". */
export function formatTimeRange(startsAt: string, endsAt: string): string {
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const start = timeFormatter.format(new Date(startsAt))
  const end = timeFormatter.format(new Date(endsAt))
  return `${start} – ${end}`
}

/** Formats an ISO date (YYYY-MM-DD) as e.g. "Mon, 15 Jun 2026". */
export function formatDateHeading(dateIso: string): string {
  // Parse as a local date (not UTC) by splitting the parts explicitly.
  const [year, month, day] = dateIso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')}`
}
