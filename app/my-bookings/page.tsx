import { Suspense } from 'react'
import { MyBookingsClient } from '@/app/my-bookings/MyBookingsClient'

export default function MyBookingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">My bookings</h1>
      <p className="mt-1 text-sm text-zinc-500">Your active interview bookings.</p>

      <Suspense>
        <MyBookingsClient />
      </Suspense>
    </div>
  )
}
