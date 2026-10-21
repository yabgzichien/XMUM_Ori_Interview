import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PracticeClient } from '@/app/practice/PracticeClient'
import * as publicPractice from '@/lib/practice-public'

vi.mock('@/lib/practice-public', () => ({
  verifyPracticeMember: vi.fn(),
  bookPracticeGroup: vi.fn(),
}))

const previewCatalog = {
  server_now: '2026-11-30T00:00:00.000Z',
  booking_opens_at: '2026-12-01T00:00:00.000Z',
  booking_open: false,
  groups: [{
    id: 'group-1',
    name: 'Neon Pulse',
    status: 'open' as const,
    seats_left: 5,
    committee_seats_left: 2,
    faci_gm_seats_left: 3,
    performance_type: 'K-pop dance',
    description: 'A high-energy dance performance for the orientation finale.',
    leaders: [{ id: 'member-1', name: 'Alice Tan', position: 'Facilitator' }, { id: 'member-9', name: 'Ben Ong', position: 'Game Master' }],
    performance_video_url: 'https://youtu.be/dQw4w9WgXcQ',
    song: { type: 'mp3' as const, url: 'https://example.test/neon-pulse.mp3' },
  }],
}

describe('performance-practice preview mode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-30T00:00:00.000Z'))
    sessionStorage.setItem('xmumori-practice-identity', JSON.stringify({ studentId: 'DSC2344112' }))
    vi.mocked(publicPractice.verifyPracticeMember).mockResolvedValue({ data: null, error: 'Unavailable.', status: 500 })
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('shows optional performance information publicly before booking opens', () => {
    render(<PracticeClient initialCatalog={previewCatalog} />)

    expect(screen.getByRole('heading', { name: 'Neon Pulse' })).toBeDefined()
    expect(screen.getByText('K-pop dance')).toBeDefined()
    expect(screen.getByText(/high-energy dance performance/i)).toBeDefined()
    expect(screen.getByText(/Alice Tan/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /performance video/i }))
    fireEvent.click(screen.getByRole('button', { name: /song preview/i }))
    expect(screen.getByTitle(/performance video for Neon Pulse/i).getAttribute('src')).toContain('youtube.com/embed/dQw4w9WgXcQ')
    expect(screen.getByLabelText(/song audio for Neon Pulse/i)).toBeDefined()
    expect(screen.getByText('2 Committee spaces')).toBeDefined()
    expect(screen.getByText('3 Faci/GM spaces')).toBeDefined()
    expect(screen.queryByLabelText(/student id/i)).toBeNull()
    expect(screen.getByRole('button', { name: /available when booking opens/i })).toHaveProperty('disabled', true)
  })

  it('embeds Google Drive performance video and song links', () => {
    const drive = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=sharing`
    render(<PracticeClient initialCatalog={{
      ...previewCatalog,
      groups: [{
        ...previewCatalog.groups[0],
        performance_video_url: drive('1UcjDVjg8Q4Hz29CyYi8wxpOZBQ_H_paH'),
        song: { type: 'external' as const, url: drive('1JUKe1SfGhpOumeoMXolRzQNxtbZxFfzX') },
      }],
    }} />)

    fireEvent.click(screen.getByRole('button', { name: /performance video/i }))
    fireEvent.click(screen.getByRole('button', { name: /song preview/i }))
    expect(screen.getByTitle(/performance video for Neon Pulse/i).getAttribute('src'))
      .toBe('https://drive.google.com/file/d/1UcjDVjg8Q4Hz29CyYi8wxpOZBQ_H_paH/preview')
    expect(screen.getByTitle(/song for Neon Pulse/i).getAttribute('src'))
      .toBe('https://drive.google.com/file/d/1JUKe1SfGhpOumeoMXolRzQNxtbZxFfzX/preview')
  })

  it('counts down using server time and enables selection when the shared opening time arrives', () => {
    render(<PracticeClient initialCatalog={previewCatalog} />)

    expect(screen.getByText(/booking opens in/i)).toBeDefined()
    expect(screen.getByText(/1 day/i)).toBeDefined()

    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    })

    const choose = screen.getByRole('button', { name: /choose Neon Pulse/i })
    expect(choose).toHaveProperty('disabled', false)
    fireEvent.click(choose)
    expect(screen.queryByLabelText(/student id/i)).toBeNull()
    expect(publicPractice.verifyPracticeMember).toHaveBeenLastCalledWith({ studentId: 'DSC2344112' })
  })

  it('renders YouTube song sources as an embedded player', () => {
    render(<PracticeClient initialCatalog={{
      ...previewCatalog,
      groups: [{
        ...previewCatalog.groups[0],
        performance_video_url: null,
        song: { type: 'youtube', url: 'https://www.youtube.com/watch?v=5qap5aO4i9A' },
      }],
    }} />)

    fireEvent.click(screen.getByRole('button', { name: /song preview/i }))
    expect(screen.getByTitle(/song for Neon Pulse/i).getAttribute('src')).toContain('youtube.com/embed/5qap5aO4i9A')
  })
})
