// Pure helpers for the admin activity log. No Supabase imports are exercised
// here — listAuditLog is covered by tests/rpc/audit.test.ts.

import { describe, expect, it } from 'vitest'
import {
  actionLabel,
  actionStyle,
  actorBadge,
  auditTableLabel,
  diffRows,
  formatAbsolute,
  formatRelative,
  sanitizeSearch,
  type AuditEntry,
} from '@/lib/auditLog'

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    occurred_at: '2026-08-16T06:32:00.000Z',
    actor_type: 'user',
    actor_id: 'a1',
    actor_name: 'Alice Tan',
    actor_email: 'alice@x.my',
    actor_role: 'admin',
    actor_position: null,
    auth_role: 'authenticated',
    action: 'update',
    table_name: 'bookings',
    record_id: 'b1',
    summary: 'Cancelled booking for Jane Doe',
    changed_fields: ['status'],
    old_data: { status: 'booked' },
    new_data: { status: 'cancelled' },
    ...overrides,
  }
}

describe('sanitizeSearch', () => {
  it('strips the characters that would corrupt a PostgREST filter', () => {
    expect(sanitizeSearch('alice, bob (admin)')).toBe('alice bob admin')
    expect(sanitizeSearch(`o'brien "quoted"`)).toBe('o brien quoted')
  })

  it('strips ILIKE wildcards so a search cannot become a pattern', () => {
    expect(sanitizeSearch('100%_done\\')).toBe('100 done')
  })

  it('lowercases and collapses whitespace to match the stored search_text', () => {
    expect(sanitizeSearch('  Alice   TAN  ')).toBe('alice tan')
  })

  it('returns an empty string for input that is only punctuation', () => {
    expect(sanitizeSearch(',,,()')).toBe('')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-08-16T12:00:00.000Z')

  it('reports sub-minute ages as "just now"', () => {
    expect(formatRelative('2026-08-16T11:59:30.000Z', now)).toBe('just now')
  })

  it('reports minutes, hours and days', () => {
    expect(formatRelative('2026-08-16T11:55:00.000Z', now)).toBe('5 min ago')
    expect(formatRelative('2026-08-16T09:00:00.000Z', now)).toBe('3 h ago')
    expect(formatRelative('2026-08-15T09:00:00.000Z', now)).toBe('yesterday')
    expect(formatRelative('2026-08-14T09:00:00.000Z', now)).toBe('2 days ago')
  })

  it('falls back to an absolute date beyond a month', () => {
    expect(formatRelative('2026-05-16T09:00:00.000Z', now)).toBe(formatAbsolute('2026-05-16T09:00:00.000Z').split(',')[0])
  })
})

describe('actorBadge', () => {
  it('marks anonymous applicants as not signed in', () => {
    const badge = actorBadge(entry({ actor_type: 'public', actor_role: null, actor_name: 'Jane Doe' }))
    expect(badge.text).toBe('Not signed in')
    expect(badge.bg).toBe('#FEF3C7')
    expect(badge.fg).toBe('#B45309')
  })

  it('shows the account role for a signed-in actor', () => {
    expect(actorBadge(entry({ actor_role: 'head_facilitator' })).text).toBe('Head of Facilitators')
  })

  it('labels server and migration writes distinctly', () => {
    expect(actorBadge(entry({ actor_type: 'service' })).text).toBe('Server task')
    expect(actorBadge(entry({ actor_type: 'system' })).text).toBe('System')
  })

  it('falls back to the raw role when it has no label', () => {
    expect(actorBadge(entry({ actor_role: 'future_role' })).text).toBe('future_role')
  })
})

describe('actionLabel / actionStyle', () => {
  it('uses plain-English verbs', () => {
    expect(actionLabel('insert')).toBe('Created')
    expect(actionLabel('update')).toBe('Changed')
    expect(actionLabel('delete')).toBe('Deleted')
  })

  it('colours deletions in the danger palette', () => {
    expect(actionStyle('delete')).toEqual({ bg: '#FEE2E2', fg: '#B91C1C' })
  })
})

describe('auditTableLabel', () => {
  it('maps a table name to its screen label', () => {
    expect(auditTableLabel('practice_group_members')).toBe('Group members')
    expect(auditTableLabel('bookings')).toBe('Interview bookings')
  })

  it('falls back to the raw name for a table it does not know', () => {
    expect(auditTableLabel('some_new_table')).toBe('some_new_table')
  })
})

describe('diffRows', () => {
  it('returns only the changed fields for an update', () => {
    const rows = diffRows(entry({
      changed_fields: ['status'],
      old_data: { status: 'booked', applicant_name: 'Jane Doe' },
      new_data: { status: 'cancelled', applicant_name: 'Jane Doe' },
    }))
    expect(rows).toEqual([{ field: 'status', before: 'booked', after: 'cancelled' }])
  })

  it('shows only the new values for an insert', () => {
    const rows = diffRows(entry({
      action: 'insert',
      changed_fields: [],
      old_data: null,
      new_data: { applicant_name: 'Jane Doe', status: 'booked' },
    }))
    expect(rows).toEqual([
      { field: 'applicant_name', before: '—', after: 'Jane Doe' },
      { field: 'status', before: '—', after: 'booked' },
    ])
  })

  it('shows only the old values for a delete', () => {
    const rows = diffRows(entry({
      action: 'delete',
      changed_fields: [],
      old_data: { status: 'booked' },
      new_data: null,
    }))
    expect(rows).toEqual([{ field: 'status', before: 'booked', after: '—' }])
  })

  it('hides the surrogate key and creation timestamp', () => {
    const rows = diffRows(entry({
      action: 'insert',
      old_data: null,
      new_data: { id: 'b1', created_at: '2026-08-16T00:00:00Z', status: 'booked' },
    }))
    expect(rows.map((r) => r.field)).toEqual(['status'])
  })

  it('tolerates a missing old_data on an update', () => {
    const rows = diffRows(entry({ changed_fields: ['status'], old_data: null }))
    expect(rows).toEqual([{ field: 'status', before: '—', after: 'cancelled' }])
  })

  it('renders nulls and non-strings readably', () => {
    const rows = diffRows(entry({
      changed_fields: ['capacity', 'venue'],
      old_data: { capacity: 1, venue: null },
      new_data: { capacity: 2, venue: 'A2' },
    }))
    expect(rows).toEqual([
      { field: 'capacity', before: '1', after: '2' },
      { field: 'venue', before: '—', after: 'A2' },
    ])
  })
})
