import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { mapPracticeCatalog, mapPracticeLookup } from '@/lib/practice-catalog'
import type {
  PracticeCatalog,
  PracticeBookingInput,
  PracticeBookingResult,
  PracticeHold,
  PracticeIdentityInput,
  PracticeLookupResult,
} from '@/lib/practice-types'

export type PracticeServiceError =
  | 'identity_not_verified'
  | 'group_full'
  | 'group_unavailable'
  | 'already_booked'
  | 'booking_not_open'
  | 'hold_expired'
  | 'server_error'

export type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: PracticeServiceError }

function classifyError(message: string): PracticeServiceError {
  if (message.includes('identity_not_verified')) return 'identity_not_verified'
  if (message.includes('group_full')) return 'group_full'
  if (message.includes('group_unavailable')) return 'group_unavailable'
  if (message.includes('already_booked')) return 'already_booked'
  if (message.includes('booking_not_open')) return 'booking_not_open'
  if (message.includes('hold_expired')) return 'hold_expired'
  return 'server_error'
}

function practiceAudioUrl(database: ReturnType<typeof createAdminClient>) {
  return (path: string) => database.storage.from('practice-audio').getPublicUrl(path).data.publicUrl
}

async function leaderNamesFor(database: ReturnType<typeof createAdminClient>, groupId: string): Promise<string[]> {
  const { data: links } = await database.from('practice_group_leaders').select('roster_member_id').eq('group_id', groupId)
  const ids = (links ?? []).map((link: { roster_member_id: string }) => link.roster_member_id)
  if (ids.length === 0) return []
  const { data: leaders } = await database.from('committee_roster').select('name').in('id', ids).order('name')
  return (leaders ?? []).map((leader: { name: string }) => leader.name)
}

export async function getPracticeCatalog(): Promise<ServiceResult<PracticeCatalog>> {
  const database = createAdminClient()
  const { data, error } = await database.rpc('public_practice_catalog')
  if (error) return { data: null, error: classifyError(error.message) }
  return {
    data: mapPracticeCatalog(data as Parameters<typeof mapPracticeCatalog>[0], practiceAudioUrl(database)),
    error: null,
  }
}

export async function lookupPractice(
  input: PracticeIdentityInput,
): Promise<ServiceResult<PracticeLookupResult>> {
  const database = createAdminClient()
  const { data, error } = await database.rpc('public_practice_lookup', {
    p_student_id: input.studentId,
    p_email: input.email,
  })
  if (error) return { data: null, error: classifyError(error.message) }
  const lookup = mapPracticeLookup(data as Parameters<typeof mapPracticeLookup>[0], practiceAudioUrl(database))
  if (lookup.state === 'booked') {
    lookup.booking = { ...lookup.booking, leader_names: await leaderNamesFor(database, lookup.booking.group_id) }
  }
  return { data: lookup, error: null }
}

export async function createPracticeBooking(
  input: PracticeBookingInput,
): Promise<ServiceResult<PracticeBookingResult>> {
  const database = createAdminClient()
  const { data, error } = await database.rpc('public_book_practice_group', {
    p_student_id: input.studentId,
    p_email: input.email,
    p_group: input.groupId,
    p_token: input.holdToken ?? null,
  })
  if (error) return { data: null, error: classifyError(error.message) }
  const booking = data as PracticeBookingResult
  return { data: { ...booking, leader_names: await leaderNamesFor(database, booking.group_id) }, error: null }
}

export async function reservePracticeGroup(
  input: PracticeBookingInput,
): Promise<ServiceResult<PracticeHold>> {
  const database = createAdminClient()
  const { data, error } = await database.rpc('public_reserve_practice_group', {
    p_student_id: input.studentId,
    p_email: input.email,
    p_group: input.groupId,
  })
  if (error) return { data: null, error: classifyError(error.message) }
  return { data: data as PracticeHold, error: null }
}

export async function releasePracticeHold(token: string): Promise<void> {
  const database = createAdminClient()
  await database.rpc('public_release_practice_hold', { p_token: token })
}
