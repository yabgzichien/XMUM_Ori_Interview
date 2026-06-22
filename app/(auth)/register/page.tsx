'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    const supabase = createClient()
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          student_id: studentId || undefined,
        },
      },
    })

    setLoading(false)

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    if (data.session) {
      router.push('/book')
      return
    }

    setMessage('Check your email to confirm your account, then log in.')
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-border bg-background p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
        <p className="mt-1 text-sm text-zinc-500">Register to book your interview slot.</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="student_id" className="text-sm font-medium">
              Student ID <span className="text-zinc-400">(optional)</span>
            </label>
            <input
              id="student_id"
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-green-600">{message}</p>}

          <Button type="submit" disabled={loading} className="mt-2 w-full">
            {loading ? 'Creating account...' : 'Register'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
