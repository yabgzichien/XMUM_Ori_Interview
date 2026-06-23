'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  addInvite,
  deleteInvite,
  listInvites,
  type StaffInvite,
  type StaffRole,
} from '@/lib/admin'

const roleLabels: Record<StaffRole, string> = {
  head_facilitator: 'Head of Facilitators',
  head_gm: 'Head of Game Masters',
  admin: 'Admin',
}

export function AdminStaff() {
  const [invites, setInvites] = useState<StaffInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('head_facilitator')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await listInvites()
    setLoading(false)
    if (error) {
      setLoadError(error.message)
      setInvites([])
      return
    }
    setLoadError(null)
    setInvites(data ?? [])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    const { error } = await addInvite({ name, studentId, email, role })
    setSubmitting(false)
    if (error) {
      setFormError(
        error.message.includes('duplicate')
          ? 'That email already has an invite.'
          : error.message,
      )
      return
    }
    setName('')
    setStudentId('')
    setEmail('')
    setRole('head_facilitator')
    setLoading(true)
    load()
  }

  async function handleDelete(invite: StaffInvite) {
    if (!window.confirm(`Remove the invite for ${invite.email}?`)) return
    const { error } = await deleteInvite(invite.id)
    if (error) {
      setLoadError(error.message)
      return
    }
    setLoading(true)
    load()
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-lg font-medium">Invite a staff member</h2>
        <form onSubmit={handleAdd} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Student ID
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRole)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="head_facilitator">Head of Facilitators</option>
              <option value="head_gm">Head of Game Masters</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add invite'}
          </Button>
        </form>
        {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}
      </section>

      <section>
        <h2 className="text-lg font-medium">Invites</h2>
        {loading && <p className="mt-3 text-sm text-zinc-500">Loading...</p>}
        {loadError && <p className="mt-3 text-sm text-destructive">{loadError}</p>}
        {!loading && !loadError && invites.length === 0 && (
          <p className="mt-3 text-sm text-zinc-500">No invites yet.</p>
        )}
        {!loading && !loadError && invites.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Email</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Code</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-border text-sm last:border-0">
                    <td className="py-2 pr-3">{inv.name}</td>
                    <td className="py-2 pr-3">{inv.email}</td>
                    <td className="py-2 pr-3">{roleLabels[inv.role]}</td>
                    <td className="py-2 pr-3 font-mono">{inv.claimed_at ? '—' : inv.code}</td>
                    <td className="py-2 pr-3">
                      {inv.claimed_at ? (
                        <span className="text-green-600">Activated</span>
                      ) : (
                        <span className="text-amber-600">Pending</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {!inv.claimed_at && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(inv)}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
