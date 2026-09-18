import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = {
  title: 'Committee Sign In',
  description: 'Committee sign in for orientation leaders and administrators.',
}

export default async function LoginPage() {
  const profile = await getCurrentProfile()
  if (profile) {
    redirect(profile.role === 'committee' || profile.role === 'performance_lead' ? '/practice' : '/head')
  }
  return <LoginForm />
}
