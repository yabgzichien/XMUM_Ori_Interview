import { redirect } from 'next/navigation'
import { Bricolage_Grotesque, Fraunces } from 'next/font/google'
import { getCurrentProfile } from '@/lib/auth'
import { HomeBar } from './HomeBar'
import { HomeCarousel, type HomeSlide } from './HomeCarousel'
import { HomeIntro } from './HomeIntro'
import styles from './home.module.css'

// These faces are scoped to the home page; the rest of the site keeps its fonts.
const titleFont = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-home-title',
  display: 'swap',
})

const uiFont = Bricolage_Grotesque({
  subsets: ['latin'],
  axes: ['opsz', 'wdth'],
  variable: '--font-home-ui',
  display: 'swap',
})

// Placeholder photos and copy; swap the files in public/home and edit the text here.
const slides: HomeSlide[] = [
  {
    src: '/home/slide-1.webp',
    alt: 'Orientation committee group photo on the main stage',
    eyebrow: 'Performance Practice',
    title: 'Book your performance group',
    highlight: 'performance group',
  },
  {
    src: '/home/slide-2.webp',
    alt: 'Committee members seated in front of the Welcome XMUM backdrop',
    eyebrow: '26/12 Foundation Orientation 2026',
    title: 'Welcome to Vortexa',
    highlight: 'Vortexa',
  },
  {
    src: '/home/slide-3.webp',
    alt: 'Crowd under the Doodle Do backdrop',
    eyebrow: 'Doodle Do! · Stage night',
    title: 'One stage, every group',
    highlight: 'every group',
  },
]

export default async function Home() {
  const profile = await getCurrentProfile()

  if (profile) {
    if (profile.role === 'applicant') {
      redirect('/book')
    }

    redirect('/head')
  }

  return (
    <main className={`${titleFont.variable} ${uiFont.variable} ${styles.home}`}>
      <HomeIntro />
      <HomeBar />
      <HomeCarousel slides={slides} />

      <section className={styles.after} id="how" aria-labelledby="how-heading">
        <h2 id="how-heading">How booking works</h2>
        <div className={styles.steps}>
          <div className={styles.step}><b>Verify</b><p>Enter your student ID and confirm the name, ID and position shown back to you.</p></div>
          <div className={styles.step}><b>Choose</b><p>Pick a performance group. Your seat is held for 60 seconds.</p></div>
          <div className={styles.step}><b>Confirm</b><p>Type your student ID once more to lock the booking.</p></div>
        </div>
      </section>
    </main>
  )
}
