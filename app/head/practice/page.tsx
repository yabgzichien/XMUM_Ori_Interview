import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth'
import { HeadPracticeDashboard } from '@/app/head/practice/HeadPracticeDashboard'
import type { Orientation } from '@/lib/head'

type SearchParams = { [key: string]: string | string[] | undefined }

function isOrientation(value: string | string[] | undefined): value is Orientation {
  return value === 'february' || value === 'april' || value === 'december'
}

const ORIENTATIONS: { key: Orientation; label: string; icon: string }[] = [
  { key: 'february', label: 'February', icon: '🌸' },
  { key: 'april', label: 'April', icon: '🌿' },
  { key: 'december', label: 'December', icon: '❄️' },
]

export default async function HeadPracticePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login')
  }

  if (profile.role === 'applicant') {
    redirect('/book')
  }

  if (profile.role !== 'admin') {
    redirect('/practice')
  }

  const params = await searchParams

  const orientation: Orientation = isOrientation(params.orientation) ? params.orientation : 'december'
  const orientationYear: number = params.year ? parseInt(String(params.year), 10) || 2026 : 2026

  const orientationLabel = ORIENTATIONS.find(o => o.key === orientation)?.label || 'February'

  return (
    <main className="scr head-page-main" style={{ width: '100%', maxWidth: '1440px', margin: '0 auto', padding: '32px 24px 48px', boxSizing: 'border-box' }}>
      <div className="head-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>{orientationLabel} {orientationYear} Practice Groups</h1>
          <p style={{ color: '#64748B', fontSize: '14.5px', margin: 0 }}>
            Create groups, assign performance leads, and track sessions. Facilitators and Game
            Masters practice together — groups aren&apos;t split by track.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {ORIENTATIONS.map(o => (
            <Link
              key={o.key}
              href={`/head/practice?orientation=${o.key}&year=${orientationYear}`}
              style={{
                padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 700,
                background: orientation === o.key ? '#EFF4FF' : '#fff',
                color: orientation === o.key ? '#2563EB' : '#475569',
                border: orientation === o.key ? '1px solid #2563EB' : '1px solid #E2E8F0',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span>{o.icon}</span> {o.label}
            </Link>
          ))}
        </div>
      </div>

      <HeadPracticeDashboard orientation={orientation} orientationYear={orientationYear} isAdmin currentUserId={profile.id} />
    </main>
  )
}
