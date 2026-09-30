import type { Track } from '@/lib/bookings'

export type TrackDeadlineInfo = {
  closeAt: string
  label: string
}

export const TRACK_DEADLINES: Record<Track, TrackDeadlineInfo> = {
  game_master: {
    closeAt: process.env.NEXT_PUBLIC_GM_CLOSE_AT || '2026-09-30T12:00:00+08:00',
    label: '12:00 PM',
  },
  facilitator: {
    closeAt: process.env.NEXT_PUBLIC_FACI_CLOSE_AT || '2026-09-30T18:00:00+08:00',
    label: '6:00 PM',
  },
}

/**
 * Returns true if registration for the specified track is past its closing deadline.
 */
export function isTrackClosed(track: Track, nowMs: number = Date.now()): boolean {
  const conf = TRACK_DEADLINES[track]
  if (!conf?.closeAt) return false
  const deadlineMs = new Date(conf.closeAt).getTime()
  return nowMs >= deadlineMs
}
