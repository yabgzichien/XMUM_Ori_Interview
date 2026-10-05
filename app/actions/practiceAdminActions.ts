'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth'
import { normalizeStudentId } from '@/lib/practice-identity'
import { getYouTubeVideoId, isSecureExternalUrl } from '@/lib/practice-media'
import type { PracticeGroupStatus, PracticeSongType } from '@/lib/practice-types'
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
  if (message.includes('member_category_capacity_full')) return "This member's booked group has no space in the new category."
  if (message.includes('group_full')) return 'The destination group is full.'
  if (message.includes('group_has_bookings')) return 'Move or remove every member before deleting this group.'
  if (message.includes('committee_capacity_below_booking_count')) return 'Committee capacity cannot be lower than the current committee member count.'
  if (message.includes('faci_gm_capacity_below_booking_count')) return 'Faci/GM capacity cannot be lower than the current Faci/GM member count.'
  if (message.includes('capacity_below_booking_count')) return 'Capacity cannot be lower than the current member count.'
  if (message.includes('duplicate') || message.includes('unique')) return 'That value is already in use.'
  return 'The practice change could not be saved.'
}

function refreshPracticeAdmin() {
  revalidatePath('/admin/practice')
  revalidatePath('/practice')
}

const PRACTICE_AUDIO_BUCKET = 'practice-audio'
const MAX_PRACTICE_AUDIO_BYTES = 20 * 1024 * 1024

function formText(form: FormData, key: string) {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

export async function savePracticeOpeningAction(input: { opensAt: string | null }): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  let bookingOpensAt: string | null = null
  if (input.opensAt !== null) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.opensAt)) {
      return { data: null, error: 'Enter a valid opening date and time.' }
    }
    const parsed = new Date(`${input.opensAt}:00+08:00`)
    if (Number.isNaN(parsed.getTime())) return { data: null, error: 'Enter a valid opening date and time.' }
    bookingOpensAt = parsed.toISOString()
  }

  const database = await createClient()
  const { data, error } = await database.from('practice_settings').upsert({
    orientation: 'december',
    orientation_year: 2026,
    booking_opens_at: bookingOpensAt,
    updated_by: auth.profile.id,
  }, { onConflict: 'orientation,orientation_year' }).select('*').single()
  if (error) return { data: null, error: mapDatabaseError(error.message) }
  refreshPracticeAdmin()
  return { data, error: null }
}

export async function savePracticeGroupDetailsAction(form: FormData): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const groupId = formText(form, 'groupId')
  const performanceType = formText(form, 'performanceType')
  const description = formText(form, 'description')
  const leaderRosterMemberId = formText(form, 'leaderRosterMemberId')
  const performanceVideoUrl = formText(form, 'performanceVideoUrl')
  const rawSongSource = formText(form, 'songSourceType')
  const songSourceType = rawSongSource as PracticeSongType | ''
  const songUrl = formText(form, 'songUrl')
  const songFile = form.get('songFile')

  if (!groupId) return { data: null, error: 'Practice group is required.' }
  if (performanceType.length > 80) return { data: null, error: 'Performance type must be 80 characters or fewer.' }
  if (description.length > 2000) return { data: null, error: 'Description must be 2,000 characters or fewer.' }
  if (performanceVideoUrl && !getYouTubeVideoId(performanceVideoUrl)) {
    return { data: null, error: 'Enter a valid YouTube performance video link.' }
  }
  if (songSourceType && !['youtube', 'mp3', 'external'].includes(songSourceType)) {
    return { data: null, error: 'Choose a valid song source.' }
  }
  if (songSourceType === 'youtube' && !getYouTubeVideoId(songUrl)) {
    return { data: null, error: 'Enter a valid YouTube song link.' }
  }
  if (songSourceType === 'external' && !isSecureExternalUrl(songUrl)) {
    return { data: null, error: 'Enter a valid HTTPS audio link.' }
  }

  const database = await createClient()
  const { data: existing, error: existingError } = await database
    .from('practice_groups')
    .select('id, song_storage_path')
    .eq('id', groupId)
    .single()
  if (existingError || !existing) return { data: null, error: 'Practice group was not found.' }

  if (leaderRosterMemberId) {
    const { data: leader, error: leaderError } = await database
      .from('committee_roster')
      .select('id')
      .eq('id', leaderRosterMemberId)
      .eq('active', true)
      .maybeSingle()
    if (leaderError || !leader) return { data: null, error: 'Choose an active roster member as performance leader.' }
  }

  let nextStoragePath = songSourceType === 'mp3' ? existing.song_storage_path as string | null : null
  let uploadedPath: string | null = null
  if (songSourceType === 'mp3' && songFile instanceof File && songFile.size > 0) {
    if (!['audio/mpeg', 'audio/mp3'].includes(songFile.type) || !songFile.name.toLowerCase().endsWith('.mp3')) {
      return { data: null, error: 'Upload an MP3 audio file.' }
    }
    if (songFile.size > MAX_PRACTICE_AUDIO_BYTES) {
      return { data: null, error: 'MP3 file must be 20 MB or smaller.' }
    }
    uploadedPath = `${groupId}/${crypto.randomUUID()}.mp3`
    const { error: uploadError } = await database.storage.from(PRACTICE_AUDIO_BUCKET).upload(uploadedPath, songFile, {
      cacheControl: '3600',
      contentType: 'audio/mpeg',
      upsert: false,
    })
    if (uploadError) return { data: null, error: 'The MP3 file could not be uploaded.' }
    nextStoragePath = uploadedPath
  }
  if (songSourceType === 'mp3' && !nextStoragePath) {
    return { data: null, error: 'Choose an MP3 file.' }
  }

  const payload = {
    performance_type: performanceType || null,
    description: description || null,
    leader_roster_member_id: leaderRosterMemberId || null,
    performance_video_url: performanceVideoUrl || null,
    song_source_type: songSourceType || null,
    song_url: songSourceType === 'youtube' || songSourceType === 'external' ? songUrl : null,
    song_storage_path: nextStoragePath,
  }
  const { data, error } = await database.from('practice_groups').update(payload).eq('id', groupId).select('*').single()
  if (error) {
    if (uploadedPath) await database.storage.from(PRACTICE_AUDIO_BUCKET).remove([uploadedPath])
    return { data: null, error: mapDatabaseError(error.message) }
  }

  const oldStoragePath = existing.song_storage_path as string | null
  if (oldStoragePath && oldStoragePath !== nextStoragePath) {
    await database.storage.from(PRACTICE_AUDIO_BUCKET).remove([oldStoragePath])
  }
  refreshPracticeAdmin()
  return { data, error: null }
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

function validateCategoryCapacities(committeeCapacity: number, faciGmCapacity: number) {
  if (!Number.isInteger(committeeCapacity) || !Number.isInteger(faciGmCapacity) || committeeCapacity < 0 || faciGmCapacity < 0) {
    return 'Each category capacity must be 0 or more.'
  }
  if (committeeCapacity + faciGmCapacity < 1) return 'At least one category must have capacity.'
  return null
}

export async function createPracticeGroupAction(input: {
  name: string
  committeeCapacity: number
  faciGmCapacity: number
}): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const name = input.name.trim()
  if (!name) return { data: null, error: 'Group name is required.' }
  const capacityError = validateCategoryCapacities(input.committeeCapacity, input.faciGmCapacity)
  if (capacityError) return { data: null, error: capacityError }
  const database = await createClient()
  const { data, error } = await database.from('practice_groups').insert({
    name,
    capacity: input.committeeCapacity + input.faciGmCapacity,
    committee_capacity: input.committeeCapacity,
    faci_gm_capacity: input.faciGmCapacity,
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
  committeeCapacity: number
  faciGmCapacity: number
  status: PracticeGroupStatus
}): Promise<ActionResult> {
  const auth = await requirePracticeAdmin()
  if (auth.error) return { data: null, error: auth.error }
  const name = input.name.trim()
  if (!name) return { data: null, error: 'Group name is required.' }
  const capacityError = validateCategoryCapacities(input.committeeCapacity, input.faciGmCapacity)
  if (capacityError) return { data: null, error: capacityError }
  if (input.status !== 'open' && input.status !== 'closed') {
    return { data: null, error: 'Choose a valid group status.' }
  }
  const database = await createClient()
  const { data, error } = await database.rpc('admin_update_practice_group', {
    p_group: input.id,
    p_name: name,
    p_committee_capacity: input.committeeCapacity,
    p_faci_gm_capacity: input.faciGmCapacity,
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
