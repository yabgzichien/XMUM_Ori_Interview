import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PracticeClient } from '@/app/practice/PracticeClient'
import PracticePage from '@/app/practice/page'
import * as publicPractice from '@/lib/practice-public'
import * as practiceServer from '@/lib/practice-server'

const groupA = (seatsLeft = 3) => ({
  id: 'group-1', name: 'Group A', status: 'open' as const, seats_left: seatsLeft,
  committee_seats_left: seatsLeft, faci_gm_seats_left: seatsLeft,
  performance_type: null, description: null, leaders: [],
  performance_video_url: null, song: null,
})

const openCatalog = {
  server_now: '2026-12-01T02:00:00.000Z',
  booking_opens_at: '2026-12-01T01:00:00.000Z',
  booking_open: true,
  groups: [groupA()],
}

vi.mock('@/lib/practice-server', () => ({
  getPracticeCatalog: vi.fn(),
}))

vi.mock('@/lib/practice-public', () => ({
  verifyPracticeMember: vi.fn(),
  bookPracticeGroup: vi.fn(),
  reservePracticeGroup: vi.fn(),
  releasePracticeHold: vi.fn(),
}))

const identity = {
  studentId: 'DSC2344112',
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText(/student id/i), { target: { value: identity.studentId } })
}

function beginVerification() {
  fireEvent.click(screen.getByRole('button', { name: /choose group a/i }))
}

describe('account-free practice booking', () => {
  beforeEach(() => {
    vi.mocked(publicPractice.verifyPracticeMember).mockReset()
    vi.mocked(publicPractice.bookPracticeGroup).mockReset()
    vi.mocked(publicPractice.reservePracticeGroup).mockReset()
    vi.mocked(publicPractice.reservePracticeGroup).mockResolvedValue({ data: { token: 'hold-token', expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null, status: 200 })
    vi.mocked(publicPractice.releasePracticeHold).mockReset()
    sessionStorage.clear()
    vi.mocked(practiceServer.getPracticeCatalog).mockReset()
    vi.mocked(practiceServer.getPracticeCatalog).mockResolvedValue({ data: openCatalog, error: null })
  })

  it('centers the public practice heading and showcase', async () => {
    render(await PracticePage())
    const headingContainer = screen.getByRole('heading', { name: /december 2026 performance practice/i }).parentElement
    expect(headingContainer?.style.margin).toBe('0px auto 28px')
    expect(headingContainer?.style.maxWidth).toBe('760px')
  })

  it('shows groups before verification and asks for identity only after a group is chosen', async () => {
    vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({
      data: { state: 'available', groups: [groupA()] },
      error: null,
      status: 200,
    })
    render(<PracticeClient initialCatalog={openCatalog} />)
    expect(screen.getByText('Group A')).toBeDefined()
    expect(screen.queryByLabelText(/student id/i)).toBeNull()
    beginVerification()
    expect(screen.queryByLabelText(/email/i)).toBeNull()
    fillIdentity()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
    expect(await screen.findByRole('heading', { name: /confirm your group/i })).toBeDefined()
  })

  it('shows the generic verification message without revealing roster membership', async () => {
    vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({
      data: null,
      error: 'Student ID could not be verified.',
      status: 400,
    })
    render(<PracticeClient initialCatalog={openCatalog} />)
    beginVerification()
    fillIdentity()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
    expect(screen.getByRole('alert').textContent).toContain('could not be verified')
  })

  it('requires confirmation, books once, and does not persist credentials', async () => {
    vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({
      data: { state: 'available', groups: [groupA()] },
      error: null,
      status: 200,
    })
    vi.mocked(publicPractice.bookPracticeGroup).mockResolvedValue({
      data: { id: 'booking-1', group_id: 'group-1', group_name: 'Group A', sessions: [] },
      error: null,
      status: 200,
    })
    render(<PracticeClient initialCatalog={openCatalog} />)
    beginVerification()
    fillIdentity()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
    expect(screen.getByRole('heading', { name: /confirm your group/i })).toBeDefined()
    expect(publicPractice.bookPracticeGroup).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^confirm booking$/i })))
    expect(await screen.findByText(/booking confirmed/i)).toBeDefined()
    expect(publicPractice.bookPracticeGroup).toHaveBeenCalledWith({ ...identity, groupId: 'group-1', holdToken: 'hold-token' })
    // The identity is kept in sessionStorage only while the 60s hold is live.
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it('refreshes choices when the selected group fills during confirmation', async () => {
    vi.mocked(publicPractice.verifyPracticeMember)
      .mockResolvedValueOnce({
        data: { state: 'available', groups: [groupA(1)] },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { state: 'available', groups: [groupA(0)] },
        error: null,
        status: 200,
      })
    vi.mocked(publicPractice.bookPracticeGroup).mockResolvedValue({
      data: null,
      error: 'That practice group is full.',
      status: 409,
    })
    render(<PracticeClient initialCatalog={{ ...openCatalog, groups: [groupA(1)] }} />)
    beginVerification()
    fillIdentity()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^confirm booking$/i })))
    expect(screen.getByRole('alert').textContent).toContain('full')
    expect(screen.getByText('0 Committee spaces')).toBeDefined()
    expect(screen.getByText('0 Faci/GM spaces')).toBeDefined()
    expect((screen.getByRole('button', { name: /full/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows an existing booking and sessions without mutation controls', async () => {
    vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({
      data: {
        state: 'booked',
        booking: {
          id: 'booking-1',
          group_id: 'group-1',
          group_name: 'Group A',
          sessions: [{
            id: 'session-1',
            starts_at: '2026-12-05T02:00:00.000Z',
            ends_at: '2026-12-05T03:00:00.000Z',
            location: 'D5-101',
          }],
        },
      },
      error: null,
      status: 200,
    })
    render(<PracticeClient initialCatalog={openCatalog} />)
    beginVerification()
    fillIdentity()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
    expect(await screen.findByRole('heading', { name: 'Group A' })).toBeDefined()
    expect(screen.getByText(/performance lead/i)).toBeDefined()
    expect(screen.queryByText('D5-101')).toBeNull()
    expect(screen.queryByRole('button', { name: /move|cancel|leave/i })).toBeNull()
  })

  it('prevents duplicate confirmation while the booking request is pending', async () => {
    vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({
      data: { state: 'available', groups: [groupA(1)] },
      error: null,
      status: 200,
    })
    let resolveBooking!: (value: Awaited<ReturnType<typeof publicPractice.bookPracticeGroup>>) => void
    vi.mocked(publicPractice.bookPracticeGroup).mockReturnValue(new Promise((resolve) => {
      resolveBooking = resolve
    }))
    render(<PracticeClient initialCatalog={{ ...openCatalog, groups: [groupA(1)] }} />)
    beginVerification()
    fillIdentity()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
    const confirm = screen.getByRole('button', { name: /^confirm booking$/i })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(publicPractice.bookPracticeGroup).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: /booking/i }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => resolveBooking({
      data: { id: 'booking-1', group_id: 'group-1', group_name: 'Group A', sessions: [] },
      error: null,
      status: 200,
    }))
    await waitFor(() => expect(screen.getByText(/booking confirmed/i)).toBeDefined())
  })
  describe('1-minute seat hold', () => {
    async function reachConfirm() {
      vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({
        data: { state: 'available', groups: [groupA()] },
        error: null,
        status: 200,
      })
      render(<PracticeClient initialCatalog={openCatalog} />)
      beginVerification()
      fillIdentity()
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
      expect(await screen.findByRole('heading', { name: /confirm your group/i })).toBeDefined()
    }

    it('reserves a seat when the confirm step opens and shows a countdown', async () => {
      await reachConfirm()
      expect(publicPractice.reservePracticeGroup).toHaveBeenCalledWith({ ...identity, groupId: 'group-1' })
      expect(screen.getByRole('timer').textContent).toMatch(/^\d:\d{2}$/)
    })

    it('returns to the performance list with a notice after 60 seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        await reachConfirm()
        await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
        expect(screen.queryByRole('heading', { name: /confirm your group/i })).toBeNull()
        expect(screen.getByText(/hold expired/i)).toBeDefined()
        expect(publicPractice.releasePracticeHold).toHaveBeenCalledWith('hold-token')
        expect(screen.getByText('Group A')).toBeDefined()
      } finally {
        vi.useRealTimers()
      }
    })

    it('releases the hold when the user goes back', async () => {
      await reachConfirm()
      fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
      expect(publicPractice.releasePracticeHold).toHaveBeenCalledWith('hold-token')
    })

    it('stays on the list when the seat cannot be held', async () => {
      vi.mocked(publicPractice.reservePracticeGroup).mockResolvedValue({ data: null, error: 'That practice group is full.', status: 409 })
      vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({
        data: { state: 'available', groups: [groupA()] }, error: null, status: 200,
      })
      render(<PracticeClient initialCatalog={openCatalog} />)
      beginVerification()
      fillIdentity()
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
      expect(await screen.findByText(/group is full/i)).toBeDefined()
      expect(screen.queryByRole('heading', { name: /confirm your group/i })).toBeNull()
    })
  })
})
