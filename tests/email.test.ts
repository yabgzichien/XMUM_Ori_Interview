// Regression cover for the confirmation email's contents. The venue was
// plumbed into the template but never fetched by the booking action, so every
// applicant was emailed "TBA" regardless of what the Head had set.

import { describe, expect, it } from 'vitest'
import { buildBookingConfirmationHtml } from '@/lib/email'

const base = {
  id: 'b1',
  applicant_name: 'Aisha Rahman',
  applicant_email: 'aisha@xmu.edu.my',
  track: 'facilitator',
  starts_at: new Date(2026, 7, 20, 9, 0).toISOString(),
  ends_at: new Date(2026, 7, 20, 9, 15).toISOString(),
  created_at: new Date(2026, 7, 15).toISOString(),
}

describe('buildBookingConfirmationHtml', () => {
  it('shows the slot venue when one is set', () => {
    const html = buildBookingConfirmationHtml({ ...base, venue: 'Block A1, Room 203' })
    expect(html).toContain('Block A1, Room 203')
    expect(html).not.toContain('>TBA<')
  })

  it('falls back to TBA when the slot has no venue', () => {
    expect(buildBookingConfirmationHtml({ ...base, venue: '' })).toContain('TBA')
    expect(buildBookingConfirmationHtml(base)).toContain('TBA')
  })

  it('includes the applicant, track, date and time', () => {
    const html = buildBookingConfirmationHtml({ ...base, venue: 'Hall B' })
    expect(html).toContain('Aisha Rahman')
    expect(html).toContain('Facilitator')
    expect(html).toContain('Thu, 20 Aug 2026')
    expect(html).toContain('9:00 AM')
    expect(html).toContain('9:15 AM')
  })
})

describe('Email configuration error handling', () => {
  it('fails with explicit error in production when SMTP env vars are unset', async () => {
    const { sendInvitationEmail } = await import('@/lib/email')
    const originalEnv = process.env.NODE_ENV
    const originalHost = process.env.SMTP_HOST
    const originalUser = process.env.SMTP_USER
    const originalPass = process.env.SMTP_PASSWORD

    try {
      // @ts-expect-error override readonly in test
      process.env.NODE_ENV = 'production'
      delete process.env.SMTP_HOST
      delete process.env.SMTP_USER
      delete process.env.SMTP_PASSWORD

      const res = await sendInvitationEmail({
        name: 'Test Candidate',
        email: 'test@candidate.local',
        code: 'TESTCODE',
        activationLink: 'https://example.com/register',
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('SMTP configuration is missing in production environment')
    } finally {
      // @ts-expect-error restore in test
      process.env.NODE_ENV = originalEnv
      if (originalHost) process.env.SMTP_HOST = originalHost
      if (originalUser) process.env.SMTP_USER = originalUser
      if (originalPass) process.env.SMTP_PASSWORD = originalPass
    }
  })
})
