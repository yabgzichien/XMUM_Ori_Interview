import type {
  PracticeApiResult,
  PracticeBookingInput,
  PracticeBookingResult,
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
