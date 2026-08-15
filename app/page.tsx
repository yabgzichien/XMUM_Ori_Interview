import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_ORIENTATION, DEFAULT_ORIENTATION_YEAR } from '@/lib/orientation'

export default async function Home() {
  const profile = await getCurrentProfile()
  if (profile) {
    if (profile.role === 'applicant') redirect('/book')
    redirect(profile.role === 'committee' || profile.role === 'performance_lead' ? '/practice' : '/head')
  }

  const supabase = await createClient()
  // Must match the defaults /book opens with, otherwise the counts advertised
  // here don't match the slots the applicant actually lands on.
  const args = { p_orientation: DEFAULT_ORIENTATION, p_year: DEFAULT_ORIENTATION_YEAR }
  const [{ data: facSlots }, { data: gmSlots }] = await Promise.all([
    supabase.rpc('available_slots', { p_track: 'facilitator', ...args }),
    supabase.rpc('available_slots', { p_track: 'game_master', ...args }),
  ])

  // Only slots that still have a free seat are worth advertising as "open".
  const countOpen = (slots: { seats_left: number }[] | null) =>
    slots?.filter((s) => s.seats_left > 0).length ?? 0

  const facCount = countOpen(facSlots)
  const gmCount = countOpen(gmSlots)
  const totalCount = facCount + gmCount

  return (
    <main className="scr page-main" style={{ maxWidth: '1120px', margin: '0 auto', padding: '56px 22px 80px' }}>
      <div className="hero-2" style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: '48px', alignItems: 'center' }}>
        <div>
          <h1 className="hero-h1" style={{ fontSize: '48px', lineHeight: 1.04, letterSpacing: '-.03em', fontWeight: 800, margin: '0 0 18px', textWrap: 'balance' }}>
            Book your<br/>orientation interview
          </h1>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '28px' }}>
            <Link href="/book" style={{ display: 'inline-block', padding: '14px 24px', borderRadius: '12px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '15px', cursor: 'pointer', boxShadow: '0 8px 20px -6px rgba(37,99,235,.55)' }}>
              Browse open slots →
            </Link>
            <Link href="/my-booking" style={{ display: 'inline-block', padding: '14px 22px', borderRadius: '12px', border: '1px solid #E2E8F0', background: '#fff', color: '#1E293B', fontWeight: 700, fontSize: '15px', cursor: 'pointer' }}>
              Check booking
            </Link>
            <Link href="/login" style={{ display: 'inline-block', padding: '14px 22px', borderRadius: '12px', border: '1px solid #E2E8F0', background: '#fff', color: '#1E293B', fontWeight: 700, fontSize: '15px', cursor: 'pointer' }}>
              I&apos;m committee
            </Link>
          </div>
          <div style={{ display: 'flex', gap: '26px', marginTop: '34px' }}>
            <div><div style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-.02em' }}>2</div><div style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600 }}>tracks</div></div>
            <div style={{ width: '1px', background: '#E7EBF0' }}></div>
            <div><div style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-.02em' }}>{totalCount}</div><div style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600 }}>open slots</div></div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Link href="/book?track=facilitator" className="hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-14px_rgba(16,24,40,.18)]" style={{ textAlign: 'left', cursor: 'pointer', background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '22px', display: 'flex', alignItems: 'center', gap: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', transition: 'transform .15s' }}>
            <div style={{ width: '54px', height: '54px', borderRadius: '14px', background: '#EFF4FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flex: 'none' }}>🎯</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '3px' }}>Facilitator</div>
              <div style={{ fontSize: '13.5px', color: '#64748B', lineHeight: 1.45 }}>Guide new students through orientation week.</div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#2563EB' }}>{facCount}</div>
              <div style={{ fontSize: '11.5px', color: '#94A3B8', fontWeight: 600 }}>slots</div>
            </div>
          </Link>
          <Link href="/book?track=game_master" className="hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-14px_rgba(16,24,40,.18)]" style={{ textAlign: 'left', cursor: 'pointer', background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '22px', display: 'flex', alignItems: 'center', gap: '18px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', transition: 'transform .15s' }}>
            <div style={{ width: '54px', height: '54px', borderRadius: '14px', background: '#F3F0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flex: 'none' }}>🎮</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '3px' }}>Game Master</div>
              <div style={{ fontSize: '13.5px', color: '#64748B', lineHeight: 1.45 }}>Run the games, energy & icebreaker stations.</div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#2563EB' }}>{gmCount}</div>
              <div style={{ fontSize: '11.5px', color: '#94A3B8', fontWeight: 600 }}>slots</div>
            </div>
          </Link>
        </div>
      </div>
    </main>
  )
}
