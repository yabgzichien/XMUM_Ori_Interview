'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { RosterManager } from './practice/RosterManager'
import { TitleManager } from './TitleManager'
import type { AdminRosterMember } from '@/lib/practice-types'
import { isAssignableRosterPosition } from '@/lib/practice'
import { Tags, UsersRound } from 'lucide-react'
import styles from './practice/practice-admin.module.css'

type Tab = 'roster' | 'titles'
type Position = { value: string; label: string }

export function CommitteeDashboard({
  roster,
  positions,
}: {
  roster: AdminRosterMember[]
  positions: Position[]
}) {
  const assignablePositions = positions.filter((position) => isAssignableRosterPosition(position.value))
  const [tab, setTab] = useState<Tab>('roster')
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    roster: null,
    titles: null,
  })
  const facilitatorCount = roster.filter((member) => member.position === 'facilitator').length
  const gameMasterCount = roster.filter((member) => member.position === 'game_master').length
  const committeeCount = roster.length - facilitatorCount - gameMasterCount

  const tabs: Array<{ id: Tab; label: string; count?: number; icon: typeof UsersRound }> = [
    { id: 'roster', label: 'Roster', count: roster.length, icon: UsersRound },
    { id: 'titles', label: 'Titles', count: assignablePositions.length, icon: Tags },
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
      <div className={styles.summaryGrid} aria-label="Committee overview">
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{committeeCount}</div>
          <div className={styles.summaryLabel}>Committee (excl. Faci &amp; GM)</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{gameMasterCount}</div>
          <div className={styles.summaryLabel}>Game Master</div>
        </div>
        <div className={styles.summaryItem}>
          <div className={styles.summaryValue}>{facilitatorCount}</div>
          <div className={styles.summaryLabel}>Facilitator</div>
        </div>
      </div>

      <nav className={styles.tabs} aria-label="Committee management sections" role="tablist">
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
        {tab === 'roster' && <RosterManager roster={roster} positions={assignablePositions} />}
        {tab === 'titles' && <TitleManager positions={assignablePositions} />}
      </div>
    </div>
  )
}
