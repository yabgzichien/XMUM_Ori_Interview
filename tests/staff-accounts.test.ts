import { describe, expect, it } from 'vitest'
import { isStaffLoginEmail } from '@/lib/staff-accounts'

describe('staff login allowlist', () => {
  it('accepts only the three seed accounts', () => {
    expect(isStaffLoginEmail('admin@xmum.local')).toBe(true)
    expect(isStaffLoginEmail(' Head.Facilitator@xmum.local ')).toBe(true)
    expect(isStaffLoginEmail('head.gm@xmum.local')).toBe(true)
  })

  it('rejects every other address', () => {
    expect(isStaffLoginEmail('fyanyan2004@gmail.com')).toBe(false)
    expect(isStaffLoginEmail('committee1.facilitator@xmum.local')).toBe(false)
    expect(isStaffLoginEmail('')).toBe(false)
    expect(isStaffLoginEmail(null)).toBe(false)
  })
})
