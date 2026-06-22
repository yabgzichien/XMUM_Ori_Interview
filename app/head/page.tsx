import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { HeadDashboard } from '@/app/head/HeadDashboard'
import type { Track } from '@/lib/head'

type SearchParams = { [key: string]: string | string[] | undefined }

function isTrack(value: string | string[] | undefined): value is Track {
  return value === 'facilitator' || value === 'game_master'
}

export default async function HeadPage({
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

  const isAdmin = profile.role === 'admin'

  let track: Track
  if (profile.role === 'head_facilitator') {
    track = 'facilitator'
  } else if (profile.role === 'head_gm') {
    track = 'game_master'
  } else {
    const params = await searchParams
    track = isTrack(params.track) ? params.track : 'facilitator'
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Head dashboard</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Manage the booking window, slots, and bookings for your track.
      </p>

      {isAdmin && (
        <div className="mt-4 flex items-center gap-2">
          <Link
            href="/head?track=facilitator"
            className={cn(buttonVariants({ variant: track === 'facilitator' ? 'default' : 'outline', size: 'sm' }))}
          >
            Facilitator
          </Link>
          <Link
            href="/head?track=game_master"
            className={cn(buttonVariants({ variant: track === 'game_master' ? 'default' : 'outline', size: 'sm' }))}
          >
            Game Master
          </Link>
        </div>
      )}

      <div className="mt-8">
        <HeadDashboard track={track} profileId={profile.id} isAdmin={isAdmin} />
      </div>
    </div>
  )
}
