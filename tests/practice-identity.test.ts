import { describe, expect, it } from 'vitest'
import {
  derivedUniversityEmail,
  matchesDerivedUniversityEmail,
  normalizeStudentId,
  normalizeUniversityEmail,
} from '@/lib/practice-identity'

describe('practice identity normalization', () => {
  it('normalizes surrounding whitespace and ASCII letter case', () => {
    expect(normalizeStudentId(' dsc2344112 ')).toBe('DSC2344112')
    expect(normalizeUniversityEmail(' DSC2344112@XMU.EDU.MY ')).toBe('dsc2344112@xmu.edu.my')
  })

  it('rejects blank, non-string, internal-whitespace, and Unicode-lookalike IDs', () => {
    expect(normalizeStudentId('')).toBeNull()
    expect(normalizeStudentId(null)).toBeNull()
    expect(normalizeStudentId('DSC 2344112')).toBeNull()
    expect(normalizeStudentId('ＤＳＣ2344112')).toBeNull()
  })

  it('derives the campus email from a valid student ID', () => {
    expect(derivedUniversityEmail(' dsc2344112 ')).toBe('dsc2344112@xmu.edu.my')
    expect(derivedUniversityEmail('DSC 2344112')).toBeNull()
    expect(derivedUniversityEmail(null)).toBeNull()
  })

  it('accepts only the exact case-insensitive email derived from the ID', () => {
    expect(matchesDerivedUniversityEmail('DSC2344112', 'dsc2344112@XMU.EDU.MY')).toBe(true)
    expect(matchesDerivedUniversityEmail('DSC2344112', 'dsc2344112+tag@xmu.edu.my')).toBe(false)
    expect(matchesDerivedUniversityEmail('DSC2344112', 'dsc2344112@sub.xmu.edu.my')).toBe(false)
    expect(matchesDerivedUniversityEmail('DSC2344112', 'someoneelse@xmu.edu.my')).toBe(false)
  })

  it('rejects malformed email inputs before comparison', () => {
    expect(normalizeUniversityEmail('not-an-email')).toBeNull()
    expect(normalizeUniversityEmail('student@gmail.com')).toBe('student@gmail.com')
    expect(normalizeUniversityEmail(undefined)).toBeNull()
    expect(matchesDerivedUniversityEmail('DSC2344112', null)).toBe(false)
  })
})
