'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ImportValidation } from '@/lib/practice-types'
import { buildRosterAiPrompt, type RosterPromptPosition } from '@/lib/roster-ai-prompt'
import { AlertCircle, CheckCircle2, ClipboardPaste, FileCheck2, FileUp, Sparkles, Upload } from 'lucide-react'
import styles from './practice-admin.module.css'

type ImportReply = { data?: ImportValidation; error?: string }

export function RosterImportPanel({
  positions,
  onDone,
}: {
  positions: RosterPromptPosition[]
  onDone?: () => void
}) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [validatedText, setValidatedText] = useState<string | null>(null)
  const [validation, setValidation] = useState<ImportValidation | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [, setCompleted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const prompt = buildRosterAiPrompt(positions)

  function changeText(next: string, name: string | null = null) {
    setText(next)
    setFileName(name)
    setValidatedText(null)
    setValidation(null)
    setMessage(null)
    setCompleted(false)
  }

  async function readFile(file: File | null) {
    if (!file) return
    if (!/\.(json|txt)$/i.test(file.name)) return setMessage('Choose a .json or .txt file.')
    if (file.size > 5 * 1024 * 1024) return setMessage('The roster must be 5 MB or smaller.')
    changeText(await file.text(), file.name)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function paste() {
    try {
      changeText(await navigator.clipboard.readText())
    } catch {
      setMessage('Your browser blocked clipboard access. Paste into the box with Ctrl/Cmd+V instead.')
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setMessage('Could not copy automatically. Select the prompt text and copy it manually.')
    }
  }

  async function send(path: string): Promise<ImportReply> {
    const body = new FormData()
    body.set('file', new File([text], 'roster.json', { type: 'application/json' }))
    const response = await fetch(path, { method: 'POST', body })
    return response.json() as Promise<ImportReply>
  }

  async function validate() {
    if (!text.trim()) return setMessage('Paste roster JSON or choose a .json/.txt file.')
    setBusy(true)
    setMessage(null)
    setCompleted(false)
    try {
      const reply = await send('/api/admin/practice/import/validate')
      setValidation(reply.data ?? null)
      setValidatedText(reply.data && reply.data.errors.length === 0 ? text : null)
      setMessage(reply.error ?? null)
    } catch {
      setMessage('The roster could not be validated.')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!text.trim() || text !== validatedText) return
    setBusy(true)
    setMessage(null)
    try {
      const reply = await send('/api/admin/practice/import/apply')
      if (reply.error) {
        setCompleted(false)
        setMessage(reply.error)
      } else {
        setMessage('Import complete.')
        setCompleted(true)
        setText('')
        setFileName(null)
        setValidatedText(null)
        setValidation(null)
        router.refresh()
        onDone?.()
      }
    } catch {
      setMessage('The roster import could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  const valid = Boolean(text.trim() && text === validatedText && validation && validation.errors.length === 0)
  return (
    <div className={styles.importBody}>
      <p className={styles.importIntro}>Each member needs <strong>name</strong>, <strong>student_id</strong> and <strong>position</strong>. <strong>contact_number</strong> is optional.</p>
      <textarea
        className={`${styles.textarea} ${styles.jsonArea}`}
        aria-label="Roster JSON"
        spellCheck={false}
        rows={8}
        placeholder="Paste roster JSON, or choose a .json / .txt file"
        value={text}
        onChange={(event) => changeText(event.target.value)}
      />
      {fileName && <p className={styles.hint}>Loaded {fileName}</p>}
      <div className={styles.buttonRow}>
        <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={paste}><ClipboardPaste size={15} /> Paste</button>
        <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={() => fileInput.current?.click()}><FileUp size={15} /> Choose file</button>
        <button className={`${styles.button} ${styles.secondaryButton}`} type="button" title="Copy a prompt that makes ChatGPT or similar convert your Excel/CSV/PDF roster into this JSON" onClick={copyPrompt}><Sparkles size={15} /> {copied ? 'Prompt copied' : 'Copy AI prompt'}</button>
        <input ref={fileInput} hidden aria-label="Roster file" type="file" accept=".json,.txt,application/json,text/plain" onChange={(event) => readFile(event.target.files?.[0] ?? null)} />
      </div>

      <div className={styles.buttonRow}>
        <button className={`${styles.button} ${styles.secondaryButton}`} type="button" disabled={!text.trim() || busy} onClick={validate}><FileCheck2 size={15} /> Validate</button>
        <button className={`${styles.button} ${styles.primaryButton}`} type="button" disabled={!valid || busy} onClick={apply}><Upload size={15} /> Apply import</button>
      </div>

      {validation && validation.errors.length === 0 && <div className={styles.notice} role="status"><CheckCircle2 size={17} /><span>Ready: {validation.inserted ?? 0} new member{validation.inserted === 1 ? '' : 's'}, {validation.updated ?? 0} update{validation.updated === 1 ? '' : 's'}.</span></div>}
      {validation && validation.errors.length > 0 && <div className={styles.errorList}>{validation.errors.map((error, index) => <div className={`${styles.notice} ${styles.noticeError}`} role="alert" key={`${error.row}-${error.field}-${index}`}><AlertCircle size={17} /><span>{error.row ? `Item ${error.row}` : 'Roster'} — {error.field}: {error.message}</span></div>)}</div>}
      {message && <div className={`${styles.notice} ${message.includes('complete') ? '' : styles.noticeError}`} role={message.includes('complete') ? 'status' : 'alert'}>{message.includes('complete') ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<span>{message}</span></div>}
    </div>
  )
}
