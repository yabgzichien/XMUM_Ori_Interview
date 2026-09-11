'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { positionLabel } from '@/lib/practice'
import { ThemeToggle } from '@/components/ThemeToggle'

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
function displayRoleLabel(profile: NavProfile): string {
  if (profile.position) {
    return positionLabel(profile.position)
  }
  return roleLabels[profile.role] || profile.role
}

/** The profile fields the nav renders. `getCurrentProfile` returns the full row. */
export type NavProfile = {
  role: string
  name?: string | null
  email?: string | null
  position?: string | null
  avatar_url?: string | null
}

export function NavClient({ profile }: { profile: NavProfile | null }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (profile) {
    const initials = (profile.name?.trim()
      ? profile.name.trim().split(/\s+/).map((part: string) => part[0]).slice(0, 2).join('')
      : profile.email?.slice(0, 2) || 'SC'
    ).toUpperCase()
    const isStaff = profile.role === 'head_facilitator' || profile.role === 'head_gm' || profile.role === 'admin'
    const practiceHref = profile.role === 'admin' ? '/head/practice' : '/practice'
    return (
      <header style={{ background: 'var(--bg-card, #fff)', borderBottom: '1px solid var(--border-card, #EAEEF4)', position: 'relative', zIndex: 100 }}>
        <div className="nav-container">
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <Link href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(140deg, #2563EB, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '16px', flexShrink: 0 }}>X</div>
              <div style={{ fontWeight: 800, fontSize: '15px', whiteSpace: 'nowrap' }}>XMUM <span style={{ color: '#94A3B8', fontWeight: 600 }}>Committee</span></div>
            </Link>
            <nav className="nav-links flex gap-[4px]">
              {isStaff && (
                <Link href="/head" style={{ padding: '8px 13px', borderRadius: '9px', fontWeight: 600, fontSize: '14px', background: pathname === '/head' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/head' ? 'var(--accent-text, #2563EB)' : 'var(--text-muted, #64748B)' }}>
                  Interview
                </Link>
              )}
              <Link href={practiceHref} style={{ padding: '8px 13px', borderRadius: '9px', fontWeight: 600, fontSize: '14px', background: pathname.startsWith('/practice') || pathname.startsWith('/head/practice') ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname.startsWith('/practice') || pathname.startsWith('/head/practice') ? 'var(--accent-text, #2563EB)' : 'var(--text-muted, #64748B)' }}>
                Practice Groups
              </Link>
              {profile.role === 'admin' && (
                <Link href="/admin" style={{ padding: '8px 13px', borderRadius: '9px', fontWeight: 600, fontSize: '14px', background: pathname === '/admin' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/admin' ? 'var(--accent-text, #2563EB)' : 'var(--text-muted, #64748B)' }}>
                  Committee
                </Link>
              )}
              {profile.role === 'admin' && (
                <Link href="/admin/logs" style={{ padding: '8px 13px', borderRadius: '9px', fontWeight: 600, fontSize: '14px', background: pathname.startsWith('/admin/logs') ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname.startsWith('/admin/logs') ? 'var(--accent-text, #2563EB)' : 'var(--text-muted, #64748B)' }}>
                  Activity Log
                </Link>
              )}
            </nav>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {/* Name + role pill — hidden on very small screens */}
            {profile.name && (
              <span className="nav-links" style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>
                {profile.name}
              </span>
            )}
            <span className="nav-links" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 11px', borderRadius: '99px', background: 'var(--accent-subtle, #EFF4FF)', color: 'var(--accent-text, #2563EB)', fontSize: '12px', fontWeight: 700, border: '1px solid var(--accent-border, #DBE6FF)' }}>
              {displayRoleLabel(profile)}
            </span>
            <Link href="/profile" aria-label="Your profile" style={{ display: 'block', flexShrink: 0 }}>
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt=""
                  style={{ width: '34px', height: '34px', borderRadius: '99px', objectFit: 'cover', border: '1px solid var(--border-card, #EAEEF4)' }}
                />
              ) : (
                <div style={{ width: '34px', height: '34px', borderRadius: '99px', background: 'var(--bg-card-hover, #EEF2F7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', color: 'var(--text-secondary, #475569)' }}>
                  {initials}
                </div>
              )}
            </Link>
            <ThemeToggle className="nav-links" />
            <form action="/auth/signout" method="post" className="nav-links">
              <button
                type="submit"
                style={{ padding: '8px 13px', borderRadius: '9px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-secondary, #64748B)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
              >
                Sign out
              </button>
            </form>
            {/* Hamburger */}
            <button
              type="button"
              className="nav-mobile-toggle"
              onClick={() => setMobileOpen(!mobileOpen)}
              style={{ background: 'none', border: '1px solid var(--border-input, #E2E8F0)', borderRadius: '8px', padding: '7px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Open menu"
            >
              <span style={{ width: '18px', height: '2px', background: 'var(--text-secondary, #475569)', borderRadius: '1px', display: 'block', transition: 'transform 0.2s', transform: mobileOpen ? 'rotate(45deg) translateY(6px)' : 'none' }} />
              <span style={{ width: '18px', height: '2px', background: 'var(--text-secondary, #475569)', borderRadius: '1px', display: 'block', opacity: mobileOpen ? 0 : 1, transition: 'opacity 0.2s' }} />
              <span style={{ width: '18px', height: '2px', background: 'var(--text-secondary, #475569)', borderRadius: '1px', display: 'block', transition: 'transform 0.2s', transform: mobileOpen ? 'rotate(-45deg) translateY(-6px)' : 'none' }} />
            </button>
          </div>
        </div>
        {/* Mobile dropdown */}
        <div className={`nav-mobile-menu${mobileOpen ? ' open' : ''}`}>
          <ThemeToggle mobile />
          {isStaff && (
            <Link href="/head" onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname === '/head' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/head' ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)' }}>
              📊 Interview
            </Link>
          )}
          <Link href={practiceHref} onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname.startsWith('/practice') || pathname.startsWith('/head/practice') ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname.startsWith('/practice') || pathname.startsWith('/head/practice') ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)' }}>
            🎭 Practice Groups
          </Link>
          {profile.role === 'admin' && (
            <Link href="/admin" onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname === '/admin' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/admin' ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)' }}>
              👥 Committee
            </Link>
          )}
          {profile.role === 'admin' && (
            <Link href="/admin/logs" onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname.startsWith('/admin/logs') ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname.startsWith('/admin/logs') ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)' }}>
              🧾 Activity Log
            </Link>
          )}
          <Link href="/profile" onClick={() => setMobileOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px solid var(--border-card, #EAEEF4)', marginTop: '4px', paddingTop: '10px', padding: '10px 12px 4px', color: 'inherit', textDecoration: 'none' }}>
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" style={{ width: '32px', height: '32px', borderRadius: '99px', objectFit: 'cover', border: '1px solid var(--border-card, #EAEEF4)' }} />
            ) : (
              <div style={{ width: '32px', height: '32px', borderRadius: '99px', background: 'var(--bg-card-hover, #EEF2F7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px', color: 'var(--text-secondary, #475569)' }}>
                {initials}
              </div>
            )}
            <div>
              {profile.name && (
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary, #0F172A)', marginBottom: '2px' }}>{profile.name}</div>
              )}
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #94A3B8)', fontWeight: 600 }}>{displayRoleLabel(profile)}</div>
            </div>
          </Link>
          <form action="/auth/signout" method="post" style={{ marginTop: '6px', borderTop: '1px solid var(--border-card, #EAEEF4)', paddingTop: '8px' }}>
            <button
              type="submit"
              style={{ width: '100%', padding: '9px 12px', borderRadius: '9px', border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.08)', color: '#EF4444', fontWeight: 700, fontSize: '13.5px', cursor: 'pointer', textAlign: 'center' }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
    )
  }

  return (
    <header style={{ background: 'var(--bg-card, #fff)', borderBottom: '1px solid var(--border-card, #EAEEF4)', position: 'relative', zIndex: 100 }}>
      <div className="nav-container">
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: 'linear-gradient(140deg, #2563EB, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '17px', boxShadow: '0 4px 12px -3px rgba(37,99,235,.5)', flexShrink: 0 }}>X</div>
          <div style={{ lineHeight: 1.15, whiteSpace: 'nowrap' }}>
            <div style={{ fontWeight: 800, fontSize: '15px', letterSpacing: '-.01em', color: 'var(--text-primary, #0F172A)' }}>XMUM Orientation</div>
            <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>Interview Booking</div>
          </div>
        </Link>
        {/* Desktop links */}
        <div className="nav-links flex items-center gap-[8px]">
          <Link href="/book" style={{ padding: '9px 13px', borderRadius: '10px', border: 'none', background: pathname === '/book' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/book' ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
            Book
          </Link>
          <Link href="/my-booking" style={{ padding: '9px 13px', borderRadius: '10px', border: 'none', background: pathname === '/my-booking' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/my-booking' ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
            Check booking
          </Link>
          <Link href="/login" style={{ padding: '9px 14px', borderRadius: '10px', border: '1px solid var(--border-input, #E2E8F0)', background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #1E293B)', fontWeight: 600, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Committee
          </Link>
          <ThemeToggle />
        </div>
        {/* Mobile Hamburger Toggle */}
        <button
          type="button"
          className="nav-mobile-toggle"
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{ background: 'none', border: '1px solid var(--border-input, #E2E8F0)', borderRadius: '8px', padding: '7px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', justifyContent: 'center' }}
          aria-label="Open menu"
        >
          <span style={{ width: '18px', height: '2px', background: 'var(--text-secondary, #475569)', borderRadius: '1px', display: 'block', transition: 'transform 0.2s', transform: mobileOpen ? 'rotate(45deg) translateY(6px)' : 'none' }} />
          <span style={{ width: '18px', height: '2px', background: 'var(--text-secondary, #475569)', borderRadius: '1px', display: 'block', opacity: mobileOpen ? 0 : 1, transition: 'opacity 0.2s' }} />
          <span style={{ width: '18px', height: '2px', background: 'var(--text-secondary, #475569)', borderRadius: '1px', display: 'block', transition: 'transform 0.2s', transform: mobileOpen ? 'rotate(-45deg) translateY(-6px)' : 'none' }} />
        </button>
      </div>
      {/* Mobile dropdown */}
      <div className={`nav-mobile-menu${mobileOpen ? ' open' : ''}`}>
        <ThemeToggle mobile />
        <Link href="/book" onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname === '/book' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/book' ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)' }}>
          📝 Book an Interview
        </Link>
        <Link href="/my-booking" onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname === '/my-booking' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/my-booking' ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)' }}>
          🔍 Check Booking
        </Link>
        <Link href="/login" onClick={() => setMobileOpen(false)} style={{ padding: '10px 12px', borderRadius: '9px', fontWeight: 600, fontSize: '14.5px', background: pathname === '/login' ? 'var(--accent-subtle, #EFF4FF)' : 'transparent', color: pathname === '/login' ? 'var(--accent-text, #2563EB)' : 'var(--text-secondary, #334155)' }}>
          🔐 Committee Login
        </Link>
      </div>
    </header>
  )
}
