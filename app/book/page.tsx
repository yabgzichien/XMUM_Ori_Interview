import { Suspense } from 'react'
import { BookClient } from '@/app/book/BookClient'

export default function BookPage() {
  return (
    <Suspense>
      <BookClient />
    </Suspense>
  )
}
