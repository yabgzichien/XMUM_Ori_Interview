// Data-access and display helpers for the admin activity log. Browser client
// (anon key + session); RLS restricts every read to admins, and the table has
// no write path at all — see supabase/migrations/0029_audit_log.sql. The client
// is constructed at call time (never at module load) so this file is safe to
// import even when env vars are unset at build time.

import { createClient } from '@/lib/supabase/client'

export type AuditAction = 'insert' | 'update' | 'delete'
export type AuditActorType = 'user' | 'public' | 'service' | 'system'

export type AuditEntry = {
  id: number
  occurred_at: string
  actor_type: AuditActorType
  actor_id: string | null
  actor_name: string
  actor_email: string | null
  actor_role: string | null
  actor_position: string | null
  auth_role: string | null
  action: AuditAction
  table_name: string
  record_id: string | null
  summary: string
  changed_fields: string[]
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

export type AuditQuery = {
  search?: string
  action?: AuditAction | 'all'
  table?: string | 'all'
  from?: string | null
  to?: string | null
  limit?: number
  offset?: number
}

export const AUDIT_PAGE_SIZE = 50

// search_text is filtered on but never selected — it duplicates the visible
// fields.
const COLUMNS =
  'id, occurred_at, actor_type, actor_id, actor_name, actor_email, actor_role, ' +
  'actor_position, auth_role, action, table_name, record_id, summary, ' +
  'changed_fields, old_data, new_data'

/**
 * PostgREST's filter grammar is comma-separated and supabase-js does not quote
 * the ILIKE value, so `,` `(` `)` `"` `'` in a raw search string corrupt the
 * query; `%` `_` `\` are ILIKE wildcards. This is a name/action search box, not
 * a pattern engine — strip them all.
 */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_\\,()"']/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * One page of the audit log, newest first. `hasMore` is inferred from the page
 * being full rather than an exact count — counting would mean a second scan per
 * page, and the UI pages with "Load more".
 */
export async function listAuditLog(q: AuditQuery = {}) {
  const supabase = createClient()
  const limit = q.limit ?? AUDIT_PAGE_SIZE
  const offset = q.offset ?? 0

  let query = supabase
    .from('audit_log')
    .select(COLUMNS)
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)

  const search = sanitizeSearch(q.search ?? '')
  if (search) query = query.ilike('search_text', `%${search}%`)
  if (q.action && q.action !== 'all') query = query.eq('action', q.action)
  if (q.table && q.table !== 'all') query = query.eq('table_name', q.table)
  if (q.from) query = query.gte('occurred_at', q.from)
  if (q.to) query = query.lte('occurred_at', q.to)

  const { data, error } = await query
  const rows = (data as AuditEntry[] | null) ?? null
  return { data: rows, hasMore: (rows?.length ?? 0) === limit, error }
}

// ---------- Display helpers (pure — unit-tested in tests/audit-log.test.ts) ----------

export const AUDIT_TABLES: { value: string; label: string; icon: string }[] = [
  { value: 'bookings', label: 'Interview bookings', icon: '📋' },
  { value: 'slots', label: 'Interview slots', icon: '🗓️' },
  { value: 'profiles', label: 'Accounts', icon: '👤' },
  { value: 'staff_invites', label: 'Invites', icon: '🔑' },
  { value: 'practice_groups', label: 'Practice groups', icon: '🎭' },
  { value: 'practice_group_members', label: 'Group members', icon: '👥' },
  { value: 'practice_sessions', label: 'Practice sessions', icon: '⏰' },
  { value: 'track_settings', label: 'Booking windows', icon: '⚙️' },
  { value: 'committee_positions', label: 'Committee titles', icon: '🏷️' },
]

export function auditTableLabel(table: string): string {
  return AUDIT_TABLES.find((t) => t.value === table)?.label ?? table
}

export function actionLabel(action: AuditAction): string {
  return action === 'insert' ? 'Created' : action === 'delete' ? 'Deleted' : 'Changed'
}

/** Pill colours per action, matching the palette used across the admin screens. */
export function actionStyle(action: AuditAction): { bg: string; fg: string } {
  if (action === 'insert') return { bg: '#ECFDF3', fg: '#15803D' }
  if (action === 'delete') return { bg: '#FEE2E2', fg: '#B91C1C' }
  return { bg: '#EFF4FF', fg: '#2563EB' }
}

const roleLabels: Record<string, string> = {
  applicant: 'Applicant',
  head_facilitator: 'Head of Facilitators',
  head_gm: 'Head of Game Masters',
  admin: 'Admin',
  committee: 'Committee Member',
  performance_lead: 'Performance Lead',
}

/**
 * How the actor is badged. Anonymous applicants are named but clearly marked as
 * unauthenticated, so a public booking is never mistaken for a staff action.
 */
export function actorBadge(entry: AuditEntry): { text: string; bg: string; fg: string } {
  if (entry.actor_type === 'public') {
    return { text: 'Not signed in', bg: '#FEF3C7', fg: '#B45309' }
  }
  if (entry.actor_type === 'service') {
    return { text: 'Server task', bg: '#F1F5F9', fg: '#64748B' }
  }
  if (entry.actor_type === 'system') {
    return { text: 'System', bg: '#F1F5F9', fg: '#64748B' }
  }
  const text = entry.actor_role ? roleLabels[entry.actor_role] ?? entry.actor_role : 'Account'
  return { text, bg: '#EFF4FF', fg: '#2563EB' }
}

/** e.g. "just now", "5 min ago", "3 h ago", "2 days ago", "16 Aug 2026". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  const seconds = Math.round((now.getTime() - then) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return formatAbsolute(iso).split(',')[0]
}

/** e.g. "16 Aug 2026, 14:32". */
export function formatAbsolute(iso: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`
}

export type AuditDiffRow = { field: string; before: string; after: string }

const HIDDEN_DIFF_FIELDS = new Set(['id', 'created_at'])

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Field-level before/after for the expanded row. Updates show only the fields
 * that actually changed; inserts show the new values, deletes the old ones.
 */
export function diffRows(entry: AuditEntry): AuditDiffRow[] {
  if (entry.action === 'update') {
    return entry.changed_fields
      .filter((field) => !HIDDEN_DIFF_FIELDS.has(field))
      .map((field) => ({
        field,
        before: renderValue(entry.old_data?.[field]),
        after: renderValue(entry.new_data?.[field]),
      }))
  }

  const data = entry.action === 'insert' ? entry.new_data : entry.old_data
  if (!data) return []
  return Object.keys(data)
    .filter((field) => !HIDDEN_DIFF_FIELDS.has(field))
    .sort()
    .map((field) => ({
      field,
      before: entry.action === 'delete' ? renderValue(data[field]) : '—',
      after: entry.action === 'insert' ? renderValue(data[field]) : '—',
    }))
}
