// Thin data-access functions for the performance practice group feature.
// Each function constructs its own browser client at call time (never at
// module load) so this file is safe to import even when env vars are unset
// at build time. Mirrors the lib/head.ts / lib/bookings.ts pattern.

import { createClient } from '@/lib/supabase/client'

export type Track = 'facilitator' | 'game_master'
export type Orientation = 'february' | 'april' | 'december'
export type GroupStatus = 'open' | 'closed'

export type AvailableGroup = {
  id: string
  name: string
  lead_id: string
  lead_name: string
  capacity: number
  member_count: number
  seats_left: number
  status: GroupStatus
  session_count: number
}

export type MyGroup = {
  group_id: string
  name: string
  lead_id: string
  lead_name: string
  capacity: number
  member_count: number
  status: GroupStatus
  is_lead: boolean
}

export type PracticeSession = {
  id: string
  starts_at: string
  ends_at: string
}

export type GroupMember = {
  member_id: string
  member_name: string
  joined_at: string
}

export type HeadPracticeGroup = {
  id: string
  name: string
  lead_id: string
  lead_name: string
  lead_email: string
  capacity: number
  member_count: number
  status: GroupStatus
  session_count: number
  created_at: string
}

export type CommitteeRosterEntry = {
  id: string
  name: string
  email: string
  track: Track
  role: 'committee' | 'performance_lead'
  leading_group_id: string | null
}

// ---------- Committee: browse, join, leave ----------

export async function getAvailablePracticeGroups() {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('available_practice_groups')
  return { data: (data as AvailableGroup[] | null) ?? null, error }
}

export async function getMyPracticeGroup() {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('my_practice_group')
  const rows = (data as MyGroup[] | null) ?? null
  return { data: rows && rows.length > 0 ? rows[0] : null, error }
}

export async function getMyPracticeGroupSessions() {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('my_practice_group_sessions')
  return { data: (data as PracticeSession[] | null) ?? null, error }
}

export async function getMyPracticeGroupMembers() {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('my_practice_group_members')
  return { data: (data as GroupMember[] | null) ?? null, error }
}

export async function joinPracticeGroup(groupId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('join_practice_group', { p_group: groupId })
  return { data, error }
}

export async function leavePracticeGroup() {
  const supabase = createClient()
  const { error } = await supabase.rpc('leave_practice_group')
  return { error }
}

// ---------- Performance lead: manage own group's sessions ----------

export async function leadCreateSession(groupId: string, startsAt: string, endsAt: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('lead_create_session', {
    p_group: groupId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  })
  return { data: (data as PracticeSession | null) ?? null, error }
}

export async function leadUpdateSession(sessionId: string, startsAt: string, endsAt: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('lead_update_session', {
    p_session: sessionId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  })
  return { data: (data as PracticeSession | null) ?? null, error }
}

export async function leadDeleteSession(sessionId: string) {
  const supabase = createClient()
  const { error } = await supabase.rpc('lead_delete_session', { p_session: sessionId })
  return { error }
}

// ---------- Head/admin: manage groups + leads ----------

export async function getHeadPracticeGroups(orientation: Orientation, orientationYear: number = 2026) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_practice_groups', {
    p_orientation: orientation,
    p_year: orientationYear,
  })
  return { data: (data as HeadPracticeGroup[] | null) ?? null, error }
}

export async function getHeadCommitteeRoster(orientation: Orientation, orientationYear: number = 2026) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_committee_roster', {
    p_orientation: orientation,
    p_year: orientationYear,
  })
  return { data: (data as CommitteeRosterEntry[] | null) ?? null, error }
}

export async function createPracticeGroup(
  name: string,
  orientation: Orientation,
  capacity: number,
  leadProfileId: string,
  orientationYear: number = 2026,
) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_create_practice_group', {
    p_name: name,
    p_orientation: orientation,
    p_capacity: capacity,
    p_lead_profile_id: leadProfileId,
    p_year: orientationYear,
  })
  return { data, error }
}

export async function updatePracticeGroup(
  groupId: string,
  name: string,
  capacity: number,
  status: GroupStatus,
) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_update_practice_group', {
    p_group: groupId,
    p_name: name,
    p_capacity: capacity,
    p_status: status,
  })
  return { data, error }
}

export async function reassignPracticeLead(groupId: string, newLeadProfileId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_reassign_practice_lead', {
    p_group: groupId,
    p_new_lead_profile_id: newLeadProfileId,
  })
  return { data, error }
}

export async function deletePracticeGroup(groupId: string) {
  const supabase = createClient()
  const { error } = await supabase.rpc('head_delete_practice_group', { p_group: groupId })
  return { error }
}

// Head/admin dashboard drill-down: plain table reads, covered by the
// practice_*_select_head_or_admin RLS policies (same pattern as
// getTrackSettings in lib/head.ts).

export async function getGroupSessions(groupId: string) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('practice_sessions')
    .select('id, starts_at, ends_at')
    .eq('group_id', groupId)
    .order('starts_at')
  return { data: (data as PracticeSession[] | null) ?? null, error }
}

export async function getGroupMembers(groupId: string) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('practice_group_members')
    .select('member_id, joined_at, profiles(name, email)')
    .eq('group_id', groupId)
    .order('joined_at')
  return { data, error }
}
