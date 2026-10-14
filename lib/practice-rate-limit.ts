import 'server-only'

import { createHmac } from 'node:crypto'
import { getClientAddress } from '@/lib/practice-network'

// The limit itself is enforced inside the practice_*_limited database
// functions (0058), in the same round trip as the request's work.
export function getVerificationFingerprint(request: Request): string {
  const secret = process.env.PRACTICE_RATE_LIMIT_SECRET
  if (!secret) throw new Error('PRACTICE_RATE_LIMIT_SECRET is not configured')
  const address = getClientAddress(request.headers)
  return createHmac('sha256', secret).update(address).digest('hex')
}
