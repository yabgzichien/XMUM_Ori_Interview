import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { getAdminPracticeSnapshot } from '@/lib/practice-admin'
import { AdminPracticeDashboard } from './AdminPracticeDashboard'

export const metadata: Metadata = {
  title: 'Performance Practice Management',
  description: 'Manage the December 2026 committee roster, practice groups, and sessions.',
}

export default async function AdminPracticePage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/head')
  const snapshot = await getAdminPracticeSnapshot()
  return (
    <main className="scr" style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '32px 24px 48px', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/admin">← Committee management</Link>
        <h1 style={{ marginBottom: '6px' }}>Performance Practice</h1>
        <p style={{ margin: 0, color: 'var(--text-muted, #64748b)' }}>December 2026 · Manage eligible committee members, groups, bookings, and schedules.</p>
      </div>
      <AdminPracticeDashboard snapshot={snapshot} />
    </main>
  )
}
