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
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Staff management</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Invite Heads and admins. Share each person their <strong>email + invite code</strong>;
        they activate the account by setting a password at the staff registration page.
      </p>

      <div className="mt-8">
        <AdminStaff />
      </div>
    </div>
  )
}
