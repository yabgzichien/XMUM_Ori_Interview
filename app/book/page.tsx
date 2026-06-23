import { Suspense } from 'react'
import { BookClient } from '@/app/book/BookClient'

export default function BookPage() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Book an interview slot</h1>
      <p className="mt-1 text-sm text-zinc-500">
        No login needed. Choose a track, pick an open time, then enter your details.
      </p>

      <Suspense>
        <BookClient />
      </Suspense>
    </div>
  )
}
