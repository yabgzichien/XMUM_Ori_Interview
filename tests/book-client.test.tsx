import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { BookClient } from '@/app/book/BookClient'
import * as bookingsModule from '@/lib/bookings'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/bookings', () => ({
  getAvailableSlots: vi.fn(),
  reserveSlot: vi.fn(),
  releaseHold: vi.fn(),
}))

vi.mock('@/app/actions/bookingAction', () => ({
  confirmReservationAction: vi.fn(),
}))

const sampleSlots = {
  facilitator: [
    {
      id: 'slot-test-1',
      track: 'facilitator' as const,
      orientation: 'december' as const,
      orientation_year: 2026,
      starts_at: '2026-12-01T10:00:00+08:00',
      ends_at: '2026-12-01T10:15:00+08:00',
      capacity: 1,
      booked_count: 0,
      seats_left: 1,
      venue: 'Room 101',
    },
  ],
  game_master: [],
}

describe('BookClient history and hold release', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
    vi.mocked(bookingsModule.getAvailableSlots).mockResolvedValue({
      data: sampleSlots.facilitator,
      error: null,
    })
    vi.mocked(bookingsModule.reserveSlot).mockResolvedValue({
      data: { hold_id: 'hold-1', token: 'token-abc', expires_at: new Date(Date.now() + 600000).toISOString() },
      error: null,
    })
    vi.mocked(bookingsModule.releaseHold).mockResolvedValue({ error: null })
  })

  it('pushes history state on continue and releases hold on browser popstate', async () => {
    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="facilitator"
      />
    )

    // Step 1: select slot
    const slotCard = screen.getByText('10:00 AM – 10:15 AM')
    await act(async () => {
      fireEvent.click(slotCard)
    })

    // Click Continue
    const continueBtn = screen.getByRole('button', { name: /continue/i })
    await act(async () => {
      fireEvent.click(continueBtn)
    })

    // Step 2 is active
    expect(screen.getByRole('heading', { name: /your details/i })).toBeDefined()
    expect(window.history.state?.bookStep).toBe(2)
    expect(bookingsModule.reserveSlot).toHaveBeenCalledWith('slot-test-1', null)

    // Trigger browser Back (popstate)
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { bookStep: 1 } }))
    })

    // Should call releaseHold with the hold token
    expect(bookingsModule.releaseHold).toHaveBeenCalledWith('token-abc')

    // Should return to Step 1
    expect(screen.getByText('Select position')).toBeDefined()
    expect(sessionStorage.getItem('xmumori-book-hold')).toBeNull()
  })

  it('triggers history.back when clicking in-page Back on Step 2', async () => {
    const historyBackSpy = vi.spyOn(window.history, 'back')

    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="facilitator"
      />
    )

    // Select slot & continue
    await act(async () => {
      fireEvent.click(screen.getByText('10:00 AM – 10:15 AM'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    })

    expect(screen.getByRole('heading', { name: /your details/i })).toBeDefined()

    // Click in-page Back
    const backBtn = screen.getByRole('button', { name: /← back/i })
    await act(async () => {
      fireEvent.click(backBtn)
    })

    expect(historyBackSpy).toHaveBeenCalled()
    historyBackSpy.mockRestore()
  })
})
