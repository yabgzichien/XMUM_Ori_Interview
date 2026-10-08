import type React from 'react'

// Shared with the other admin screens so every form control on /admin* looks the same.
export const fieldLabelStyle: React.CSSProperties = {
  fontSize: '12.5px',
  fontWeight: 600,
  color: 'var(--text-secondary, #334155)',
  marginBottom: '5px',
  display: 'block',
}

export const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border-input, #E2E8F0)',
  borderRadius: '9px',
  fontSize: '14px',
  fontFamily: 'inherit',
  color: 'var(--text-primary, #475569)',
  backgroundColor: 'var(--bg-input, #fff)',
}
