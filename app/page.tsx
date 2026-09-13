import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'

export default async function Home() {
  const profile = await getCurrentProfile()
  if (profile) {
    if (profile.role === 'applicant') redirect('/book')
    redirect(profile.role === 'committee' || profile.role === 'performance_lead' ? '/practice' : '/head')
  }

  return (
    <main className="scr page-main" style={{ width: '100%', maxWidth: '1120px', margin: '0 auto', padding: '80px 22px 120px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(80vh - 80px)', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '820px', width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 className="hero-h1" style={{ fontSize: '64px', lineHeight: 1.08, letterSpacing: '-.035em', fontWeight: 800, margin: '0 0 20px', textAlign: 'center', textWrap: 'balance' }}>
          Book your<br/>Orientation Interview
        </h1>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '36px' }}>
          <Link href="/book" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '16px 32px', borderRadius: '14px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '16px', cursor: 'pointer', boxShadow: '0 10px 25px -5px rgba(37,99,235,.55)' }}>
            Book your Interview
          </Link>
          <Link href="/my-booking" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '16px 28px', borderRadius: '14px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #1E293B)', fontWeight: 700, fontSize: '16px', cursor: 'pointer' }}>
            Check booking
          </Link>
          <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '16px 28px', borderRadius: '14px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #1E293B)', fontWeight: 700, fontSize: '16px', cursor: 'pointer' }}>
            I&apos;m committee
          </Link>
        </div>
      </div>
    </main>
  )
}
