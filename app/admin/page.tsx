import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { getAdminPracticeSnapshot } from '@/lib/practice-admin'
import { CommitteeDashboard } from './CommitteeDashboard'
import styles from './practice/practice-admin.module.css'

export const metadata: Metadata = {
  title: 'Committee',
  description: 'Manage the December 2026 committee roster.',
}

export default async function AdminPage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login')
  }
  if (profile.role !== 'admin') {
    redirect('/head')
  }

  const snapshot = await getAdminPracticeSnapshot()

  return (
    <main className={`scr ${styles.page}`}>
      <h1 style={{ margin: '0 0 20px' }}>Committee</h1>
      <CommitteeDashboard roster={snapshot.roster} positions={snapshot.positions} />
    </main>
  )
}
