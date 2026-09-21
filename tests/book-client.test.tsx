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

    // Step 1: Advance to slot selection
    const continueToSlotBtn = screen.getByRole('button', { name: /continue to select slot/i })
    await act(async () => {
      fireEvent.click(continueToSlotBtn)
    })

    // Step 2: select slot
    const slotCard = screen.getByText('10:00 AM – 10:15 AM')
    await act(async () => {
      fireEvent.click(slotCard)
    })

    // Click Continue
    const continueBtn = screen.getByRole('button', { name: /^continue/i })
    await act(async () => {
      fireEvent.click(continueBtn)
    })

    // Step 3 is active
    expect(screen.getByRole('heading', { name: /your details/i })).toBeDefined()
    expect(window.history.state?.bookStep).toBe(3)
    expect(bookingsModule.reserveSlot).toHaveBeenCalledWith('slot-test-1', null)

    // Trigger browser Back (popstate)
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { bookStep: 2 } }))
    })

    // Should call releaseHold with the hold token
    expect(bookingsModule.releaseHold).toHaveBeenCalledWith('token-abc')

    // Should return to Step 2
    expect(screen.getByText('Position:')).toBeDefined()
    expect(sessionStorage.getItem('xmumori-book-hold')).toBeNull()
  })

  it('triggers history.back when clicking in-page Back on Step 3', async () => {
    const historyBackSpy = vi.spyOn(window.history, 'back')

    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="facilitator"
      />
    )

    // Step 1: advance to Step 2
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue to select slot/i }))
    })

    // Step 2: Select slot & continue to Step 3
    await act(async () => {
      fireEvent.click(screen.getByText('10:00 AM – 10:15 AM'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^continue/i }))
    })

    expect(screen.getByRole('heading', { name: /your details/i })).toBeDefined()

    // Click in-page Back
    const backBtn = screen.getByRole('button', { name: /← back to slots/i })
    await act(async () => {
      fireEvent.click(backBtn)
    })

    expect(historyBackSpy).toHaveBeenCalled()
    historyBackSpy.mockRestore()
  })

  it('renders "Email (school email)" label, nudges on non-@xmu.edu.my email, and accepts @xmu.edu.my', async () => {
    const confirmReservationMock = vi.mocked(
      (await import('@/app/actions/bookingAction')).confirmReservationAction
    )
    confirmReservationMock.mockResolvedValue({
      data: {
        id: 'booking-1',
        slot_id: 'slot-test-1',
        track: 'facilitator',
        status: 'booked',
        applicant_name: 'Yang Zi Chien',
        applicant_email: 'you@xmu.edu.my',
        student_id: 'AC22XXXXX',
        experiences: '012-3456789',
        created_at: new Date().toISOString(),
      },
      error: null,
    })

    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="facilitator"
      />
    )

    // Step 1: Advance to Step 2
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue to select slot/i }))
    })

    // Step 2: Select slot & continue to Step 3
    await act(async () => {
      fireEvent.click(screen.getByText('10:00 AM – 10:15 AM'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^continue/i }))
    })

    // 1. Verify label "Email (Campus Email)" or "Email (school email)"
    expect(screen.getByLabelText(/Email \((?:campus|school) email\)/i)).toBeDefined()

    const nameInput = screen.getByLabelText(/Full name/i)
    const studentIdInput = screen.getByLabelText(/^Student ID$/i)
    const emailInput = screen.getByLabelText(/Email \((?:campus|school) email\)/i)
    const contactInput = screen.getByLabelText(/Contact number/i)
    const confirmBtn = screen.getByRole('button', { name: /confirm booking/i })

    // Fill valid details except email
    fireEvent.change(nameInput, { target: { value: 'Yang Zi Chien' } })
    fireEvent.change(studentIdInput, { target: { value: 'DSC2405104' } })
    fireEvent.change(contactInput, { target: { value: '012-3456789' } })

    // 2. Type non-school email (e.g. @gmail.com)
    fireEvent.change(emailInput, { target: { value: 'you@gmail.com' } })

    // Verify nudge appears immediately
    expect(
      screen.getByText(/Only @xmu\.edu\.my email is accepted\. Please use your (?:campus|school) email\./i)
    ).toBeDefined()

    // Try submitting with non-school email
    await act(async () => {
      fireEvent.click(confirmBtn)
    })
    expect(confirmReservationMock).not.toHaveBeenCalled()

    // 3. Update to school email @xmu.edu.my
    fireEvent.change(emailInput, { target: { value: 'you@xmu.edu.my' } })

    // Verify error is gone
    expect(
      screen.queryByText(/Only @xmu\.edu\.my email is accepted\. Please use your (?:campus|school) email\./i)
    ).toBeNull()

    // Submit with school email
    await act(async () => {
      fireEvent.click(confirmBtn)
    })

    expect(confirmReservationMock).toHaveBeenCalledWith('token-abc', {
      name: 'Yang Zi Chien',
      studentId: 'DSC2405104',
      email: 'you@xmu.edu.my',
      contactNumber: '012-3456789',
    })
  })

  it('allows bidirectional stepper navigation and preserves slot selection', async () => {
    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="facilitator"
      />
    )

    // Step 1: click Next to go to Step 2
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue to select slot/i }))
    })
    expect(screen.getByRole('heading', { name: /select an interview slot/i })).toBeDefined()

    // Step 2: select slot
    await act(async () => {
      fireEvent.click(screen.getByText('10:00 AM – 10:15 AM'))
    })
    expect(screen.getByText('✓ Selected')).toBeDefined()

    // Navigate back to Step 1 via in-page Back button
    const backBtn = screen.getByRole('button', { name: /^← back$/i })
    await act(async () => {
      fireEvent.click(backBtn)
    })
    expect(screen.getByRole('heading', { name: /select your desired position/i })).toBeDefined()

    // Advance to Step 2 again: slot should still be selected!
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue to select slot/i }))
    })
    expect(screen.getByText('✓ Selected')).toBeDefined()

    // Advance to Step 3
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^continue/i }))
    })
    expect(screen.getByRole('heading', { name: /your details/i })).toBeDefined()

    // Fill in partial details
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'Zi Chien' } })

    // Use Stepper to jump directly to Step 1
    const step1Btn = screen.getByRole('button', { name: /step 1: choose position/i })
    await act(async () => {
      fireEvent.click(step1Btn)
    })
    // Hold should be released
    expect(bookingsModule.releaseHold).toHaveBeenCalledWith('token-abc')
    expect(screen.getByRole('heading', { name: /select your desired position/i })).toBeDefined()

    // Use Stepper to jump to Step 2
    const step2Btn = screen.getByRole('button', { name: /step 2: choose slot/i })
    await act(async () => {
      fireEvent.click(step2Btn)
    })
    expect(screen.getByRole('heading', { name: /select an interview slot/i })).toBeDefined()
    expect(screen.getByText('✓ Selected')).toBeDefined()

    // Advance to Step 3 again: verify input details were preserved
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^continue/i }))
    })
    expect(screen.getByRole('heading', { name: /your details/i })).toBeDefined()
    expect((screen.getByLabelText(/Full name/i) as HTMLInputElement).value).toBe('Zi Chien')
  })

  it('handles browser forward popstate correctly from step 1 to step 2', async () => {
    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="facilitator"
      />
    )

    expect(screen.getByRole('heading', { name: /select your desired position/i })).toBeDefined()

    // Forward popstate to step 2
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { bookStep: 2 } }))
    })
    expect(screen.getByRole('heading', { name: /select an interview slot/i })).toBeDefined()

    // Backward popstate to step 1
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { bookStep: 1 } }))
    })
    expect(screen.getByRole('heading', { name: /select your desired position/i })).toBeDefined()
  })
})
