import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NavClient } from '@/app/NavClient'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('NavClient', () => {
  afterEach(cleanup)

  it('surfaces Performance Practice in both navigation menus for committee members', () => {
    render(<NavClient profile={{ role: 'committee', name: 'Aisyah' }} />)

    const practiceLinks = screen.getAllByRole('link', { name: /performance practice/i })
    expect(practiceLinks).toHaveLength(2)
    practiceLinks.forEach((link) => expect(link.getAttribute('href')).toBe('/practice'))
  })

  it('links signed-out visitors directly to public practice verification', () => {
    render(<NavClient profile={null} />)
    const practice = screen.getAllByRole('link', { name: /performance practice/i })
    expect(practice).toHaveLength(2)
    practice.forEach((link) => expect(link.getAttribute('href')).toBe('/practice'))
    expect(screen.getAllByRole('link', { name: /committee/i }).every((link) => link.getAttribute('href') === '/login')).toBe(true)
  })

  it('collapses signed-out links into a toggleable mobile menu', () => {
    const { container } = render(<NavClient profile={null} />)
    const menu = container.querySelector('.nav-mobile-menu')!
    expect(menu.classList.contains('open')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }))
    expect(menu.classList.contains('open')).toBe(true)
  })

  it('gives admins the management link', () => {
    render(<NavClient profile={{ role: 'admin', name: 'Admin' }} />)
    const links = screen.getAllByRole('link', { name: /performance practice management/i })
    expect(links).toHaveLength(2)
    links.forEach((link) => expect(link.getAttribute('href')).toBe('/admin/practice'))
  })

  it.each(['head_facilitator', 'head_gm'])('keeps %s interview access without practice management', (role) => {
    render(<NavClient profile={{ role, name: 'Head' }} />)
    expect(screen.getAllByRole('link', { name: /interview/i })[0].getAttribute('href')).toBe('/head')
    expect(screen.queryByRole('link', { name: /performance practice management/i })).toBeNull()
    expect(screen.getAllByRole('link', { name: /^performance practice$/i })[0].getAttribute('href')).toBe('/practice')
  })
})
