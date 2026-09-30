'use client'

import type { MyGroup } from '@/lib/practice'

/**
 * Temporary compatibility surface for the legacy /head/practice dashboard.
 * Task 7 removes that dashboard and this component together.
 */
export function MyGroupPanel({ myGroup }: {
  myGroup: MyGroup
  currentUserId: string
  onGroupChanged: () => void
}) {
  return (
    <div style={{ padding: '16px', color: 'var(--text-muted, #64748B)' }}>
      Legacy group management for {myGroup.name} is unavailable during the admin-practice migration.
    </div>
  )
}
