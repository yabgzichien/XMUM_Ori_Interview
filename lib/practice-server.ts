import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  PracticeBookingInput,
  PracticeBookingResult,
  PracticeIdentityInput,
  PracticeLookupResult,
} from '@/lib/practice-types'

export type PracticeServiceError =
  | 'identity_not_verified'
  | 'group_full'
  | 'group_unavailable'
  | 'already_booked'
  | 'server_error'

export type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: PracticeServiceError }

function classifyError(message: string): PracticeServiceError {
  if (message.includes('identity_not_verified')) return 'identity_not_verified'
  if (message.includes('group_full')) return 'group_full'
  if (message.includes('group_unavailable')) return 'group_unavailable'
  if (message.includes('already_booked')) return 'already_booked'
  return 'server_error'
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
  return { data: data as PracticeLookupResult, error: null }
}

export async function createPracticeBooking(
  input: PracticeBookingInput,
): Promise<ServiceResult<PracticeBookingResult>> {
  const database = createAdminClient()
  const { data, error } = await database.rpc('public_book_practice_group', {
    p_student_id: input.studentId,
    p_email: input.email,
    p_group: input.groupId,
  })
  if (error) return { data: null, error: classifyError(error.message) }
  return { data: data as PracticeBookingResult, error: null }
}
