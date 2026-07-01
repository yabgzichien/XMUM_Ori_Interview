import type { Metadata } from 'next'
import { MyBookingClient } from './MyBookingClient'

export const metadata: Metadata = {
  title: 'My Booking — XMUM Orientation',
  description: 'Look up your interview booking, view your slot details, or cancel your booking using your email and reference code.',
}

export default function MyBookingPage() {
  return <MyBookingClient />
}
