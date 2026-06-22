import { describe, expect, it } from 'vitest'
import { generateSlotTimes } from '@/lib/slot-generation'

describe('generateSlotTimes', () => {
  it('produces 15 consecutive 15-minute slots for 18:30-22:15', () => {
    const slots = generateSlotTimes({
      date: '2026-06-15',
      startTime: '18:30',
      endTime: '22:15',
      intervalMinutes: 15,
    })

    expect(slots).toHaveLength(15)
  })

  it('first slot starts at 18:30 and ends at 18:45', () => {
    const slots = generateSlotTimes({
      date: '2026-06-15',
      startTime: '18:30',
      endTime: '22:15',
      intervalMinutes: 15,
    })

    const first = slots[0]
    expect(new Date(first.starts_at)).toEqual(new Date(2026, 5, 15, 18, 30))
    expect(new Date(first.ends_at)).toEqual(new Date(2026, 5, 15, 18, 45))
  })

  it('last slot starts at 22:00 and ends at 22:15', () => {
    const slots = generateSlotTimes({
      date: '2026-06-15',
      startTime: '18:30',
      endTime: '22:15',
      intervalMinutes: 15,
    })

    const last = slots[slots.length - 1]
    expect(new Date(last.starts_at)).toEqual(new Date(2026, 5, 15, 22, 0))
    expect(new Date(last.ends_at)).toEqual(new Date(2026, 5, 15, 22, 15))
  })

  it('returns an empty array when the range is shorter than one interval', () => {
    const slots = generateSlotTimes({
      date: '2026-06-15',
      startTime: '09:00',
      endTime: '09:10',
      intervalMinutes: 15,
    })

    expect(slots).toEqual([])
  })

  it('throws when intervalMinutes is not greater than 0', () => {
    expect(() =>
      generateSlotTimes({
        date: '2026-06-15',
        startTime: '09:00',
        endTime: '10:00',
        intervalMinutes: 0,
      }),
    ).toThrow()

    expect(() =>
      generateSlotTimes({
        date: '2026-06-15',
        startTime: '09:00',
        endTime: '10:00',
        intervalMinutes: -15,
      }),
    ).toThrow()
  })

  it('throws when endTime is not after startTime', () => {
    expect(() =>
      generateSlotTimes({
        date: '2026-06-15',
        startTime: '10:00',
        endTime: '09:00',
        intervalMinutes: 15,
      }),
    ).toThrow()

    expect(() =>
      generateSlotTimes({
        date: '2026-06-15',
        startTime: '10:00',
        endTime: '10:00',
        intervalMinutes: 15,
      }),
    ).toThrow()
  })
})
