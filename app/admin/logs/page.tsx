import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { AuditLogClient } from '@/app/admin/logs/AuditLogClient'
import { createClient } from '@/lib/supabase/server'
import { COLUMNS, AUDIT_PAGE_SIZE, type AuditEntry } from '@/lib/auditLog'

export default async function AdminLogsPage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login')
  }
  if (profile.role !== 'admin') {
    redirect('/head')
  }

  // Pre-fetch initial page of audit logs on server
  const supabase = await createClient()
  const { data } = await supabase
    .from('audit_log')
    .select(COLUMNS)
    .order('id', { ascending: false })
    .range(0, AUDIT_PAGE_SIZE - 1)

  const initialEntries = (data as AuditEntry[] | null) ?? []
  const initialHasMore = initialEntries.length === AUDIT_PAGE_SIZE

  return (
    <main className="scr" style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '32px 24px 48px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px', color: 'var(--text-primary, #0F172A)' }}>Activity Log</h1>
          <p style={{ color: 'var(--text-muted, #64748B)', fontSize: '14.5px', margin: 0, maxWidth: '760px' }}>
            Every change made to the database — who made it, what changed, and when. This record is
            append-only: it cannot be edited or deleted from anywhere in the app.
          </p>
        </div>
        <Link
          href="/admin"
          style={{ padding: '9px 14px', borderRadius: '10px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #1E293B)', fontWeight: 600, fontSize: '14px', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          ← Committee
        </Link>
      </div>

      <AuditLogClient
        initialEntries={initialEntries}
        initialHasMore={initialHasMore}
      />
    </main>
  )
}
