import { NextResponse } from 'next/server'
import { lookupPractice } from '@/lib/practice-server'
import { getVerificationFingerprint } from '@/lib/practice-rate-limit'
import { RATE_LIMITED_MESSAGE } from '@/lib/practice-network'

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
  const { studentId } = body as Record<string, unknown>
  if (typeof studentId !== 'string' || !studentId.trim()) {
    return NextResponse.json(
      { error: 'Student ID is required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const result = await lookupPractice({ studentId }, getVerificationFingerprint(request))
    if (result.error === 'rate_limited') {
      return NextResponse.json({ error: RATE_LIMITED_MESSAGE }, { status: 429, headers: NO_STORE })
    }
    if (result.error === 'identity_not_verified') {
      return NextResponse.json(
        { error: 'Student ID could not be verified.' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (result.error === 'booking_not_open') {
      return NextResponse.json(
        { error: 'Booking has not opened yet.' },
        { status: 409, headers: NO_STORE },
      )
    }
    if (result.error) {
      return NextResponse.json(
        { error: 'Practice verification is temporarily unavailable.' },
        { status: 500, headers: NO_STORE },
      )
    }
    return NextResponse.json({ data: result.data }, { status: 200, headers: NO_STORE })
  } catch (error) {
    console.error('[practice/verify] request failed', error)
    return NextResponse.json(
      { error: 'Practice verification is temporarily unavailable.' },
      { status: 500, headers: NO_STORE },
    )
  }
}
