'use client'

import React, { useEffect, useState } from 'react'
import { useTheme } from './ThemeProvider'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle({
  mobile = false,
  className = '',
}: {
  mobile?: boolean
  className?: string
}) {
  const { theme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    if (mobile) {
      return (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: '9px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '14.5px',
            fontWeight: 600,
            opacity: 0.5,
          }}
        >
          <span>Appearance</span>
          <span style={{ width: '20px', height: '20px' }} />
        </div>
      )
    }

    return (
      <button
        type="button"
        disabled
        aria-label="Toggle theme"
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '9px',
          border: '1px solid var(--border-input, #E2E8F0)',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.5,
          cursor: 'pointer',
        }}
      >
        <span style={{ width: '18px', height: '18px' }} />
      </button>
    )
  }

  const isDark = theme === 'dark'

  if (mobile) {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={`theme-toggle-mobile ${className}`}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderRadius: '9px',
          border: '1px solid var(--border-input, #E2E8F0)',
          background: 'var(--bg-card-subtle, #F8FAFC)',
          color: 'var(--text-primary, #334155)',
          fontWeight: 600,
          fontSize: '14.5px',
          cursor: 'pointer',
          textAlign: 'left',
          marginTop: '4px',
        }}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isDark ? (
            <Sun size={17} style={{ color: '#FBBF24' }} />
          ) : (
            <Moon size={17} style={{ color: '#6366F1' }} />
          )}
          <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </span>
        <span
          style={{
            fontSize: '11.5px',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: '99px',
            background: isDark ? '#334155' : '#E2E8F0',
            color: isDark ? '#F1F5F9' : '#475569',
          }}
        >
          {isDark ? 'ON' : 'OFF'}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`theme-toggle-btn ${className}`}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '9px',
        border: '1px solid var(--border-input, #E2E8F0)',
        background: isDark ? '#1E293B' : '#ffffff',
        color: isDark ? '#FBBF24' : '#64748B',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
    >
      {isDark ? (
        <Sun size={18} style={{ color: '#FBBF24' }} />
      ) : (
        <Moon size={18} style={{ color: '#475569' }} />
      )}
    </button>
  )
}
