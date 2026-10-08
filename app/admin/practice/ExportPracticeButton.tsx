'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import styles from './practice-admin.module.css'

type Props = {
  hasGroups?: boolean
  orientation?: string
  year?: number
  className?: string
  variant?: 'primary' | 'secondary'
}

export function ExportPracticeButton({
  hasGroups = true,
  orientation = 'december',
  year = 2026,
  className,
  variant = 'secondary',
}: Props) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    if (!hasGroups || exporting) return
    setExporting(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        orientation,
        year: String(year),
      })

      const res = await fetch(`/api/export/practice?${params.toString()}`)
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || `Export failed with status ${res.status}`)
      }

      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition')
      let filename = `${orientation}_${year}_Practice_Groups_Export.xlsx`
      if (disposition) {
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;\n]+)/i)
        if (utf8Match && utf8Match[1]) {
          filename = decodeURIComponent(utf8Match[1])
        } else {
          const regularMatch = disposition.match(/filename="?([^";]+)"?/i)
          if (regularMatch && regularMatch[1]) {
            filename = decodeURIComponent(regularMatch[1])
          }
        }
      }

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to export practice groups.'
      setError(msg)
      alert(msg)
    } finally {
      setExporting(false)
    }
  }

  const variantClass = variant === 'primary' ? styles.primaryButton : styles.secondaryButton
  const buttonClasses = `${styles.button} ${variantClass} ${className ?? ''}`.trim()

  return (
    <button
      className={buttonClasses}
      type="button"
      onClick={handleExport}
      disabled={!hasGroups || exporting}
      title={!hasGroups ? 'No practice groups to export' : 'Export practice groups as Excel file'}
      aria-label="Export practice groups as Excel file"
    >
      {exporting ? (
        <>
          <Loader2 size={16} className={styles.spin} />
          <span>Exporting...</span>
        </>
      ) : (
        <>
          <FileSpreadsheet size={16} />
          <span>Export Excel</span>
        </>
      )}
    </button>
  )
}
