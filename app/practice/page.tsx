import type { Metadata } from 'next'
import { PracticeClient } from '@/app/practice/PracticeClient'

export const metadata: Metadata = {
  title: 'Performance Practice',
  description: 'Verify your committee details and book a December 2026 performance-practice group.',
}

export default function PracticePage() {
  return (
    <main className="scr" style={{ width: '100%', maxWidth: '920px', margin: '0 auto', padding: '32px 16px 48px', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px', color: 'var(--text-primary, #0F172A)' }}>
          December 2026 Performance Practice
        </h1>
        <p style={{ color: 'var(--text-muted, #64748B)', fontSize: '14.5px', margin: 0 }}>
          Verify your committee details, then choose one practice group.
        </p>
      </div>
      <PracticeClient />
    </main>
  )
}
