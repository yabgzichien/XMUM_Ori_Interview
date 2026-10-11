'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { StudentIdDialog } from '@/app/practice/StudentIdDialog'
import { saveVerifiedIdentity } from '@/lib/practice-verified-identity'

/** Home-page call to action: the group list only opens after the student confirms their roster entry. */
export function PracticeEntryButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
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
