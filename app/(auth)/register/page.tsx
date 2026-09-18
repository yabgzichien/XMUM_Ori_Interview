import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { RegisterForm } from './RegisterForm'

export const metadata: Metadata = {
  title: 'Activate Account',
  description: 'Set your password to activate your committee account.',
}

export default async function RegisterPage() {
  const profile = await getCurrentProfile()
  if (profile) {
    redirect(profile.role === 'committee' || profile.role === 'performance_lead' ? '/practice' : '/head')
  }
  return (
    <Suspense fallback={<div style={{ padding: '64px', textAlign: 'center', color: 'var(--text-muted, #64748B)', fontSize: '14.5px' }}>Loading activation...</div>}>
      <RegisterForm />
    </Suspense>
  )
}
