// Single source of truth for the orientation cycle the app defaults to.
// Every route that has to pick a cycle when none is in the URL (the landing
// page, /book, /head, /head/practice) reads these, so the counts advertised
// in one place always describe the slots another place actually shows.

export type Orientation = 'february' | 'april' | 'december'

export const DEFAULT_ORIENTATION: Orientation = 'december'
export const DEFAULT_ORIENTATION_YEAR = 2026

export const ORIENTATIONS: { key: Orientation; label: string; icon: string }[] = [
  { key: 'february', label: 'February', icon: '🌸' },
  { key: 'april', label: 'April', icon: '🌿' },
  { key: 'december', label: 'December', icon: '❄️' },
]

export function isOrientation(value: unknown): value is Orientation {
  return value === 'february' || value === 'april' || value === 'december'
}

export function orientationLabel(orientation: Orientation): string {
  return ORIENTATIONS.find((o) => o.key === orientation)?.label ?? orientation
}
