'use client'

import { useEffect, useState } from 'react'
import styles from './home.module.css'

export const INTRO_DONE_EVENT = 'vortexa:intro-done'
const INTRO_MS = 2100

/**
 * Logo reveal shown each time the home page is entered. The fade-out runs in CSS,
 * so the page still appears if scripts are slow; this only adds click-to-skip and
 * tells the carousel when to start.
 */
export function HomeIntro() {
  const [done, setDone] = useState(false)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => window.dispatchEvent(new Event(INTRO_DONE_EVENT)), reduce ? 0 : INTRO_MS)
    return () => window.clearTimeout(timer)
  }, [])

  function skip() {
    if (done) return
    setDone(true)
    window.dispatchEvent(new Event(INTRO_DONE_EVENT))
  }

  return (
    <div className={`${styles.intro} ${done ? styles.introDone : ''}`} onClick={skip} aria-hidden="true">
      <div className={styles.introMark}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the mask in CSS uses the same file */}
        <img src="/vortexalogo.png" alt="" />
      </div>
      <div className={styles.introSkip}>Click to skip</div>
    </div>
  )
}
