import { NextResponse } from 'next/server'
import { releasePracticeHold } from '@/lib/practice-server'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  let token: unknown
  try {
    token = ((await request.json()) as Record<string, unknown> | null)?.token
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  }
  if (typeof token !== 'string' || !UUID.test(token)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  }
  try {
    await releasePracticeHold(token)
  } catch {
    // Holds expire on their own; a failed release is not fatal.
  }
  return NextResponse.json({ data: null }, { status: 200, headers: NO_STORE })
}
