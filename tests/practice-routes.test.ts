import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  lookupPractice: vi.fn(),
  createPracticeBooking: vi.fn(),
}))

const rateLimitMocks = vi.hoisted(() => ({
  getVerificationFingerprint: vi.fn(),
  isVerificationRateLimited: vi.fn(),
  recordFailedVerification: vi.fn(),
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
    rateLimitMocks.isVerificationRateLimited.mockResolvedValue(false)
    rateLimitMocks.recordFailedVerification.mockResolvedValue(undefined)
  })

  it('returns verified groups with no-store caching', async () => {
    serviceMocks.lookupPractice.mockResolvedValue({
      data: { state: 'available', groups: [{ id: 'group-1', name: 'Group A', seats_left: 3 }] },
      error: null,
    })
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'DSC2344112',
      email: 'dsc2344112@xmu.edu.my',
    }, { 'x-vercel-forwarded-for': '203.0.113.7' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      data: { state: 'available', groups: [{ id: 'group-1', name: 'Group A', seats_left: 3 }] },
    })
  })

  it('rejects malformed JSON and wrong primitive types', async () => {
    const malformed = await verifyPOST(request('/api/practice/verify', '{'))
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'Invalid request.' })

    const wrongTypes = await verifyPOST(request('/api/practice/verify', {
      studentId: 123,
      email: false,
    }))
    expect(wrongTypes.status).toBe(400)
    expect(await wrongTypes.json()).toEqual({ error: 'Student ID and university email are required.' })
  })

  it('uses one generic identity error and records the failed attempt', async () => {
    serviceMocks.lookupPractice.mockResolvedValue({ data: null, error: 'identity_not_verified' })
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'UNKNOWN',
      email: 'unknown@xmu.edu.my',
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Student ID or university email could not be verified.',
    })
    expect(rateLimitMocks.recordFailedVerification).toHaveBeenCalledWith('fingerprint')
  })

  it('returns 429 before looking up the roster after ten failed attempts', async () => {
    rateLimitMocks.isVerificationRateLimited.mockResolvedValue(true)
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'UNKNOWN',
      email: 'unknown@xmu.edu.my',
    }))
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'Too many verification attempts. Try again later.' })
    expect(serviceMocks.lookupPractice).not.toHaveBeenCalled()
  })

  it('maps missing rate-limit configuration to a generic server error', async () => {
    rateLimitMocks.getVerificationFingerprint.mockImplementation(() => {
      throw new Error('PRACTICE_RATE_LIMIT_SECRET is not configured')
    })
    const response = await verifyPOST(request('/api/practice/verify', {
      studentId: 'DSC2344112',
      email: 'dsc2344112@xmu.edu.my',
    }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Practice verification is temporarily unavailable.' })
  })

  it('maps booking conflicts without recording them as identity failures', async () => {
    serviceMocks.createPracticeBooking.mockResolvedValue({ data: null, error: 'group_full' })
    const response = await bookPOST(request('/api/practice/book', {
      studentId: 'DSC2344112',
      email: 'dsc2344112@xmu.edu.my',
      groupId: 'f8a40f21-8788-4d7c-9597-9d8a197be1c1',
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'That practice group is full.' })
    expect(rateLimitMocks.recordFailedVerification).not.toHaveBeenCalled()
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
