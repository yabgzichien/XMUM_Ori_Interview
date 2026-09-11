import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/components/ThemeProvider'
import { ThemeToggle } from '@/components/ThemeToggle'

function ThemeTestHelper() {
  const { theme } = useTheme()
  return <div data-testid="current-theme">{theme}</div>
}

describe('Theme System', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('renders ThemeToggle and toggles theme on click', async () => {
    render(
      <ThemeProvider>
        <ThemeTestHelper />
        <ThemeToggle />
      </ThemeProvider>
    )

    // Initially light mode
    expect(screen.getByTestId('current-theme').textContent).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    // Find toggle button
    const toggleButton = screen.getByRole('button', { name: /switch to dark mode/i })
    expect(toggleButton).toBeDefined()

    // Click to toggle to dark mode
    await act(async () => {
      fireEvent.click(toggleButton)
    })

    expect(screen.getByTestId('current-theme').textContent).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')

    // Click again to toggle back to light mode
    const lightButton = screen.getByRole('button', { name: /switch to light mode/i })
    await act(async () => {
      fireEvent.click(lightButton)
    })

    expect(screen.getByTestId('current-theme').textContent).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('supports mobile ThemeToggle', async () => {
    render(
      <ThemeProvider>
        <ThemeTestHelper />
        <ThemeToggle mobile />
      </ThemeProvider>
    )

    const mobileButton = screen.getByRole('button', { name: /switch to dark mode/i })
    expect(mobileButton.textContent).toContain('Dark Mode')
    expect(mobileButton.textContent).toContain('OFF')

    await act(async () => {
      fireEvent.click(mobileButton)
    })

    expect(mobileButton.textContent).toContain('Light Mode')
    expect(mobileButton.textContent).toContain('ON')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
