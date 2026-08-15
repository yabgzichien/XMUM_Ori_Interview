import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { PracticeClient } from '@/app/practice/PracticeClient'

export default async function PracticePage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login?next=/practice')
  }

  if (profile.role === 'applicant') {
    redirect('/book')
  }

  if (profile.role === 'head_facilitator' || profile.role === 'head_gm' || profile.role === 'admin') {
    redirect('/head/practice')
  }

  const orientationLabel = profile.orientation
    ? profile.orientation.charAt(0).toUpperCase() + profile.orientation.slice(1)
    : 'December'
  const orientationYear = profile.orientation_year || 2026

  return (
    <main className="scr" style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 16px 48px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>
          {orientationLabel} {orientationYear} Practice Groups
        </h1>
        <p style={{ color: '#64748B', fontSize: '14.5px', margin: 0 }}>
          Join a performance practice group for your orientation cycle and keep up with its scheduled sessions.
        </p>
      </div>
      <PracticeClient currentUserId={profile.id} />
    </main>
  )
}
