'use client'

import { useCallback, useEffect, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

type ToastState = { message: string; kind: ToastKind } | null

const PALETTE: Record<ToastKind, { bg: string; color: string; border: string }> = {
  success: { bg: '#DEF7EC', color: '#03543F', border: '#31C48D' },
  error: { bg: '#FEE2E2', color: '#991B1B', border: '#F87171' },
  info: { bg: '#EFF4FF', color: '#1E40AF', border: '#3B82F6' },
}

export function Toast({
  message,
  kind,
  onClose,
  durationMs = 4000,
}: {
  message: string
  kind: ToastKind
  onClose: () => void
  durationMs?: number
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, durationMs)
    return () => clearTimeout(timer)
  }, [onClose, durationMs])

  const palette = PALETTE[kind]

  return (
    <div
      role="status"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: '24px',
        right: '24px',
        maxWidth: 'calc(100vw - 48px)',
        background: palette.bg,
        color: palette.color,
        borderLeft: `4px solid ${palette.border}`,
        padding: '12px 20px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        zIndex: 10000,
        fontWeight: 600,
        fontSize: '14px',
        cursor: 'pointer',
        animation: 'toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <style>{`@keyframes toastSlideIn { from { transform: translateX(110%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
      {message}
    </div>
  )
}

/**
 * One transient message at a time — enough for the confirm/failure feedback
 * these dashboards need, without the weight of a global provider.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState>(null)

  const showToast = useCallback((message: string, kind: ToastKind = 'error') => {
    setToast({ message, kind })
  }, [])

  const clearToast = useCallback(() => setToast(null), [])

  const toastElement = toast ? (
    <Toast message={toast.message} kind={toast.kind} onClose={clearToast} />
  ) : null

  return { showToast, toastElement }
}
