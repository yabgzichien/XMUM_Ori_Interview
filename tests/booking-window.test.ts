import { describe, it, expect } from 'vitest'
import { isWindowClosed } from '@/lib/booking-window'

const at = (iso: string) => new Date(iso).getTime()

describe('isWindowClosed', () => {
  it('treats a missing settings row as closed', () => {
    expect(isWindowClosed(null, at('2026-11-01T10:00:00+08:00'))).toBe(true)
  })

  it('treats null bounds as unbounded', () => {
    expect(isWindowClosed({ window_open: null, window_close: null }, at('2026-11-01T10:00:00+08:00'))).toBe(false)
  })

  it('is closed before window_open and after window_close', () => {
    const window = { window_open: '2026-11-01T09:00:00+08:00', window_close: '2026-11-01T18:00:00+08:00' }
    expect(isWindowClosed(window, at('2026-11-01T08:59:00+08:00'))).toBe(true)
    expect(isWindowClosed(window, at('2026-11-01T09:00:00+08:00'))).toBe(false)
    expect(isWindowClosed(window, at('2026-11-01T18:00:00+08:00'))).toBe(false)
    expect(isWindowClosed(window, at('2026-11-01T18:00:01+08:00'))).toBe(true)
  })
})
