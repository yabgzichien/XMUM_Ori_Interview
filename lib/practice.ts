// Committee-position helpers retained for the account-based admin/profile UI.
// Practice booking itself is account-free and lives in practice-public.ts.

import { createClient } from '@/lib/supabase/client'

export type CommitteePosition =
  | 'hof'
  | 'hog'
  | 'game_master'
  | 'facilitator'
  | 'treasurer'
  | 'sponsorship'
  | 'logistic'
  | 'tech_team'
  | 'organising_chairperson'
  | 'event_planner'
  | 'designer'
  | 'pgvg'
  | 'public_relations'
  | 'secretary'
  | 'general_affairs'

export const POSITIONS: { value: CommitteePosition; label: string }[] = [
  { value: 'hof', label: 'Head of Facilitator (HOF)' },
  { value: 'hog', label: 'Head of Game Master (HOGM)' },
  { value: 'game_master', label: 'Game Master' },
  { value: 'facilitator', label: 'Facilitator' },
  { value: 'treasurer', label: 'Treasurer' },
  { value: 'sponsorship', label: 'Sponsorship' },
  { value: 'logistic', label: 'Logistic' },
  { value: 'tech_team', label: 'Tech Team' },
  { value: 'organising_chairperson', label: 'Organising Chair Person' },
  { value: 'event_planner', label: 'Event Planner' },
  { value: 'designer', label: 'Designer' },
  { value: 'pgvg', label: 'PGVG' },
  { value: 'public_relations', label: 'Public Relation' },
  { value: 'secretary', label: 'Secretary' },
  { value: 'general_affairs', label: 'General Affairs' },
]

export function positionLabel(position: string | null): string {
  if (!position) return 'No position set'
  const known = POSITIONS.find((option) => option.value === position)
  if (known) return known.label
  return position.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

export type CommitteePositionOption = { value: string; label: string }

export async function getCommitteePositions() {
  const supabase = createClient()
  const { data, error } = await supabase.from('committee_positions').select('value, label').order('label')
  return { data: (data as CommitteePositionOption[] | null) ?? null, error }
}

function slugifyPosition(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export async function addCommitteePosition(label: string) {
  const value = slugifyPosition(label)
  if (!value) return { data: null, error: { message: 'Enter a role name.' } as { message: string } }
  const supabase = createClient()
  const { data, error } = await supabase
    .from('committee_positions')
    .insert({ value, label: label.trim() })
    .select('value, label')
    .single()
  return { data: (data as CommitteePositionOption | null) ?? null, error }
}

export async function deleteCommitteePosition(value: string) {
  const supabase = createClient()
  const { error } = await supabase.from('committee_positions').delete().eq('value', value)
  return { error }
}

export async function setCommitteePosition(profileId: string, position: string | null) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_set_committee_position', {
    p_profile_id: profileId,
    p_position: position,
  })
  return { data, error }
}
