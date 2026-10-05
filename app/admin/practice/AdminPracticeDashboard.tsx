'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import type { AdminPracticeSnapshot } from '@/lib/practice-types'
import { PracticeGroupManager } from './PracticeGroupManager'
import { RosterImportPanel } from './RosterImportPanel'
import { RosterManager } from './RosterManager'
import { PracticeReleaseManager } from './PracticeReleaseManager'
import { Layers3, Upload, UsersRound } from 'lucide-react'
import styles from './practice-admin.module.css'

type Tab = 'roster' | 'import' | 'groups'

export function AdminPracticeDashboard({ snapshot }: { snapshot: AdminPracticeSnapshot }) {
  const [tab, setTab] = useState<Tab>('roster')
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    roster: null,
    import: null,
    groups: null,
  })
  const activeMembers = snapshot.roster.filter((member) => member.active).length
  const bookedMembers = snapshot.bookings.length
  const openGroups = snapshot.groups.filter((group) => group.status === 'open')
  const remainingSpaces = openGroups.reduce(
    (total, group) => total + Math.max(group.capacity - group.booking_count, 0),
    0,
  )

  const tabs: Array<{ id: Tab; label: string; count?: number; icon: typeof UsersRound }> = [
    { id: 'roster', label: 'Roster', count: snapshot.roster.length, icon: UsersRound },
    { id: 'import', label: 'Import roster', icon: Upload },
    { id: 'groups', label: 'Groups', count: snapshot.groups.length, icon: Layers3 },
  ]

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: Tab) {
    const currentIndex = tabs.findIndex(({ id }) => id === currentTab)
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = tabs[nextIndex].id
    setTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  return (
    <div className={styles.workspace}>
      <div className={styles.summaryGrid} aria-label="Practice overview">
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{snapshot.roster.length}</div>
          <div className={styles.summaryLabel}>Roster members</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{activeMembers}<span>active</span></div>
          <div className={styles.summaryLabel}>{bookedMembers} booked</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{openGroups.length}<span>open</span></div>
          <div className={styles.summaryLabel}>{snapshot.groups.length} total groups</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{remainingSpaces}</div>
          <div className={styles.summaryLabel}>{remainingSpaces === 1 ? '1 remaining space' : `${remainingSpaces} remaining spaces`}</div>
        </div>
      </div>

      <PracticeReleaseManager opensAt={snapshot.booking_opens_at} />

      <nav className={styles.tabs} aria-label="Practice management sections" role="tablist">
        {tabs.map(({ id, label, count, icon: Icon }) => (
          <button
            className={styles.tab}
            type="button"
            role="tab"
            id={`${id}-tab`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            key={id}
            onClick={() => setTab(id)}
            onKeyDown={(event) => handleTabKeyDown(event, id)}
            ref={(node) => {
              tabRefs.current[id] = node
            }}
          >
            <Icon size={16} /> {label}
            {count !== undefined && <span className={styles.tabCount}>{count}</span>}
          </button>
        ))}
      </nav>
      <div className={styles.panel} role="tabpanel" id={`${tab}-panel`} aria-labelledby={`${tab}-tab`} tabIndex={0}>
        {tab === 'roster' && <RosterManager roster={snapshot.roster} positions={snapshot.positions} />}
        {tab === 'import' && <RosterImportPanel />}
        {tab === 'groups' && <PracticeGroupManager groups={snapshot.groups} roster={snapshot.roster} bookings={snapshot.bookings} sessions={snapshot.sessions} />}
      </div>
    </div>
  )
}
