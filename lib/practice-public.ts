import type {
  PracticeApiResult,
  PracticeBookingInput,
  PracticeBookingResult,
  PracticeHold,
  PracticeIdentityInput,
  PracticeLookupResult,
} from '@/lib/practice-types'

async function postJson<T>(url: string, input: unknown): Promise<PracticeApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
    })
    const payload = await response.json() as { data?: T; error?: string }
    return {
      data: response.ok ? payload.data ?? null : null,
      error: response.ok ? null : payload.error ?? 'The request could not be completed.',
      status: response.status,
    }
  } catch {
    return { data: null, error: 'The request could not be completed.', status: 0 }
  }
}

export function verifyPracticeMember(input: PracticeIdentityInput) {
  return postJson<PracticeLookupResult>('/api/practice/verify', input)
}

export function bookPracticeGroup(input: PracticeBookingInput) {
  return postJson<PracticeBookingResult>('/api/practice/book', input)
}

export function reservePracticeGroup(input: PracticeBookingInput) {
  return postJson<PracticeHold>('/api/practice/reserve', input)
}

export function releasePracticeHold(token: string) {
  // Fire-and-forget; keepalive lets it finish while the page is leaving.
  return fetch('/api/practice/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    keepalive: true,
  }).catch(() => undefined)
}
