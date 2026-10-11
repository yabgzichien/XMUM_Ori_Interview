import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'

// Interview slots are retired, so the interview dashboard is hidden and every
// signed-in landing goes to performance practice. The dashboard components in
// this folder are kept; restore this page from git history to switch it back on.
export default async function HeadPage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login')
  }

  if (profile.role === 'applicant') {
    redirect('/book')
  }

  if (profile.role === 'admin') {
    redirect('/admin/practice')
  }

  redirect('/practice')
}
