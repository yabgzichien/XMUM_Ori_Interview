'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { positionLabel } from '@/lib/practice'

const roleLabels: Record<string, string> = {
  applicant: 'Applicant',
  head_facilitator: 'Head of Facilitators',
  head_gm: 'Head of Game Masters',
  admin: 'Admin',
  committee: 'Committee Member',
  performance_lead: 'Performance Lead',
}

// An assigned committee position (HOF, Treasurer, etc.) is shown instead of
// the generic account role whenever one is set — including after HOF/HOG
// promotes someone to head_facilitator/head_gm, so the abbreviated position
// label stays visible rather than reverting to the generic role name.
function displayRoleLabel(profile: { role: string; position?: string | null }): string {
  if (profile.position) {
    return positionLabel(profile.position)
  }
  return roleLabels[profile.role] || profile.role
}

export function NavClient({ profile }: { profile: any }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (profile) {
    const initials = (profile.name?.trim()
      ? profile.name.trim().split(/\s+/).map((part: string) => part[0]).slice(0, 2).join('')
      : profile.email?.slice(0, 2) || 'SC'
    ).toUpperCase()
    const isStaff = profile.role === 'head_facilitator' || profile.role === 'head_gm' || profile.role === 'admin'
    const practiceHref = isStaff ? '/head/practice' : '/practice'
    return (
      <header style={{ background: '#fff', borderBottom: '1px solid #EAEEF4', position: 'relative', zIndex: 100 }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <Link href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(140deg, #2563EB, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '16px' }}>X</div>
              <div style={{ fontWeight: 800, fontSize: '15px' }}>XMUM <span style={{ color: '#94A3B8', fontWeight: 600 }}>Committee</span></div>
            </Link>
            <nav className="nav-links flex gap-[4px]">
              {isStaff && (
                <Link href="/head" style={{ padding: '8px 13px', borderRadius: '9px', fontWeight: 600, fontSize: '14px', background: pathname === '/head' ? '#EFF4FF' : 'transparent', color: pathname === '/head' ? '#2563EB' : '#64748B' }}>
                  Interview
                </Link>
              )}
              <Link href={practiceHref} style={{ padding: '8px 13px', borderRadius: '9px', fontWeight: 600, fontSize: '14px', background: pathname.startsWith('/practice') || pathname.startsWith('/head/practice') ? '#EFF4FF' : 'transparent', color: pathname.startsWith('/practice') || pathname.startsWith('/head/practice') ? '#2563EB' : '#64748B' }}>
                Practice Groups
              </Link>
              {profile.role === 'admin' && (
                <Link href="/admin" style={{ padding: '8px 13px', borderRadius: '9px', fontWeight: 600, fontSize: '14px', background: pathname.startsWith('/admin') ? '#EFF4FF' : 'transparent', color: pathname.startsWith('/admin') ? '#2563EB' : '#64748B' }}>
                  Committee
                </Link>
              )}
            </nav>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Name + role pill — hidden on very small screens */}
            {profile.name && (
              <span className="nav-links" style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>
                {profile.name}
              </span>
            )}
            <span className="nav-links" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 11px', borderRadius: '99px', background: '#EFF4FF', color: '#2563EB', fontSize: '12px', fontWeight: 700, border: '1px solid #DBE6FF' }}>
              {displayRoleLabel(profile)}
            </span>
            <div style={{ width: '34px', height: '34px', borderRadius: '99px', background: '#EEF2F7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', color: '#475569' }}>
              {initials}
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                style={{ padding: '8px 13px', borderRadius: '9px', border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
              >
                Sign out
              </button>
            </form>
            {/* Hamburger */}
            <button
              type="button"
              className="nav-mobile-toggle"
              onClick={() => setMobileOpen(!mobileOpen)}
              style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '7px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Open menu"
            >
              <span style={{ width: '18px', height: '2px', background: '#475569', borderRadius: '1px', display: 'block', transition: 'transform 0.2s', transform: mobileOpen ? 'rotate(45deg) translateY(6px)' : 'none' }} />
              <span style={{ width: '18px', height: '2px', background: '#475569', borderRadius: '1px', display: 'block', opacity: mobileOpen ? 0 : 1, transition: 'opacity 0.2s' }} />
              <span style={{ width: '18px', height: '2px', background: '#475569', borderRadius: '1px', display: 'block', transition: 'transform 0.2s', transform: mobileOpen ? 'rotate(-45deg) translateY(-6px)' : 'none' }} />
            </button>
          </div>
        </div>
        {/* Mobile dropdown */}
        <div className={`nav-mobile-menu${mobileOpen ? ' open' : ''}`}>
          {isStaff && (
            <Link href="/head" onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname === '/head' ? '#EFF4FF' : 'transparent', color: pathname === '/head' ? '#2563EB' : '#334155' }}>
              📊 Interview
            </Link>
          )}
          <Link href={practiceHref} onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname.startsWith('/practice') || pathname.startsWith('/head/practice') ? '#EFF4FF' : 'transparent', color: pathname.startsWith('/practice') || pathname.startsWith('/head/practice') ? '#2563EB' : '#334155' }}>
            🎭 Practice Groups
          </Link>
          {profile.role === 'admin' && (
            <Link href="/admin" onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname.startsWith('/admin') ? '#EFF4FF' : 'transparent', color: pathname.startsWith('/admin') ? '#2563EB' : '#334155' }}>
              👥 Committee
            </Link>
          )}
          <div style={{ borderTop: '1px solid #EAEEF4', marginTop: '4px', paddingTop: '8px', padding: '8px 12px 4px' }}>
            {profile.name && (
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{profile.name}</div>
            )}
            <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>{displayRoleLabel(profile)}</div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header style={{ background: '#fff', borderBottom: '1px solid #EAEEF4', position: 'relative', zIndex: 100 }}>
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '11px' }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: 'linear-gradient(140deg, #2563EB, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '17px', boxShadow: '0 4px 12px -3px rgba(37,99,235,.5)' }}>X</div>
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontWeight: 800, fontSize: '15px', letterSpacing: '-.01em' }}>XMUM Orientation</div>
            <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>Interview Booking</div>
          </div>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Link href="/book" style={{ padding: '9px 13px', borderRadius: '10px', border: 'none', background: 'transparent', color: '#334155', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
            Book
          </Link>
          <Link href="/my-booking" style={{ padding: '9px 13px', borderRadius: '10px', border: 'none', background: 'transparent', color: '#334155', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
            Check booking
          </Link>
          <Link href="/login" style={{ padding: '9px 14px', borderRadius: '10px', border: '1px solid #E2E8F0', background: '#fff', color: '#1E293B', fontWeight: 600, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Committee
          </Link>
        </div>
      </div>
    </header>
  )
}
