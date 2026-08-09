import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { LoginForm } from './LoginForm'

export default async function LoginPage() {
  const profile = await getCurrentProfile()
  if (profile) {
    redirect(profile.role === 'committee' || profile.role === 'performance_lead' ? '/practice' : '/head')
  }
  return <LoginForm />
}
