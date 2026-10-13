// Booking window state for a track, read from track_settings. Mirrors the
// check in reserve_slot / confirm_reservation: open when now is inside
// window_open .. window_close, where a null bound means unbounded. A missing
// row (window === null) is closed, because the DB refuses bookings then too.

export type BookingWindow = {
  window_open: string | null
  window_close: string | null
}

export function isWindowClosed(window: BookingWindow | null, nowMs: number = Date.now()): boolean {
  if (!window) return true
  if (window.window_open && nowMs < new Date(window.window_open).getTime()) return true
  if (window.window_close && nowMs > new Date(window.window_close).getTime()) return true
  return false
}

export function formatWindowTime(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kuala_Lumpur',
  })
}
