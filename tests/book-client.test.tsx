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
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-30T10:00:00+08:00'))
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

  afterEach(() => {
    vi.useRealTimers()
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
      track: 'facilitator',
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

  it('disables Game Master button, keeps track as GM with "Position Closed", and only switches to Facilitator when manually clicked', async () => {
    // 12:30 PM (GM closed, Facilitator open)
    const afterNoonTime = new Date('2026-09-30T12:30:00+08:00').getTime()
    vi.setSystemTime(afterNoonTime)

    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="game_master"
        serverTime={afterNoonTime}
      />
    )

    // Heading should be visible
    expect(screen.getByRole('heading', { name: /select your desired position/i })).toBeDefined()

    // Notice banner should state GM is closed
    expect(screen.getByText(/Game Master interview registration closed at 12:00 PM/i)).toBeDefined()

    // GM button should show Closed badge
    expect(screen.getByText(/Closed \(12:00 PM\)/i)).toBeDefined()

    // GM button should be disabled
    const gmButton = screen.getByRole('button', { name: /game master/i })
    expect(gmButton.getAttribute('disabled')).not.toBeNull()

    // Facilitator button should be enabled
    const facButton = screen.getByRole('button', { name: /facilitator/i })
    expect(facButton.getAttribute('disabled')).toBeNull()

    // It should NOT automatically switch to Facilitator.
    // Instead, the primary action button is disabled with "Position Closed", and "Return to Home" links exist.
    const positionClosedBtn = screen.getByRole('button', { name: /position closed/i })
    expect(positionClosedBtn.getAttribute('disabled')).not.toBeNull()

    const returnHomeLinks = screen.getAllByRole('link', { name: /return to home/i })
    expect(returnHomeLinks.length).toBeGreaterThan(0)
    expect(returnHomeLinks[0].getAttribute('href')).toBe('/')

    // Clicking disabled GM button should remain disabled
    await act(async () => {
      fireEvent.click(gmButton)
    })
    expect(screen.getByRole('button', { name: /position closed/i })).toBeDefined()

    // When the user explicitly chooses Facilitator
    await act(async () => {
      fireEvent.click(facButton)
    })

    // Now Facilitator is selected and they can proceed to select slot
    const continueBtn = screen.getByRole('button', { name: /continue to select slot/i })
    expect(continueBtn.getAttribute('disabled')).toBeNull()
  })

  it('updates UI to closed state and blocks proceeding when deadline passes while user is on page', async () => {
    // Loaded at 11:55 AM (GM is still open)
    const beforeNoon = new Date('2026-09-30T11:55:00+08:00').getTime()
    vi.setSystemTime(beforeNoon)

    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="game_master"
        serverTime={beforeNoon}
      />
    )

    // Button is initially "Continue to Select Slot →"
    const continueBtn = screen.getByRole('button', { name: /continue to select slot/i })
    expect(continueBtn.getAttribute('disabled')).toBeNull()

    // Time passes to 12:05 PM while user is on page
    const afterNoon = new Date('2026-09-30T12:05:00+08:00').getTime()
    vi.setSystemTime(afterNoon)

    // User attempts to click Continue to Select Slot
    await act(async () => {
      fireEvent.click(continueBtn)
    })

    // It should not advance to step 2; instead UI updates to Position Closed
    expect(screen.queryByRole('heading', { name: /select an interview slot/i })).toBeNull()
    expect(screen.getByRole('button', { name: /position closed/i })).toBeDefined()
    expect(screen.getByText(/Game Master interview registration closed at 12:00 PM/i)).toBeDefined()
  })

  it('disables all tracks and provides Check My Booking Slot link when all deadlines (6:00 PM) have passed', async () => {
    // 07:00 PM (Both closed)
    const afterEveningTime = new Date('2026-09-30T19:00:00+08:00').getTime()
    vi.setSystemTime(afterEveningTime)

    render(
      <BookClient
        initialSlotsByTrack={sampleSlots}
        initialOrientation="december"
        initialTrack="facilitator"
        serverTime={afterEveningTime}
      />
    )

    // Banner indicates all registrations closed
    expect(screen.getByText(/All interview slots for December 2026 Orientation have concluded/i)).toBeDefined()

    // Both track buttons should be disabled
    const gmButton = screen.getByRole('button', { name: /game master/i })
    const facButton = screen.getByRole('button', { name: /facilitator/i })
    expect(gmButton.getAttribute('disabled')).not.toBeNull()
    expect(facButton.getAttribute('disabled')).not.toBeNull()

    // Should display Check My Booking Slot link
    const checkBookingLink = screen.getByRole('link', { name: /check my booking slot/i })
    expect(checkBookingLink.getAttribute('href')).toBe('/my-booking')
  })
})
