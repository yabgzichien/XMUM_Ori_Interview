import { beforeEach, describe, expect, it, vi } from 'vitest'

const RATE_LIMITED_MESSAGE =
  'Too many people are booking from this network right now. Switch to mobile data and try again.'

const serviceMocks = vi.hoisted(() => ({
  lookupPractice: vi.fn(),
  createPracticeBooking: vi.fn(),
}))

const rateLimitMocks = vi.hoisted(() => ({
  getVerificationFingerprint: vi.fn(),
}))

vi.mock('@/lib/practice-server', () => serviceMocks)
vi.mock('@/lib/practice-rate-limit', () => rateLimitMocks)

import { POST as verifyPOST } from '@/app/api/practice/verify/route'
import { POST as bookPOST } from '@/app/api/practice/book/route'
import { getClientAddress } from '@/lib/practice-network'

function request(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('public practice routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMocks.getVerificationFingerprint.mockReturnValue('fingerprint')
  })

  it('returns verified groups with no-store caching', async () => {
    serviceMocks.lookupPractice.mockResolvedValue({
      data: { state: 'available', groups: [{ id: 'group-1', name: 'Group A', seats_left: 3 }] },
      error: null,
    })
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'DSC2344112',
    }, { 'x-vercel-forwarded-for': '203.0.113.7' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      data: { state: 'available', groups: [{ id: 'group-1', name: 'Group A', seats_left: 3 }] },
    })
    expect(serviceMocks.lookupPractice).toHaveBeenCalledWith({ studentId: 'DSC2344112' }, 'fingerprint')
  })

  it('rejects malformed JSON and wrong primitive types', async () => {
    const malformed = await verifyPOST(request('/api/practice/verify', '{'))
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'Invalid request.' })

    const wrongTypes = await verifyPOST(request('/api/practice/verify', {
      studentId: 123,
    }))
    expect(wrongTypes.status).toBe(400)
    expect(await wrongTypes.json()).toEqual({ error: 'Student ID is required.' })
  })

  it('uses one generic identity error for an unverified student ID', async () => {
    serviceMocks.lookupPractice.mockResolvedValue({ data: null, error: 'identity_not_verified' })
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'UNKNOWN',
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Student ID could not be verified.',
    })
  })

  it('returns 429 when the address has too many failed checks', async () => {
    serviceMocks.lookupPractice.mockResolvedValue({ data: null, error: 'rate_limited' })
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'UNKNOWN',
    }))
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: RATE_LIMITED_MESSAGE })
  })

  it('tells a rate-limited student to switch to mobile data when booking', async () => {
    serviceMocks.createPracticeBooking.mockResolvedValue({ data: null, error: 'rate_limited' })
    const response = await bookPOST(request('/api/practice/book', {
      studentId: 'ABC1234567',
      groupId: 'group-1',
    }))
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: RATE_LIMITED_MESSAGE })
  })

  it('maps missing rate-limit configuration to a generic server error', async () => {
    rateLimitMocks.getVerificationFingerprint.mockImplementation(() => {
      throw new Error('PRACTICE_RATE_LIMIT_SECRET is not configured')
    })
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'DSC2344112',
    }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Practice verification is temporarily unavailable.' })
  })

  it('logs the underlying error server-side when the route fails', async () => {
    const failure = new Error('PRACTICE_RATE_LIMIT_SECRET is not configured')
    rateLimitMocks.getVerificationFingerprint.mockImplementation(() => { throw failure })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await verifyPOST(request('/api/practice/verify', { studentId: 'DSC2344112' }))
    await bookPOST(request('/api/practice/book', { studentId: 'DSC2344112', groupId: 'group-1' }))

    expect(log).toHaveBeenCalledWith('[practice/verify] request failed', failure)
    expect(log).toHaveBeenCalledWith('[practice/book] request failed', failure)
    log.mockRestore()
  })

  it('maps booking conflicts to 409', async () => {
    serviceMocks.createPracticeBooking.mockResolvedValue({ data: null, error: 'group_full' })
    const response = await bookPOST(request('/api/practice/book', {
      studentId: 'DSC2344112',
      groupId: 'f8a40f21-8788-4d7c-9597-9d8a197be1c1',
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'That practice group is full.' })
  })

  it('rejects verification before the shared opening time with a clear conflict', async () => {
    serviceMocks.lookupPractice.mockResolvedValue({ data: null, error: 'booking_not_open' })
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'DSC2344112',
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Booking has not opened yet.' })
  })

  it('rejects booking before the shared opening time with a clear conflict', async () => {
    serviceMocks.createPracticeBooking.mockResolvedValue({ data: null, error: 'booking_not_open' })
    const response = await bookPOST(request('/api/practice/book', {
      studentId: 'DSC2344112',
      groupId: 'f8a40f21-8788-4d7c-9597-9d8a197be1c1',
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Booking has not opened yet.' })
  })

  it('passes the hold token and address fingerprint to the booking service', async () => {
    serviceMocks.createPracticeBooking.mockResolvedValue({
      data: { id: 'booking-1', group_id: 'group-1', group_name: 'Group A', sessions: [], leader_names: ['Alice Tan'] },
      error: null,
    })
    const response = await bookPOST(request('/api/practice/book', {
      studentId: 'DSC2344112', groupId: 'group-1', holdToken: 'hold-1',
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { id: 'booking-1', leader_names: ['Alice Tan'] } })
    expect(serviceMocks.createPracticeBooking).toHaveBeenCalledWith(
      { studentId: 'DSC2344112', groupId: 'group-1', holdToken: 'hold-1' },
      'fingerprint',
    )
  })

  it('returns a generic error when the booking service throws', async () => {
    serviceMocks.createPracticeBooking.mockRejectedValue(new Error('backend unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await bookPOST(request('/api/practice/book', {
      studentId: 'DSC2344112', groupId: 'group-1',
    }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'The booking could not be completed.' })
    log.mockRestore()
  })

  it('uses the platform-controlled address header ahead of forwarded-for in production', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.7, 10.0.0.1',
      'x-forwarded-for': '198.51.100.99',
    })
    expect(getClientAddress(headers, 'production')).toBe('203.0.113.7')
    expect(getClientAddress(headers, 'development')).toBe('203.0.113.7')
  })
})
