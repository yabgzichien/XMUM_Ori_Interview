'use client'

import Image from 'next/image'
import { useEffect, useId, useState } from 'react'
import { INTRO_DONE_EVENT } from './HomeIntro'
import { PracticeEntryButton } from './PracticeEntryButton'
import styles from './home.module.css'

export type HomeSlide = {
  src: string
  alt: string
  eyebrow: string
  title: string
  /** The part of the title painted with the stage gradient. */
  highlight: string
}

// Slides advance when the active dot's ring animation finishes, so pausing the
// animation pauses the carousel and reduced-motion users get no autoplay.
export function HomeCarousel({ slides }: { slides: HomeSlide[] }) {
  const gradientId = useId()
  const [index, setIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const start = () => setRunning(true)
    window.addEventListener(INTRO_DONE_EVENT, start)
    return () => window.removeEventListener(INTRO_DONE_EVENT, start)
  }, [])

  const slide = slides[index]
  const titleStart = slide.title.indexOf(slide.highlight)

  return (
    <section
      className={`${styles.hero} ${running ? styles.running : ''} ${paused ? styles.paused : ''}`}
      aria-roledescription="carousel"
      aria-label="Orientation highlights"
    >
      {slides.map((item, i) => (
        <div key={item.src} className={`${styles.slide} ${i === index ? styles.slideActive : ''}`} aria-hidden={i !== index}>
          <Image src={item.src} alt={item.alt} fill sizes="100vw" priority={i === 0} />
        </div>
      ))}
      <div className={styles.shade} />

      <div className={styles.copy}>
        <div key={index} className={styles.copyText} aria-live="polite">
          <div className={styles.eyebrow}>{slide.eyebrow}</div>
          <h1 className={styles.title}>
            {titleStart < 0 ? slide.title : (
              <>
                {slide.title.slice(0, titleStart)}
                <em>{slide.highlight}</em>
                {slide.title.slice(titleStart + slide.highlight.length)}
              </>
            )}
          </h1>
        </div>
        <PracticeEntryButton className={styles.cta}>
          Book performance group
          <span className={styles.ctaRing}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
          </span>
        </PracticeEntryButton>
      </div>

      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0dfcfd" />
            <stop offset=".5" stopColor="#e0b4fc" />
            <stop offset="1" stopColor="#fe06ab" />
          </linearGradient>
        </defs>
      </svg>
      <div className={styles.dots} role="tablist" aria-label="Choose slide">
        {slides.map((item, i) => (
          <button
            key={item.src}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Slide ${i + 1} of ${slides.length}`}
            className={`${styles.dot} ${i === index ? styles.dotActive : ''}`}
            onClick={() => setIndex(i)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle
                // Remount on every slide change so the ring animation restarts.
                key={`${i}-${index}`}
                cx="12"
                cy="12"
                r="10"
                stroke={`url(#${gradientId})`}
                onAnimationEnd={() => { if (i === index) setIndex((index + 1) % slides.length) }}
              />
            </svg>
          </button>
        ))}
      </div>

      <button className={styles.pause} type="button" aria-label={paused ? 'Play slideshow' : 'Pause slideshow'} onClick={() => setPaused((value) => !value)}>
        {paused ? (
          <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1.8v8.4c0 .5.5.8.9.5l6.6-4.2c.4-.2.4-.8 0-1L3.9 1.3c-.4-.3-.9 0-.9.5z" /></svg>
        ) : (
          <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9" rx=".6" /><rect x="7.4" y="1.5" width="2.6" height="9" rx=".6" /></svg>
        )}
      </button>
    </section>
  )
}
