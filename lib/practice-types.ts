export type PracticeGroupStatus = 'open' | 'closed'
export type PracticeSongType = 'youtube' | 'mp3' | 'external'

export type PracticeIdentityInput = {
  studentId: string
}

export type PracticeBookingInput = PracticeIdentityInput & {
  groupId: string
  holdToken?: string | null
}

export type PracticeHold = {
  token: string
  expires_at: string
}

export type PublicPracticeGroup = {
  id: string
  name: string
  status: PracticeGroupStatus
  seats_left: number
  committee_seats_left: number
  faci_gm_seats_left: number
  performance_type: string | null
  description: string | null
  songs?: string | null
  leaders: Array<{
    id: string
    name: string
    position: string
  }>
  performance_video_url: string | null
  song: {
    type: PracticeSongType
    url: string
  } | null
}

export type PracticeCatalog = {
  server_now: string
  booking_opens_at: string | null
  booking_open: boolean
  groups: PublicPracticeGroup[]
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
  leader_names?: string[]
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
  contact_number?: string | null
  active: boolean
  booking_id: string | null
  group_id: string | null
  group_name: string | null
}

export type AdminPracticeGroup = {
  id: string
  name: string
  capacity: number
  committee_capacity: number
  faci_gm_capacity: number
  status: PracticeGroupStatus
  booking_count: number
  committee_booking_count: number
  faci_gm_booking_count: number
  session_count: number
  performance_type: string | null
  description: string | null
  songs: string | null
  leader_roster_member_ids: string[]
  leader_names: string[]
  performance_video_url: string | null
  song_source_type: PracticeSongType | null
  song_url: string | null
  song_storage_path: string | null
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
  booking_opens_at: string | null
}

export type CanonicalRosterRow = {
  rowNumber: number
  name: string
  student_id: string
  position: string
  contact_number?: string
}

export type RosterImportError = {
  row: number | null
  field: 'file' | 'name' | 'student_id' | 'position' | 'contact_number'
  message: string
}

export type ImportValidation = {
  rows: CanonicalRosterRow[]
  errors: RosterImportError[]
  inserted?: number
  updated?: number
}
