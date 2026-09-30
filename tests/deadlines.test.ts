import { describe, it, expect } from 'vitest'
import { isTrackClosed, TRACK_DEADLINES } from '@/lib/deadlines'

describe('deadlines helper', () => {
  it('has valid ISO deadlines configured for both tracks', () => {
    expect(TRACK_DEADLINES.game_master.label).toBe('12:00 PM')
    expect(TRACK_DEADLINES.facilitator.label).toBe('6:00 PM')
    expect(new Date(TRACK_DEADLINES.game_master.closeAt).getTime()).toBeGreaterThan(0)
    expect(new Date(TRACK_DEADLINES.facilitator.closeAt).getTime()).toBeGreaterThan(0)
  })

  it('correctly detects open vs closed status across timelines', () => {
    // 09:30 AM today (before both deadlines)
    const morningTime = new Date('2026-09-30T09:30:00+08:00').getTime()
    expect(isTrackClosed('game_master', morningTime)).toBe(false)
    expect(isTrackClosed('facilitator', morningTime)).toBe(false)

    // 12:00:00 PM today (GM closes exactly now)
    const noonExact = new Date('2026-09-30T12:00:00+08:00').getTime()
    expect(isTrackClosed('game_master', noonExact)).toBe(true)
    expect(isTrackClosed('facilitator', noonExact)).toBe(false)

    // 01:00 PM today (GM closed, Facilitator still open)
    const afternoonTime = new Date('2026-09-30T13:00:00+08:00').getTime()
    expect(isTrackClosed('game_master', afternoonTime)).toBe(true)
    expect(isTrackClosed('facilitator', afternoonTime)).toBe(false)

    // 06:00:00 PM today (Facilitator closes)
    const eveningExact = new Date('2026-09-30T18:00:00+08:00').getTime()
    expect(isTrackClosed('game_master', eveningExact)).toBe(true)
    expect(isTrackClosed('facilitator', eveningExact)).toBe(true)

    // 08:00 PM today (both closed)
    const nightTime = new Date('2026-09-30T20:00:00+08:00').getTime()
    expect(isTrackClosed('game_master', nightTime)).toBe(true)
    expect(isTrackClosed('facilitator', nightTime)).toBe(true)
  })
})
