'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from './home.module.css'

/** Slim home-page bar: see-through over the photos, solid once the hero scrolls away. */
export function HomeBar() {
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight * 0.6)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`${styles.bar} ${solid ? styles.barSolid : ''}`}>
      <Link className={styles.brand} href="/" aria-label="Vortexa home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vortexalogo.png" alt="" />
        <span>26/12 Vortexa</span>
      </Link>
      <nav className={styles.barLinks} aria-label="Main">
        <a className={styles.barLink} href="#how">How booking works</a>
      </nav>
      <Link className={`${styles.barLink} ${styles.barRight}`} href="/login">Committee</Link>
    </header>
  )
}
