import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { getAdminPracticeSnapshot } from '@/lib/practice-admin'
import { AdminPracticeDashboard } from './AdminPracticeDashboard'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import styles from './practice-admin.module.css'

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
    <main className={`scr ${styles.page}`}>
      <Link className={styles.backLink} href="/admin"><ArrowLeft size={16} /> Committee management</Link>
      <header className={styles.hero}>
        <div className={styles.heroTop}>
          <div>
            <h1>Performance Practice</h1>
            <p>Prepare the committee roster, organise practice groups, and keep every session ready for December orientation.</p>
          </div>
          <span className={styles.intakeBadge}><CalendarDays size={14} /> December 2026</span>
        </div>
      </header>
      <AdminPracticeDashboard snapshot={snapshot} />
    </main>
  )
}
