import { describe, it, expect, vi } from 'vitest'
import { confirmReservationAction } from '@/app/actions/bookingAction'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendBookingConfirmation: vi.fn().mockResolvedValue({ success: true }),
}))

describe('confirmReservationAction email domain validation', () => {
  it('rejects missing or empty email', async () => {
    const res = await confirmReservationAction('token-1', {
      name: 'Tester',
      studentId: 'ID123',
      email: '',
    })
    expect(res).toEqual({
      data: null,
      error: 'Only @xmu.edu.my email addresses are accepted.',
    })
  })

  it('rejects non-@xmu.edu.my email (such as gmail)', async () => {
    const res = await confirmReservationAction('token-1', {
      name: 'Tester',
      studentId: 'ID123',
      email: 'tester@gmail.com',
    })
    expect(res).toEqual({
      data: null,
      error: 'Only @xmu.edu.my email addresses are accepted.',
    })
  })

  it('rejects invalid email formats', async () => {
    const res = await confirmReservationAction('token-1', {
      name: 'Tester',
      studentId: 'ID123',
      email: 'not-an-email',
    })
    expect(res).toEqual({
      data: null,
      error: 'Only @xmu.edu.my email addresses are accepted.',
    })
  })
})

describe('confirmReservationAction deadline validation', () => {
  it('rejects confirmation when game_master deadline has passed', async () => {
    // 12:30 PM (GM closed)
    const afterNoon = new Date('2026-09-30T12:30:00+08:00').getTime()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(afterNoon)

    const res = await confirmReservationAction('token-1', {
      name: 'Tester',
      studentId: 'ID123',
      email: 'tester@xmu.edu.my',
      track: 'game_master',
    })
    expect(res).toEqual({
      data: null,
      error: 'Game Master interview registration closed at 12:00 PM.',
    })

    nowSpy.mockRestore()
  })
})
