const STUDENT_ID_PATTERN = /^[A-Z0-9_-]+$/

export function normalizeStudentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized && STUDENT_ID_PATTERN.test(normalized) ? normalized : null
}

export function normalizeUniversityEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized || !/^[^\s@]+@[^\s@]+$/.test(normalized)) return null
  return normalized
}

export function derivedUniversityEmail(studentId: unknown): string | null {
  const normalizedId = normalizeStudentId(studentId)
  if (!normalizedId) return null
  return `${normalizedId.toLowerCase()}@xmu.edu.my`
}

export function matchesDerivedUniversityEmail(studentId: unknown, email: unknown): boolean {
  const derived = derivedUniversityEmail(studentId)
  const normalizedEmail = normalizeUniversityEmail(email)
  if (!derived || !normalizedEmail) return false
  return normalizedEmail === derived
}
