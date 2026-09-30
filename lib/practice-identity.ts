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

export function matchesDerivedUniversityEmail(studentId: unknown, email: unknown): boolean {
  const normalizedId = normalizeStudentId(studentId)
  const normalizedEmail = normalizeUniversityEmail(email)
  if (!normalizedId || !normalizedEmail) return false
  return normalizedEmail === `${normalizedId.toLowerCase()}@xmu.edu.my`
}
