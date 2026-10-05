import type { Metadata } from 'next'
import { PracticeClient } from '@/app/practice/PracticeClient'
import { getPracticeCatalog } from '@/lib/practice-server'
import type { PracticeCatalog } from '@/lib/practice-types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Performance Practice',
  description: 'Verify your committee details and book a December 2026 performance-practice group.',
}

export default async function PracticePage() {
  const result = await getPracticeCatalog()
  const catalog: PracticeCatalog = result.data ?? {
    server_now: new Date().toISOString(),
    booking_opens_at: null,
    booking_open: false,
    groups: [],
  }
  return (
    <main className="scr" style={{ width: '100%', maxWidth: '1120px', margin: '0 auto', padding: '32px 16px 64px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto 28px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px', color: 'var(--text-primary, #0F172A)' }}>
          December 2026 Performance Practice
        </h1>
        <p style={{ color: 'var(--text-muted, #64748B)', fontSize: '14.5px', margin: 0 }}>
          Preview every performance, then verify your details when booking opens.
        </p>
      </div>
      <PracticeClient initialCatalog={catalog} />
    </main>
  )
}
