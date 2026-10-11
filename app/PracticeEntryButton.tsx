'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { StudentIdDialog } from '@/app/practice/StudentIdDialog'
import { saveVerifiedIdentity } from '@/lib/practice-verified-identity'

/** Home-page call to action: the group list only opens after the student confirms their roster entry. */
export function PracticeEntryButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="book-button" onClick={() => setOpen(true)}>
        <span>Book Performance Group</span>
        <span className="book-arrow">→</span>
      </button>
      {open && (
        <StudentIdDialog
          onClose={() => setOpen(false)}
          onVerified={(identity) => {
            saveVerifiedIdentity(identity)
            router.push('/practice')
          }}
        />
      )}
    </>
  )
}
