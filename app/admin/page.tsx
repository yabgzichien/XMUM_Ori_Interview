import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { AdminStaff } from '@/app/admin/AdminStaff'

export default async function AdminPage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login')
  }
  if (profile.role !== 'admin') {
    redirect('/head')
  }

  return (
    <main className="scr" style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 16px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Committee Management</h1>
          <p style={{ color: '#64748B', fontSize: '14.5px', margin: 0 }}>Invite and manage heads and administrators.</p>
        </div>
      </div>

      <AdminStaff />
    </main>
  )
}
