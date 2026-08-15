import { describe, expect, it } from 'vitest'
import {
  canModifyBooking,
  formatDateHeading,
  formatTimeRange,
  groupSlotsByDate,
  isBookable,
  type AvailableSlot,
} from '@/lib/booking-helpers'

function makeSlot(overrides: Partial<AvailableSlot> = {}): AvailableSlot {
  return {
    id: 'slot-1',
    track: 'facilitator',
    orientation: 'december',
    starts_at: '2026-06-15T18:30:00+08:00',
    ends_at: '2026-06-15T18:45:00+08:00',
    capacity: 2,
    booked_count: 0,
    seats_left: 2,
    ...overrides,
  }
}

describe('groupSlotsByDate', () => {
  it('groups slots across multiple dates, sorted by date then time', () => {
    const slots: AvailableSlot[] = [
      makeSlot({ id: 'a', starts_at: '2026-06-16T10:00:00+08:00' }),
      makeSlot({ id: 'b', starts_at: '2026-06-15T09:00:00+08:00' }),
      makeSlot({ id: 'c', starts_at: '2026-06-15T18:00:00+08:00' }),
      makeSlot({ id: 'd', starts_at: '2026-06-16T08:00:00+08:00' }),
    ]

    const groups = groupSlotsByDate(slots)

    expect(groups).toHaveLength(2)
    expect(groups[0].date).toBe('2026-06-15')
    expect(groups[0].slots.map((s) => s.id)).toEqual(['b', 'c'])
    expect(groups[1].date).toBe('2026-06-16')
    expect(groups[1].slots.map((s) => s.id)).toEqual(['d', 'a'])
  })

  it('returns an empty array for no slots', () => {
    expect(groupSlotsByDate([])).toEqual([])
  })

  it('groups a single slot into a single group', () => {
    const slots = [makeSlot()]
    const groups = groupSlotsByDate(slots)
    expect(groups).toHaveLength(1)
    expect(groups[0].slots).toHaveLength(1)
  })
})

describe('isBookable', () => {
  const now = new Date('2026-06-01T00:00:00+08:00')

  it('is true when seats are left and the slot is in the future', () => {
    const slot = makeSlot({ seats_left: 1, starts_at: '2026-06-15T18:30:00+08:00' })
    expect(isBookable(slot, now)).toBe(true)
  })

  it('is false when the slot is full', () => {
    const slot = makeSlot({ seats_left: 0, starts_at: '2026-06-15T18:30:00+08:00' })
    expect(isBookable(slot, now)).toBe(false)
  })

  it('is false when the slot is in the past', () => {
    const slot = makeSlot({ seats_left: 1, starts_at: '2026-05-01T18:30:00+08:00' })
    expect(isBookable(slot, now)).toBe(false)
  })

  it('is false when both full and in the past', () => {
    const slot = makeSlot({ seats_left: 0, starts_at: '2026-05-01T18:30:00+08:00' })
    expect(isBookable(slot, now)).toBe(false)
  })
})

describe('canModifyBooking', () => {
  const startsAt = '2026-06-15T18:00:00+08:00' // 6 PM
  const cutoffHours = 2

  it('is true well before the cutoff', () => {
    const now = new Date('2026-06-15T10:00:00+08:00')
    expect(canModifyBooking(startsAt, cutoffHours, now)).toBe(true)
  })

  it('is true just before the cutoff boundary', () => {
    const now = new Date('2026-06-15T15:59:00+08:00') // cutoff is 16:00
    expect(canModifyBooking(startsAt, cutoffHours, now)).toBe(true)
  })

  it('is false exactly at the cutoff boundary', () => {
    const now = new Date('2026-06-15T16:00:00+08:00')
    expect(canModifyBooking(startsAt, cutoffHours, now)).toBe(false)
  })

  it('is false after the cutoff', () => {
    const now = new Date('2026-06-15T17:00:00+08:00')
    expect(canModifyBooking(startsAt, cutoffHours, now)).toBe(false)
  })

  it('is false after the slot has already started', () => {
    const now = new Date('2026-06-15T19:00:00+08:00')
    expect(canModifyBooking(startsAt, cutoffHours, now)).toBe(false)
  })
})

describe('formatTimeRange', () => {
  it('formats a start/end pair as a 12-hour range', () => {
    const result = formatTimeRange('2026-06-15T18:30:00+08:00', '2026-06-15T18:45:00+08:00')
    expect(result).toBe('6:30 PM – 6:45 PM')
  })

  it('formats an AM start correctly', () => {
    const result = formatTimeRange('2026-06-15T09:00:00+08:00', '2026-06-15T09:15:00+08:00')
    expect(result).toBe('9:00 AM – 9:15 AM')
  })
})

describe('formatDateHeading', () => {
  it('formats an ISO date as a short weekday/day/month/year string', () => {
    expect(formatDateHeading('2026-06-15')).toBe('Mon, 15 Jun 2026')
  })

  it('formats a different date correctly', () => {
    expect(formatDateHeading('2026-01-01')).toBe('Thu, 1 Jan 2026')
  })
})
