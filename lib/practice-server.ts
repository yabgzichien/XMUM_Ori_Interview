import 'server-only'

import { derivedUniversityEmail, normalizeStudentId } from '@/lib/practice-identity'
import { createAdminClient } from '@/lib/supabase/admin'
import { mapPracticeCatalog, mapPracticeLookup } from '@/lib/practice-catalog'
import type {
  PracticeCatalog,
  PracticeBookingInput,
  PracticeBookingResult,
  PracticeHold,
  PracticeIdentityInput,
  PracticeLookupResult,
  PracticeMemberSummary,
} from '@/lib/practice-types'

export type PracticeServiceError =
  | 'identity_not_verified'
  | 'group_full'
  | 'group_unavailable'
  | 'already_booked'
  | 'booking_not_open'
  | 'hold_expired'
  | 'rate_limited'
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
  if (message.includes('rate_limited')) return 'rate_limited'
  return 'server_error'
}

function rosterIdentity(studentId: string): { studentId: string; email: string } | null {
  const normalizedId = normalizeStudentId(studentId)
  const email = derivedUniversityEmail(normalizedId)
  if (!normalizedId || !email) return null
  return { studentId: normalizedId, email }
}

function practiceAudioUrl(database: ReturnType<typeof createAdminClient>) {
  return (path: string) => database.storage.from('practice-audio').getPublicUrl(path).data.publicUrl
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

// The *_limited functions check the per-address rate limit, run the work, and
// record a failure only for an unverified student ID — one round trip each.
type LimitedResult<T> = { data: T; error?: undefined } | { data?: undefined; error: PracticeServiceError }

async function callLimited<T>(name: string, args: Record<string, unknown>): Promise<ServiceResult<T>> {
  const database = createAdminClient()
  const { data, error } = await database.rpc(name, args)
  if (error) return { data: null, error: classifyError(error.message) }
  const result = data as LimitedResult<T>
  if (result.error) return { data: null, error: result.error }
  return { data: result.data as T, error: null }
}

export async function lookupPractice(
  input: PracticeIdentityInput,
  addressFingerprint: string,
): Promise<ServiceResult<PracticeLookupResult>> {
  const identity = rosterIdentity(input.studentId)
  if (!identity) return { data: null, error: 'identity_not_verified' }
  const result = await callLimited<Parameters<typeof mapPracticeLookup>[0] & { member: PracticeMemberSummary | null }>(
    'practice_verify_limited',
    { p_address_fingerprint: addressFingerprint, p_student_id: identity.studentId, p_email: identity.email },
  )
  if (result.error) return result
  const { member, ...raw } = result.data
  const lookup = mapPracticeLookup(raw, practiceAudioUrl(createAdminClient()))
  return { data: member ? { ...lookup, member } : lookup, error: null }
}

export async function createPracticeBooking(
  input: PracticeBookingInput,
  addressFingerprint: string,
): Promise<ServiceResult<PracticeBookingResult>> {
  const identity = rosterIdentity(input.studentId)
  if (!identity) return { data: null, error: 'identity_not_verified' }
  return callLimited<PracticeBookingResult>('practice_book_limited', {
    p_address_fingerprint: addressFingerprint,
    p_student_id: identity.studentId,
    p_email: identity.email,
    p_group: input.groupId,
    p_token: input.holdToken ?? null,
  })
}

export async function reservePracticeGroup(
  input: PracticeBookingInput,
  addressFingerprint: string,
): Promise<ServiceResult<PracticeHold>> {
  const identity = rosterIdentity(input.studentId)
  if (!identity) return { data: null, error: 'identity_not_verified' }
  return callLimited<PracticeHold>('practice_reserve_limited', {
    p_address_fingerprint: addressFingerprint,
    p_student_id: identity.studentId,
    p_email: identity.email,
    p_group: input.groupId,
  })
}

export async function releasePracticeHold(token: string): Promise<void> {
  const database = createAdminClient()
  await database.rpc('public_release_practice_hold', { p_token: token })
}
