import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import localFont from 'next/font/local'
import './globals.css'
import { Nav } from '@/app/Nav'

const fontSans = Inter({
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
  title: {
    default: 'Interview Booking - XMUM Orientation',
    template: '%s - XMUM Orientation',
  },
  description: 'Book interview slots for the facilitator and game master tracks.',
  icons: {
    icon: [
      { url: '/vortexalogo.png' },
      { url: '/icon.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    shortcut: '/vortexalogo.png',
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/vortexalogo.png' },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`dark ${fontSans.variable} ${fontMono.variable} ${fontBrasika.variable} ${fontKarimun.variable} ${fontWinkyMilky.variable} ${fontQuaker.variable} h-full antialiased`}
      style={{ colorScheme: 'dark' }}
    >
      <head>
        <link rel="icon" href="/vortexalogo.png" type="image/png" />
        <link rel="shortcut icon" href="/vortexalogo.png" type="image/png" />
        <link rel="apple-touch-icon" href="/vortexalogo.png" />
      </head>
      <body className="min-h-screen flex flex-col font-sans">
        <Nav />
        {children}
      </body>
    </html>
  )
}
