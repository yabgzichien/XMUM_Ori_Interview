'use client'

import type { AdminPracticeSnapshot } from '@/lib/practice-types'
import { PracticeGroupManager } from './PracticeGroupManager'
import { PracticeReleaseManager } from './PracticeReleaseManager'
import styles from './practice-admin.module.css'

export function AdminPracticeDashboard({ snapshot }: { snapshot: AdminPracticeSnapshot }) {
  return (
    <div className={styles.workspace}>
      <PracticeReleaseManager opensAt={snapshot.booking_opens_at} />
      <PracticeGroupManager groups={snapshot.groups} roster={snapshot.roster} bookings={snapshot.bookings} sessions={snapshot.sessions} positions={snapshot.positions} />
    </div>
  )
}
