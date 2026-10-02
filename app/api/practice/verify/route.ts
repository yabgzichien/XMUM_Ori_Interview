import { NextResponse } from 'next/server'
import { lookupPractice } from '@/lib/practice-server'
import {
  getVerificationFingerprint,
  releaseVerificationAttempt,
  reserveVerificationAttempt,
} from '@/lib/practice-rate-limit'

const NO_STORE = { 'Cache-Control': 'no-store' }

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
  const { studentId, email } = body as Record<string, unknown>
  if (typeof studentId !== 'string' || typeof email !== 'string' || !studentId.trim() || !email.trim()) {
    return NextResponse.json(
      { error: 'Student ID and university email are required.' },
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

    const result = await lookupPractice({ studentId, email })
    if (result.error === 'identity_not_verified') {
      retainAttempt = true
      return NextResponse.json(
        { error: 'Student ID or university email could not be verified.' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (result.error) {
      return NextResponse.json(
        { error: 'Practice verification is temporarily unavailable.' },
        { status: 500, headers: NO_STORE },
      )
    }
    return NextResponse.json({ data: result.data }, { status: 200, headers: NO_STORE })
  } catch {
    return NextResponse.json(
      { error: 'Practice verification is temporarily unavailable.' },
      { status: 500, headers: NO_STORE },
    )
  } finally {
    if (attemptId !== null && !retainAttempt) {
      try {
        await releaseVerificationAttempt(attemptId)
      } catch {
        // Cleanup must never overwrite an authoritative verification response.
      }
    }
  }
}
