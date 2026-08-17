'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function LoginFormInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setLoading(false)
      setError(signInError.message)
      return
    }

    const next = searchParams.get('next')
    if (next) {
      setLoading(false)
      router.push(next)
      router.refresh()
      return
    }

    let destination = '/head'
    const userId = signInData.user?.id
    if (userId) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single()
      if (profile?.role === 'committee' || profile?.role === 'performance_lead') {
        destination = '/practice'
      }
    }
    setLoading(false)
    router.push(destination)
    router.refresh()
  }

  return (
    <main className="scr login-container" style={{ width: '100%', maxWidth: '1120px', margin: '0 auto', padding: '64px 22px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <style>{`
          .login-card {
            width: 100% !important;
            background: #fff;
            border: 1px solid #EAEEF4;
            border-radius: 18px;
            padding: 36px !important;
            box-shadow: 0 8px 30px -16px rgba(16,24,40,.16);
            transition: all 0.2s ease;
          }
          @media (max-width: 480px) {
            .login-card {
              padding: 24px !important;
              border-radius: 14px !important;
            }
            .login-container {
              padding: 32px 14px !important;
            }
          }
        `}</style>
        <div style={{ textAlign: 'center', marginBottom: '26px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Committee sign in</h1>
          <p style={{ color: '#64748B', fontSize: '14.5px', margin: 0 }}>Heads & admins only. Applicants don&apos;t need an account.</p>
        </div>
        <div className="login-card">
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@xmu.edu.my" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Password</label>
                <Link href="#" style={{ fontSize: '12.5px', color: '#2563EB', fontWeight: 600 }}>Forgot?</Link>
              </div>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', outline: 'none' }} />
            </div>
            {error && <p style={{ fontSize: '14px', color: '#B91C1C', margin: 0 }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ marginTop: '4px', padding: '13px', borderRadius: '11px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 8px 18px -7px rgba(37,99,235,.5)', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
        <p style={{ textAlign: 'center', fontSize: '13.5px', color: '#64748B', marginTop: '18px' }}>Got an invite? <Link href="/register" style={{ border: 'none', background: 'none', color: '#2563EB', fontWeight: 700, fontSize: '13.5px', cursor: 'pointer', padding: 0 }}>Activate your account</Link></p>
      </div>
    </main>
  )
}

export function LoginForm() {
  return (
    <Suspense>
      <LoginFormInner />
    </Suspense>
  )
}
