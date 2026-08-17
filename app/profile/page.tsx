import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { ProfileClient } from '@/app/profile/ProfileClient'

export default async function ProfilePage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login?next=/profile')
  }

  return (
    <main className="scr" style={{ width: '100%', maxWidth: '640px', margin: '0 auto', padding: '32px 16px 48px', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>
          Your profile
        </h1>
        <p style={{ color: '#64748B', fontSize: '14.5px', margin: 0 }}>
          Update the picture shown next to your name across the app.
        </p>
      </div>
      <ProfileClient profile={profile} />
    </main>
  )
}
