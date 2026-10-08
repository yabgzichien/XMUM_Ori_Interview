import { NextResponse } from 'next/server'
import { reservePracticeGroup, type PracticeServiceError } from '@/lib/practice-server'
import {
  getVerificationFingerprint,
  releaseVerificationAttempt,
  reserveVerificationAttempt,
} from '@/lib/practice-rate-limit'

const NO_STORE = { 'Cache-Control': 'no-store' }

const conflictMessages: Partial<Record<PracticeServiceError, string>> = {
  group_full: 'That practice group is full.',
  group_unavailable: 'That practice group is no longer available.',
  already_booked: 'You already have a performance-practice group booking.',
  booking_not_open: 'Booking has not opened yet.',
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  }
  const { studentId, email, groupId } = body as Record<string, unknown>
  if (
    typeof studentId !== 'string' || !studentId.trim()
    || typeof email !== 'string' || !email.trim()
    || typeof groupId !== 'string' || !groupId.trim()
  ) {
    return NextResponse.json(
      { error: 'Student ID, university email, and group are required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  let attemptId: number | null = null
  let retainAttempt = false
  try {
    const fingerprint = getVerificationFingerprint(request)
    attemptId = await reserveVerificationAttempt(fingerprint)
    if (attemptId === null) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Try again later.' },
        { status: 429, headers: NO_STORE },
      )
    }

    const result = await reservePracticeGroup({ studentId, email, groupId })
    if (result.error === 'identity_not_verified') {
      retainAttempt = true
      return NextResponse.json(
        { error: 'Student ID or university email could not be verified.' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (result.error && conflictMessages[result.error]) {
      return NextResponse.json(
        { error: conflictMessages[result.error] },
        { status: 409, headers: NO_STORE },
      )
    }
    if (result.error) {
      return NextResponse.json(
        { error: 'The seat could not be held.' },
        { status: 500, headers: NO_STORE },
      )
    }
    return NextResponse.json({ data: result.data }, { status: 200, headers: NO_STORE })
  } catch {
    return NextResponse.json(
      { error: 'The seat could not be held.' },
      { status: 500, headers: NO_STORE },
    )
  } finally {
    if (attemptId !== null && !retainAttempt) {
      try {
        await releaseVerificationAttempt(attemptId)
      } catch {
        // Cleanup must never overwrite an authoritative booking response.
      }
    }
  }
}
