// The rate limit is keyed by public IP, and campus Wi-Fi puts many students
// behind one address. Mobile data gives the student their own.
export const RATE_LIMITED_MESSAGE =
  'Too many people are booking from this network right now. Switch to mobile data and try again.'

function firstAddress(value: string | null): string | null {
  const address = value?.split(',')[0]?.trim()
  return address || null
}

export function getClientAddress(
  headers: Headers,
  environment = process.env.NODE_ENV,
): string {
  const platformAddress = firstAddress(headers.get('x-vercel-forwarded-for'))
  if (platformAddress) return platformAddress
  if (environment !== 'production') {
    return firstAddress(headers.get('x-forwarded-for')) ?? 'local-development'
  }
  return 'unknown-production-client'
}
