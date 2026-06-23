import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getCurrentProfile } from '@/lib/auth'

export default async function Home() {
  // Only staff/admin have accounts, and they don't book interviews — send them
  // straight to their dashboard instead of the public booking landing page.
  const profile = await getCurrentProfile()
  if (profile) {
    redirect('/head')
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Interview Booking</h1>
      <p className="mt-3 max-w-md text-zinc-500">
        Book your interview slot for the facilitator or game master track. No account
        needed — just enter your details and pick a time that works for you.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/book" className={cn(buttonVariants({ variant: 'default' }))}>
          Book an interview
        </Link>
        <Link href="/login" className={cn(buttonVariants({ variant: 'outline' }))}>
          Staff log in
        </Link>
      </div>
    </div>
  )
}
