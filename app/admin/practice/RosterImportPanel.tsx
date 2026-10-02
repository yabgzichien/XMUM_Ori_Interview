'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ImportValidation } from '@/lib/practice-types'
import { AlertCircle, CheckCircle2, Download, FileCheck2, FileUp, Upload } from 'lucide-react'
import styles from './practice-admin.module.css'

type ImportReply = { data?: ImportValidation; error?: string }

export function RosterImportPanel() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [validatedFile, setValidatedFile] = useState<File | null>(null)
  const [validation, setValidation] = useState<ImportValidation | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const [busy, setBusy] = useState(false)

  function choose(next: File | null) {
    setFile(next)
    setValidatedFile(null)
    setValidation(null)
    setMessage(null)
    setCompleted(false)
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
    setCompleted(false)
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
      if (reply.error) {
        setCompleted(false)
        setMessage(reply.error)
      }
      else {
        setMessage('Import complete.')
        setCompleted(true)
        setFile(null)
        setValidatedFile(null)
        setValidation(null)
        router.refresh()
      }
    } catch {
      setMessage('The roster import could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  const valid = Boolean(file && file === validatedFile && validation && validation.errors.length === 0)
  const activeStep = completed || valid ? 3 : file ? 2 : 1
  return (
    <section className={styles.section} aria-labelledby="import-heading">
      <header className={styles.sectionHeader}>
        <div>
          <h2 id="import-heading">Import roster</h2>
          <p>Validate the complete file before saving. If one row has a problem, nothing is imported.</p>
        </div>
        <a className={styles.templateLink} href="/api/admin/practice/import/template"><Download size={15} /> Download template</a>
      </header>

      <div className={styles.steps} aria-label="Import progress">
        {['Choose file', 'Validate rows', 'Apply import'].map((label, index) => (
          <div className={`${styles.step} ${activeStep >= index + 1 ? styles.stepActive : ''}`} key={label}>
            <span className={styles.stepNumber}>{index + 1}</span><span>{label}</span>
          </div>
        ))}
      </div>

      <div className={styles.dropzone}>
        <FileUp size={30} />
        <strong>{file ? file.name : 'Choose your roster file'}</strong>
        <p>XLSX, CSV, or JSON · Maximum 5 MB · Up to 5,000 members</p>
        <input key={completed ? 'completed' : 'ready'} className={styles.fileInput} aria-label="Roster file" type="file" accept=".xlsx,.csv,.json" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
      </div>

      <div className={styles.importActions}>
        <span className={styles.resultCount}>{completed ? 'Roster updated. Choose another file to import more members.' : valid ? 'Validation passed. Review the totals, then apply.' : 'Your roster is not changed until you apply the import.'}</span>
        <div className={styles.buttonRow}>
          <button className={`${styles.button} ${styles.secondaryButton}`} type="button" disabled={!file || busy} onClick={validate}><FileCheck2 size={15} /> Validate file</button>
          <button className={`${styles.button} ${styles.primaryButton}`} type="button" disabled={!valid || busy} onClick={apply}><Upload size={15} /> Apply import</button>
        </div>
      </div>

      {validation && validation.errors.length === 0 && <div className={styles.notice} role="status"><CheckCircle2 size={17} /><span>Ready: {validation.inserted ?? 0} new member{validation.inserted === 1 ? '' : 's'}, {validation.updated ?? 0} update{validation.updated === 1 ? '' : 's'}.</span></div>}
      {validation && validation.errors.length > 0 && <div className={styles.errorList}>{validation.errors.map((error, index) => <div className={`${styles.notice} ${styles.noticeError}`} role="alert" key={`${error.row}-${error.field}-${index}`}><AlertCircle size={17} /><span>{error.row ? `Row ${error.row}` : 'File'} — {error.field}: {error.message}</span></div>)}</div>}
      {message && <div className={`${styles.notice} ${message.includes('complete') ? '' : styles.noticeError}`} role={message.includes('complete') ? 'status' : 'alert'}>{message.includes('complete') ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<span>{message}</span></div>}
    </section>
  )
}
