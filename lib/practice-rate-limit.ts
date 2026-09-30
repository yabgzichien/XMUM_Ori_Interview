import 'server-only'

import { createHmac } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientAddress } from '@/lib/practice-network'

const MAX_FAILED_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000
const RETENTION_MS = 24 * 60 * 60 * 1000

export function getVerificationFingerprint(request: Request): string {
  const secret = process.env.PRACTICE_RATE_LIMIT_SECRET
  if (!secret) throw new Error('PRACTICE_RATE_LIMIT_SECRET is not configured')
  const address = getClientAddress(request.headers)
  return createHmac('sha256', secret).update(address).digest('hex')
}

export async function isVerificationRateLimited(fingerprint: string): Promise<boolean> {
  const database = createAdminClient()
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString()
  const { count, error } = await database
    .from('practice_verification_failures')
    .select('id', { count: 'exact', head: true })
    .eq('address_fingerprint', fingerprint)
    .gte('attempted_at', cutoff)
  if (error) throw error
  return (count ?? 0) >= MAX_FAILED_ATTEMPTS
}

export async function recordFailedVerification(fingerprint: string): Promise<void> {
  const database = createAdminClient()
  const { error } = await database
    .from('practice_verification_failures')
    .insert({ address_fingerprint: fingerprint })
  if (error) throw error

  const retentionCutoff = new Date(Date.now() - RETENTION_MS).toISOString()
  await database.from('practice_verification_failures').delete().lt('attempted_at', retentionCutoff)
}
