export type PracticeGroupStatus = 'open' | 'closed'

export type PracticeIdentityInput = {
  studentId: string
  email: string
}

export type PracticeBookingInput = PracticeIdentityInput & {
  groupId: string
}

export type PublicPracticeGroup = {
  id: string
  name: string
  seats_left: number
}

export type PracticeSession = {
  id: string
  starts_at: string
  ends_at: string
  location: string
}

export type AdminPracticeSession = PracticeSession & {
  group_id: string
}

export type PublicPracticeBooking = {
  id: string
  group_id: string
  group_name: string
  sessions: PracticeSession[]
}

export type PracticeLookupResult =
  | { state: 'available'; groups: PublicPracticeGroup[] }
  | { state: 'booked'; booking: PublicPracticeBooking }

export type PracticeBookingResult = PublicPracticeBooking

export type PracticeApiResult<T> = {
  data: T | null
  error: string | null
  status: number
}

export type AdminRosterMember = {
  id: string
  name: string
  student_id: string
  position: string
  active: boolean
  booking_id: string | null
  group_id: string | null
  group_name: string | null
}

export type AdminPracticeGroup = {
  id: string
  name: string
  capacity: number
  status: PracticeGroupStatus
  booking_count: number
  session_count: number
}

export type AdminPracticeBooking = {
  id: string
  group_id: string
  roster_member_id: string
  member_name: string
  student_id: string
  source: 'self_service' | 'admin'
}

export type AdminPracticeSnapshot = {
  roster: AdminRosterMember[]
  groups: AdminPracticeGroup[]
  bookings: AdminPracticeBooking[]
  sessions: AdminPracticeSession[]
  positions: Array<{ value: string; label: string }>
}

export type CanonicalRosterRow = {
  rowNumber: number
  name: string
  student_id: string
  position: string
}

export type RosterImportError = {
  row: number | null
  field: 'file' | 'name' | 'student_id' | 'position'
  message: string
}

export type ImportValidation = {
  rows: CanonicalRosterRow[]
  errors: RosterImportError[]
  inserted?: number
  updated?: number
}
