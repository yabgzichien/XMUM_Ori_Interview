'use client'

import { useState } from 'react'
import type { AdminPracticeSnapshot } from '@/lib/practice-types'
import { PracticeGroupManager } from './PracticeGroupManager'
import { RosterImportPanel } from './RosterImportPanel'
import { RosterManager } from './RosterManager'

type Tab = 'roster' | 'import' | 'groups'

export function AdminPracticeDashboard({ snapshot }: { snapshot: AdminPracticeSnapshot }) {
  const [tab, setTab] = useState<Tab>('roster')
  return (
    <div>
      <nav aria-label="Practice management sections" style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button type="button" aria-pressed={tab === 'roster'} onClick={() => setTab('roster')}>Roster ({snapshot.roster.length})</button>
        <button type="button" aria-pressed={tab === 'import'} onClick={() => setTab('import')}>Import roster</button>
        <button type="button" aria-pressed={tab === 'groups'} onClick={() => setTab('groups')}>Groups ({snapshot.groups.length})</button>
      </nav>
      <div style={{ background: 'var(--bg-card, #fff)', border: '1px solid var(--border-card, #e5eaf0)', borderRadius: '16px', padding: '20px' }}>
        {tab === 'roster' && <RosterManager roster={snapshot.roster} positions={snapshot.positions} />}
        {tab === 'import' && <RosterImportPanel />}
        {tab === 'groups' && <PracticeGroupManager groups={snapshot.groups} roster={snapshot.roster} bookings={snapshot.bookings} sessions={snapshot.sessions} />}
      </div>
    </div>
  )
}
