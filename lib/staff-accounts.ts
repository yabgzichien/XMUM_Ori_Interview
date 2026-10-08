// The only logins this app accepts. Created by scripts/seed.mjs.
// Roster membership never creates or grants one of these accounts.
export const STAFF_LOGIN_EMAILS = [
  'admin@xmum.local',
  'head.facilitator@xmum.local',
  'head.gm@xmum.local',
] as const

export function isStaffLoginEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  return (STAFF_LOGIN_EMAILS as readonly string[]).includes(normalized)
}
