// Single source of truth for interview tracks. The DB enum still holds
// facilitator / game_master for past bookings, but only Action Team is open
// for new interviews.

export type Track = 'facilitator' | 'game_master' | 'action_team'

export const BOOKABLE_TRACK: Track = 'action_team'

export const TRACK_LABELS: Record<Track, string> = {
  facilitator: 'Facilitator',
  game_master: 'Game Master',
  action_team: 'Action Team',
}

export const TRACK_ICONS: Record<Track, string> = {
  facilitator: '🎯',
  game_master: '🎮',
  action_team: '⚡',
}

export function isTrack(value: unknown): value is Track {
  return value === 'facilitator' || value === 'game_master' || value === 'action_team'
}

const BADGE_VAR: Record<Track, string> = {
  facilitator: 'facilitator',
  game_master: 'gm',
  action_team: 'action',
}

// Colours come from the --badge-* tokens in globals.css (light + dark).
export function trackBadgeStyle(track: string | null | undefined): { background: string; color: string; border: string } {
  const key = isTrack(track) ? BADGE_VAR[track] : 'action'
  return {
    background: `var(--badge-${key}-bg)`,
    color: `var(--badge-${key}-text)`,
    border: `1px solid var(--badge-${key}-border)`,
  }
}

export function trackLabel(track: string | null | undefined): string {
  if (!track) return '-'
  return isTrack(track) ? TRACK_LABELS[track] : track
}
