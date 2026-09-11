import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { AdminStaff } from '@/app/admin/AdminStaff'
import { createClient } from '@/lib/supabase/server'
import type { StaffInvite, CommitteeMember } from '@/lib/admin'
import type { CommitteePositionOption } from '@/lib/practice'

export default async function AdminPage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login')
  }
  if (profile.role !== 'admin') {
    redirect('/head')
  }

  // Pre-fetch all admin data in parallel on the server
  const supabase = await createClient()
  const [invitesRes, membersRes, positionsRes] = await Promise.all([
    supabase.from('staff_invites').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, name, email, student_id, role, position, orientation, orientation_year, avatar_url').in('role', ['committee', 'performance_lead', 'head_facilitator', 'head_gm']).order('name'),
    supabase.from('committee_positions').select('value, label').order('label'),
  ])

  const initialInvites = (invitesRes.data as StaffInvite[] | null) ?? []
  const initialMembers = (membersRes.data as CommitteeMember[] | null) ?? []
  const initialPositions = (positionsRes.data as CommitteePositionOption[] | null) ?? []

  return (
    <main className="scr" style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '32px 24px 48px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px', color: 'var(--text-primary, #0F172A)' }}>Committee Management</h1>
          <p style={{ color: 'var(--text-muted, #64748B)', fontSize: '14.5px', margin: 0 }}>Invite and manage heads and administrators.</p>
        </div>
        <Link
          href="/admin/logs"
          style={{ padding: '9px 14px', borderRadius: '10px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #1E293B)', fontWeight: 600, fontSize: '14px', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          🧾 Activity Log
        </Link>
      </div>

      <AdminStaff
        initialInvites={initialInvites}
        initialMembers={initialMembers}
        initialPositions={initialPositions}
      />
    </main>
  )
}
