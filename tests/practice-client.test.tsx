import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PracticeClient } from '@/app/practice/PracticeClient'
import PracticePage from '@/app/practice/page'
import * as publicPractice from '@/lib/practice-public'
import * as practiceServer from '@/lib/practice-server'

const groupA = (seatsLeft = 3) => ({
  id: 'group-1', name: 'Group A', status: 'open' as const, seats_left: seatsLeft,
  performance_type: null, description: null, leader: null,
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
}))

const identity = {
  studentId: 'DSC2344112',
  email: 'dsc2344112@xmu.edu.my',
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText(/student id/i), { target: { value: identity.studentId } })
  fireEvent.change(screen.getByLabelText(/university email/i), { target: { value: identity.email } })
}

function beginVerification() {
  fireEvent.click(screen.getByRole('button', { name: /choose group a/i }))
}

describe('account-free practice booking', () => {
  beforeEach(() => {
    vi.mocked(publicPractice.verifyPracticeMember).mockReset()
    vi.mocked(publicPractice.bookPracticeGroup).mockReset()
    vi.mocked(practiceServer.getPracticeCatalog).mockReset()
    vi.mocked(practiceServer.getPracticeCatalog).mockResolvedValue({ data: openCatalog, error: null })
  })

  it('centers the public practice heading and showcase', async () => {
    render(await PracticePage())
    const headingContainer = screen.getByRole('heading', { name: /december 2026 performance practice/i }).parentElement
    expect(headingContainer?.style.margin).toBe('0px auto 28px')
    expect(headingContainer?.style.maxWidth).toBe('760px')
    expect(screen.getByText(/booking is open/i)).toBeDefined()
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
    fillIdentity()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
    expect(await screen.findByRole('heading', { name: /confirm your group/i })).toBeDefined()
  })

  it('shows the generic verification message without revealing roster membership', async () => {
    vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({
      data: null,
      error: 'Student ID or university email could not be verified.',
      status: 400,
    })
    render(<PracticeClient initialCatalog={openCatalog} />)
    beginVerification()
    fillIdentity()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /verify/i })))
    expect(screen.getByRole('alert').textContent).toContain('could not be verified')
  })

  it('requires confirmation, books once, and does not persist credentials', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
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
    expect(publicPractice.bookPracticeGroup).toHaveBeenCalledWith({ ...identity, groupId: 'group-1' })
    expect(storageSpy).not.toHaveBeenCalled()
    storageSpy.mockRestore()
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
    expect(screen.getByText('0 spaces remaining')).toBeDefined()
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
    expect(await screen.findByText('D5-101')).toBeDefined()
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
})
