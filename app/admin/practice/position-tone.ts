/** Facilitator tags are green, Game Master tags yellow, everything else purple. */
export function positionToneClass(position: string): 'tagFaci' | 'tagGm' | 'tagDefault' {
  if (position === 'facilitator') return 'tagFaci'
  if (position === 'game_master') return 'tagGm'
  return 'tagDefault'
}
