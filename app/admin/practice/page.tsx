import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { getAdminPracticeSnapshot } from '@/lib/practice-admin'
import { AdminPracticeDashboard } from './AdminPracticeDashboard'
import { ExportPracticeButton } from './ExportPracticeButton'
import { Users } from 'lucide-react'
import styles from './practice-admin.module.css'

export const metadata: Metadata = {
  title: 'Performance Practice Management',
  description: 'Manage December 2026 practice groups and sessions.',
}

export default async function AdminPracticePage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/head')
  const snapshot = await getAdminPracticeSnapshot()
  return (
    <main className={`scr ${styles.page}`}>
      <div className={styles.pageHeader}>
        <h1 style={{ margin: 0 }}>Performance Practice</h1>
        <div className={styles.buttonRow}>
          <Link className={`${styles.button} ${styles.primaryButton}`} href="/admin"><Users size={16} /> Committee roster</Link>
          <ExportPracticeButton hasGroups={snapshot.groups.length > 0} />
        </div>
      </div>
      <AdminPracticeDashboard snapshot={snapshot} />
    </main>
  )
}
