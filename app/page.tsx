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
    <main className="scr page-main" style={{ width: '100%', maxWidth: '1120px', margin: '0 auto', padding: '60px 22px 100px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(80vh - 80px)', boxSizing: 'border-box' }}>
      <style>{`
        .home-hero-buttons {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          justify-content: center;
          margin-top: 36px;
          width: 100%;
        }
        .home-hero-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }
        @media (max-width: 640px) {
          .home-hero-buttons {
            flex-direction: column !important;
            align-items: stretch !important;
            max-width: 320px !important;
            margin-left: auto !important;
            margin-right: auto !important;
            gap: 12px !important;
          }
          .home-hero-btn {
            width: 100% !important;
            text-align: center !important;
          }
        }
      `}</style>
      <div style={{ maxWidth: '820px', width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/vortexalogo.png"
          alt="Vortexa Logo"
          style={{ width: '270px', maxWidth: '85vw', height: 'auto', maxHeight: '210px', objectFit: 'contain', marginBottom: '24px' }}
        />
        <h1 className="hero-h1 font-title" style={{ fontSize: '56px', lineHeight: 1.1, letterSpacing: '-.02em', fontWeight: 700, margin: '0 0 20px', textAlign: 'center', textWrap: 'balance' }}>
          Book your<br/>Orientation Interview
        </h1>
        <div className="home-hero-buttons">
          <Link href="/book" className="home-hero-btn" style={{ padding: '16px 32px', borderRadius: '14px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '16px', cursor: 'pointer', boxShadow: '0 10px 25px -5px rgba(37,99,235,.55)' }}>
            Book your Interview
          </Link>
          <Link href="/my-booking" className="home-hero-btn" style={{ padding: '16px 28px', borderRadius: '14px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #1E293B)', fontWeight: 700, fontSize: '16px', cursor: 'pointer' }}>
            Check booking
          </Link>
          <Link href="/login" className="home-hero-btn" style={{ padding: '16px 28px', borderRadius: '14px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #1E293B)', fontWeight: 700, fontSize: '16px', cursor: 'pointer' }}>
            I&apos;m committee
          </Link>
        </div>
      </div>
    </main>
  )
}
