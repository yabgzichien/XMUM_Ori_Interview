import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { getAdminPracticeSnapshot } from '@/lib/practice-admin'
import { AdminPracticeDashboard } from './AdminPracticeDashboard'
import { ExportPracticeButton } from './ExportPracticeButton'
import { ArrowLeft } from 'lucide-react'
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
        <div>
          <Link className={styles.backLink} href="/admin"><ArrowLeft size={16} /> Committee roster</Link>
          <h1 style={{ margin: '8px 0 0' }}>Performance Practice</h1>
        </div>
        <ExportPracticeButton hasGroups={snapshot.groups.length > 0} />
      </div>
      <AdminPracticeDashboard snapshot={snapshot} />
    </main>
  )
}
