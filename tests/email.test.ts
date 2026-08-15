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
