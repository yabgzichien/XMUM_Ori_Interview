'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import { normalizeStudentId } from '@/lib/practice-identity'
import type { PracticeGroupStatus } from '@/lib/practice-types'
import { createClient } from '@/lib/supabase/server'

type ActionResult<T = unknown> = { data: T | null; error: string | null }

async function requirePracticeAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { profile: null, error: 'Not signed in.' as const }
  if (profile.role !== 'admin') return { profile: null, error: 'Not authorized.' as const }
  return { profile, error: null }
}

function mapDatabaseError(message: string): string {
  if (message.includes('member_not_active')) return 'Reactivate this roster member before assigning them.'
  if (message.includes('already_booked')) return 'This roster member already has a group booking.'
  if (message.includes('group_full')) return 'The destination group is full.'
  if (message.includes('group_has_bookings')) return 'Move or remove every member before deleting this group.'
  if (message.includes('capacity_below_booking_count')) return 'Capacity cannot be lower than the current member count.'
  if (message.includes('duplicate') || message.includes('unique')) return 'That value is already in use.'
  return 'The practice change could not be saved.'
}

function refreshPracticeAdmin() {
  revalidatePath('/admin/practice')
}

export async function saveRosterMemberAction(input: {
  id?: string
  name: string
  studentId: string
  position: string
}): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const name = input.name.trim()
  if (!name) return { data: null, error: 'Name is required.' }
  const studentId = normalizeStudentId(input.studentId)
  if (!studentId) return { data: null, error: 'Enter a valid student ID.' }
  if (!input.position.trim()) return { data: null, error: 'Choose a valid committee position.' }

  const database = await createClient()
  const { data: validPosition, error: positionError } = await database
    .from('committee_positions')
    .select('value')
    .eq('value', input.position)
    .maybeSingle()
  if (positionError || !validPosition) return { data: null, error: 'Choose a valid committee position.' }

  const payload = { name, student_id: studentId, position: input.position }
  const query = input.id
    ? database.from('committee_roster').update(payload).eq('id', input.id)
    : database.from('committee_roster').insert({ ...payload, active: true })
  const { data, error } = await query.select('*').single()
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data, error: null }
}

export async function setRosterMemberActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  if (!id) return { data: null, error: 'Roster member is required.' }
  const database = await createClient()
  const { data, error } = await database
    .from('committee_roster')
    .update({ active })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data, error: null }
}

export async function createPracticeGroupAction(input: { name: string; capacity: number }): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const name = input.name.trim()
  if (!name) return { data: null, error: 'Group name is required.' }
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    return { data: null, error: 'Capacity must be at least 1.' }
  }
  const database = await createClient()
  const { data, error } = await database.from('practice_groups').insert({
    name,
    capacity: input.capacity,
    status: 'open',
    orientation: 'december',
    orientation_year: 2026,
    created_by: auth.profile.id,
  }).select('*').single()
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data, error: null }
}

export async function updatePracticeGroupAction(input: {
  id: string
  name: string
  capacity: number
  status: PracticeGroupStatus
}): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const name = input.name.trim()
  if (!name) return { data: null, error: 'Group name is required.' }
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    return { data: null, error: 'Capacity must be at least 1.' }
  }
  if (input.status !== 'open' && input.status !== 'closed') {
    return { data: null, error: 'Choose a valid group status.' }
  }
  const database = await createClient()
  const { data, error } = await database.rpc('admin_update_practice_group', {
    p_group: input.id,
    p_name: name,
    p_capacity: input.capacity,
    p_status: input.status,
  })
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data, error: null }
}

export async function deletePracticeGroupAction(id: string): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const database = await createClient()
  const { error } = await database.rpc('admin_delete_practice_group', { p_group: id })
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data: true, error: null }
}

export async function savePracticeSessionAction(input: {
  id?: string
  groupId: string
  startsAt: string
  endsAt: string
  location: string
}): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const start = new Date(input.startsAt)
  const end = new Date(input.endsAt)
  if (!input.groupId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { data: null, error: 'Enter a valid group, start time, and end time.' }
  }
  if (end <= start) return { data: null, error: 'Session end time must be after its start time.' }
  const database = await createClient()
  const payload = {
    group_id: input.groupId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    location: input.location.trim(),
    created_by: auth.profile.id,
  }
  const query = input.id
    ? database.from('practice_sessions').update(payload).eq('id', input.id)
    : database.from('practice_sessions').insert(payload)
  const { data, error } = await query.select('*').single()
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data, error: null }
}

export async function deletePracticeSessionAction(id: string): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const database = await createClient()
  const { error } = await database.from('practice_sessions').delete().eq('id', id)
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data: true, error: null }
}

export async function assignPracticeMemberAction(memberId: string, groupId: string): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const database = await createClient()
  const { data, error } = await database.rpc('admin_assign_practice_member', {
    p_roster_member: memberId,
    p_group: groupId,
  })
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data, error: null }
}

export async function movePracticeMemberAction(bookingId: string, groupId: string): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const database = await createClient()
  const { data, error } = await database.rpc('admin_move_practice_member', {
    p_booking: bookingId,
    p_group: groupId,
  })
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data, error: null }
}

export async function removePracticeBookingAction(bookingId: string): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const database = await createClient()
  const { error } = await database.rpc('admin_remove_practice_booking', { p_booking: bookingId })
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data: true, error: null }
}
