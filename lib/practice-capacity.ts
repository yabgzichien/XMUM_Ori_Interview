export type PracticeCapacityCategory = 'committee' | 'faci_gm'

export function getPracticeCapacityCategory(position: string): PracticeCapacityCategory {
  return position === 'facilitator' || position === 'game_master' ? 'faci_gm' : 'committee'
}
