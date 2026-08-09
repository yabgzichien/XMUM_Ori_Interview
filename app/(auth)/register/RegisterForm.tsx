'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialEmail = searchParams.get('email') || ''
  const initialCode = searchParams.get('code') || ''

  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState(initialCode)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const res = await fetch('/api/staff/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setLoading(false)
      setError(data.error ?? 'Could not activate the account.')
      return
    }

    // Auto-login after successful activation
    const supabase = createClient()
    const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (loginErr) {
      setError(`Activated successfully, but could not auto-sign in: ${loginErr.message}`)
      return
    }

    const destination = data.role === 'committee' || data.role === 'performance_lead' ? '/practice' : '/head'

    setDone(true)
    setTimeout(() => {
      router.push(destination)
      router.refresh()
    }, 1200)
  }

  return (
    <main className="scr register-container" style={{ maxWidth: '1120px', margin: '0 auto', padding: '64px 22px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <style>{`
          .register-card {
            width: 100% !important;
            background: #fff;
            border: 1px solid #EAEEF4;
            border-radius: 18px;
            padding: 36px !important;
            box-shadow: 0 8px 30px -16px rgba(16,24,40,.16);
            transition: all 0.2s ease;
          }
          @media (max-width: 480px) {
            .register-card {
              padding: 24px !important;
              border-radius: 14px !important;
            }
            .register-container {
              padding: 32px 14px !important;
            }
          }
        `}</style>
        <div style={{ textAlign: 'center', marginBottom: '26px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '99px', background: '#EFF4FF', color: '#2563EB', fontSize: '12px', fontWeight: 700, border: '1px solid #DBE6FF', marginBottom: '14px' }}>✦ Invitation</span>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Activate your account</h1>
          <p style={{ color: '#64748B', fontSize: '14.5px', margin: 0 }}>Set a password to finish your committee invite.</p>
        </div>
        {done ? (
          <div className="register-card" style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontWeight: 600, color: '#16A34A' }}>Account activated. Logging in and redirecting...</p>
          </div>
        ) : (
          <div className="register-card">
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@xmu.edu.my" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Invite code</label>
                <input type="text" required value={code} onChange={e => setCode(e.target.value)} placeholder="ORI-XXXX" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: '"JetBrains Mono", monospace', textTransform: 'uppercase', outline: 'none' }} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>New password</label>
                <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px', display: 'block' }}>Confirm password</label>
                <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" style={{ width: '100%', padding: '11px 13px', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '15px', fontFamily: 'inherit', outline: 'none' }} />
              </div>
              {error && <p style={{ fontSize: '14px', color: '#B91C1C', margin: 0 }}>{error}</p>}
              <button type="submit" disabled={loading} style={{ marginTop: '4px', padding: '13px', borderRadius: '11px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 8px 18px -7px rgba(37,99,235,.5)', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Activating...' : 'Activate account'}
              </button>
            </form>
          </div>
        )}
        <p style={{ textAlign: 'center', fontSize: '13.5px', color: '#64748B', marginTop: '18px' }}>
          Already activated? <Link href="/login" style={{ color: '#2563EB', fontWeight: 700 }}>Sign in</Link>
        </p>
      </div>
    </main>
  )
}
