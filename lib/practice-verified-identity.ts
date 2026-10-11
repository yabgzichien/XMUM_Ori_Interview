import type { PracticeMemberSummary } from '@/lib/practice-types'

// The verified student ID lives in sessionStorage so it is scoped to one tab and
// disappears when the tab closes. The server re-checks it on every request.
const IDENTITY_STORAGE_KEY = 'xmumori-practice-identity'

export type VerifiedIdentity = {
  studentId: string
  member?: PracticeMemberSummary
}

export function readVerifiedIdentity(): VerifiedIdentity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as VerifiedIdentity
    if (typeof saved?.studentId !== 'string' || !saved.studentId) return null
    return saved.member ? { studentId: saved.studentId, member: saved.member } : { studentId: saved.studentId }
  } catch {
    return null
  }
}

export function saveVerifiedIdentity(identity: VerifiedIdentity) {
  try { sessionStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity)) } catch { /* storage unavailable */ }
}

export function clearVerifiedIdentity() {
  try { sessionStorage.removeItem(IDENTITY_STORAGE_KEY) } catch { /* storage unavailable */ }
}
