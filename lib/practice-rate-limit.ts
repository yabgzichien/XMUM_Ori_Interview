import 'server-only'

import { createHmac } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientAddress } from '@/lib/practice-network'

export function getVerificationFingerprint(request: Request): string {
  const secret = process.env.PRACTICE_RATE_LIMIT_SECRET
  if (!secret) throw new Error('PRACTICE_RATE_LIMIT_SECRET is not configured')
  const address = getClientAddress(request.headers)
  return createHmac('sha256', secret).update(address).digest('hex')
}

export async function reserveVerificationAttempt(fingerprint: string): Promise<number | null> {
  const database = createAdminClient()
  const { data, error } = await database.rpc('reserve_practice_verification_attempt', {
    p_address_fingerprint: fingerprint,
  })
  if (error) throw error
  return data as number | null
}

export async function releaseVerificationAttempt(attemptId: number): Promise<void> {
  const database = createAdminClient()
  const { error } = await database.rpc('release_practice_verification_attempt', {
    p_attempt: attemptId,
  })
  if (error) throw error
}
