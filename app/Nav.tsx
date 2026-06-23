import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

const roleLabels: Record<string, string> = {
  applicant: 'Applicant',
  head_facilitator: 'Head of Facilitators',
  head_gm: 'Head of Game Masters',
  admin: 'Admin',
}

// Server component: reads the session and renders role-aware links + log out.
export async function Nav() {
  const profile = await getCurrentProfile()
  const isStaff = profile != null && profile.role !== 'applicant'

  return (
    <header className="border-b border-border">
      <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Interview Booking
        </Link>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {profile ? (
            <>
              {profile.role === 'applicant' && (
                <>
                  <Link href="/book" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                    Book
                  </Link>
                  <Link
                    href="/my-bookings"
                    className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
                  >
                    My bookings
                  </Link>
                </>
              )}
              {isStaff && (
                <Link href="/head" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                  Dashboard
                </Link>
              )}
              <span className="hidden text-zinc-500 sm:inline">
                {profile.email} · {roleLabels[profile.role] ?? profile.role}
              </span>
              {/* No-JS-friendly: posts to the existing signout route. */}
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Log in
              </Link>
              <Link href="/register" className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}>
                Register
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
