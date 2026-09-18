import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import localFont from 'next/font/local'
import './globals.css'
import { Nav } from '@/app/Nav'
import { ThemeProvider } from '@/components/ThemeProvider'

const fontSans = Plus_Jakarta_Sans({
  variable: '--font-sans',
  subsets: ['latin'],
})

const fontMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
})

const fontBrasika = localFont({
  src: './fonts/brasika/brasika-display-trial.otf',
  variable: '--font-brasika',
  display: 'swap',
})

const fontKarimun = localFont({
  src: './fonts/karimun/Karimun.ttf',
  variable: '--font-karimun',
  display: 'swap',
})

const fontWinkyMilky = localFont({
  src: './fonts/winky-milky/Winky-Milky.ttf',
  variable: '--font-winky-milky',
  display: 'swap',
})

const fontQuaker = localFont({
  src: './fonts/quaker/Quaker-FREE.ttf',
  variable: '--font-quaker',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Interview Booking - XMUM Orientation',
  description: 'Book interview slots for the facilitator and game master tracks.',
}

const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    }
  } catch (e) {}
})();
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable} ${fontBrasika.variable} ${fontKarimun.variable} ${fontWinkyMilky.variable} ${fontQuaker.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen flex flex-col font-sans">
        <ThemeProvider>
          <Nav />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
