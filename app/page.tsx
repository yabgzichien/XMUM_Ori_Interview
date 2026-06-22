import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Interview Booking</h1>
      <p className="mt-3 max-w-md text-zinc-500">
        Book your interview slot for the facilitator or game master track. Register an
        account, log in, then pick a time that works for you.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/login" className={cn(buttonVariants({ variant: 'default' }))}>
          Log in
        </Link>
        <Link href="/register" className={cn(buttonVariants({ variant: 'outline' }))}>
          Register
        </Link>
        <Link href="/book" className={cn(buttonVariants({ variant: 'secondary' }))}>
          Book a slot
        </Link>
      </div>
    </div>
  )
}
