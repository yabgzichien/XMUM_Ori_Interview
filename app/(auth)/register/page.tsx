import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { RegisterForm } from './RegisterForm'

export default async function RegisterPage() {
  const profile = await getCurrentProfile()
  if (profile) {
    redirect('/head')
  }
  return (
    <Suspense fallback={<div style={{ padding: '64px', textAlign: 'center', color: '#64748B', fontSize: '14.5px' }}>Loading activation...</div>}>
      <RegisterForm />
    </Suspense>
  )
}
