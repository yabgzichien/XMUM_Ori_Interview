import { describe, expect, it } from 'vitest'
import { isProtectedPath } from '@/lib/supabase/middleware'

describe('practice route access', () => {
  it('does not require a login for /practice but still protects admin and interview pages', () => {
    expect(isProtectedPath('/practice')).toBe(false)
    expect(isProtectedPath('/practice/anything')).toBe(false)
    expect(isProtectedPath('/admin/practice')).toBe(true)
    expect(isProtectedPath('/head')).toBe(true)
  })
})
