'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ImportValidation } from '@/lib/practice-types'

type ImportReply = { data?: ImportValidation; error?: string }

export function RosterImportPanel() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [validatedFile, setValidatedFile] = useState<File | null>(null)
  const [validation, setValidation] = useState<ImportValidation | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function choose(next: File | null) {
    setFile(next)
    setValidatedFile(null)
    setValidation(null)
    setMessage(null)
  }

  async function send(path: string, selected: File): Promise<ImportReply> {
    const body = new FormData()
    body.set('file', selected)
    const response = await fetch(path, { method: 'POST', body })
    return response.json() as Promise<ImportReply>
  }

  async function validate() {
    if (!file) return setMessage('Choose an XLSX, CSV, or JSON file.')
    setBusy(true)
    setMessage(null)
    try {
      const reply = await send('/api/admin/practice/import/validate', file)
      setValidation(reply.data ?? null)
      if (reply.data && reply.data.errors.length === 0) setValidatedFile(file)
      else setValidatedFile(null)
      setMessage(reply.error ?? null)
    } catch {
      setMessage('The roster could not be validated.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!file || file !== validatedFile) return
    setBusy(true)
    setMessage(null)
    try {
      const reply = await send('/api/admin/practice/import/apply', file)
      if (reply.error) setMessage(reply.error)
      else {
        setMessage('Import complete.')
        setValidatedFile(null)
        router.refresh()
      }
    } catch {
      setMessage('The roster import could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  const valid = Boolean(file && file === validatedFile && validation && validation.errors.length === 0)
  return (
    <section aria-labelledby="import-heading">
      <h2 id="import-heading">Import roster</h2>
      <p>Validate the complete XLSX, CSV, or JSON file first. Nothing is saved if any row has an error.</p>
      <p><a href="/api/admin/practice/import/template">Download XLSX template</a></p>
      <label>Roster file<input aria-label="Roster file" type="file" accept=".xlsx,.csv,.json" onChange={(event) => choose(event.target.files?.[0] ?? null)} /></label>
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <button type="button" disabled={!file || busy} onClick={validate}>Validate file</button>
        <button type="button" disabled={!valid || busy} onClick={apply}>Apply import</button>
      </div>
      {validation && validation.errors.length === 0 && <p role="status">Ready: {validation.inserted ?? 0} new member{validation.inserted === 1 ? '' : 's'}, {validation.updated ?? 0} update{validation.updated === 1 ? '' : 's'}.</p>}
      {validation?.errors.map((error, index) => <p role="alert" key={`${error.row}-${error.field}-${index}`}>{error.row ? `Row ${error.row}` : 'File'} — {error.field}: {error.message}</p>)}
      {message && <p role={message.includes('complete') ? 'status' : 'alert'}>{message}</p>}
    </section>
  )
}
