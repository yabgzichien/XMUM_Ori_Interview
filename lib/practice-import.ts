import { normalizeStudentId } from '@/lib/practice-identity'
import type { CanonicalRosterRow, ImportValidation, RosterImportError } from '@/lib/practice-types'

const REQUIRED_FIELDS = ['name', 'student_id', 'position'] as const
const OPTIONAL_FIELDS = ['contact_number'] as const
const MAX_CONTACT_LENGTH = 30
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 5000

type RawRosterRow = Record<string, unknown>
type ParsedRows = { rows: RawRosterRow[]; rowNumbers: number[] }

class RosterParseError extends Error {
  constructor(message: string, readonly row: number | null = null) {
    super(message)
  }
}

function fileError(message: string, row: number | null = null): ImportValidation {
  return { rows: [], errors: [{ row, field: 'file', message }] }
}

/** Removes a ```json fence that chat tools often wrap around their output. */
function stripCodeFence(text: string): string {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  const fenced = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/)
  return fenced ? fenced[1].trim() : trimmed
}

async function parseFile(file: File): Promise<ParsedRows | ImportValidation> {
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension !== 'json' && extension !== 'txt') throw new RosterParseError('Use JSON text or a .json/.txt file.')
  const text = stripCodeFence(await file.text())
  if (!text) throw new RosterParseError('The roster is empty.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new RosterParseError('That is not valid JSON. Paste the AI output exactly, without extra text.')
  }
  if (!Array.isArray(value)) throw new RosterParseError('JSON must be a top-level array of members.')
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return fileError(`Item ${index + 1} must be an object.`, index + 1)
    }
    const keys = Object.keys(item)
    const allowed = new Set<string>([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS])
    const hasAllRequired = REQUIRED_FIELDS.every((field) => keys.includes(field))
    if (!hasAllRequired || keys.some((key) => !allowed.has(key))) {
      return fileError(`Item ${index + 1} must contain name, student_id, and position, and may also contain contact_number.`, index + 1)
    }
  }
  return { rows: value as RawRosterRow[], rowNumbers: value.map((_, index) => index + 1) }
}

function validateRows(
  rawRows: RawRosterRow[],
  rowNumbers: number[],
  validPositions: Set<string>,
): ImportValidation {
  if (rawRows.length > MAX_ROWS) return fileError('Imports are limited to 5,000 data rows.')
  const errors: RosterImportError[] = []
  const rows: CanonicalRosterRow[] = []
  const seen = new Map<string, number>()

  rawRows.forEach((raw, index) => {
    const rowNumber = rowNumbers[index]
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const studentId = normalizeStudentId(raw.student_id)
    const position = typeof raw.position === 'string' ? raw.position.trim() : ''
    const rawContact = raw.contact_number
    const contact = typeof rawContact === 'string' ? rawContact.trim() : typeof rawContact === 'number' ? String(rawContact) : ''
    if (rawContact != null && typeof rawContact !== 'string' && typeof rawContact !== 'number') {
      errors.push({ row: rowNumber, field: 'contact_number', message: 'Contact number must be text.' })
    } else if (contact.length > MAX_CONTACT_LENGTH) {
      errors.push({ row: rowNumber, field: 'contact_number', message: `Contact number must be ${MAX_CONTACT_LENGTH} characters or fewer.` })
    }
    if (!name) errors.push({ row: rowNumber, field: 'name', message: 'Name is required.' })
    if (!studentId) errors.push({ row: rowNumber, field: 'student_id', message: 'Enter a valid student ID.' })
    if (!position || !validPositions.has(position)) {
      errors.push({ row: rowNumber, field: 'position', message: 'Choose a configured committee position.' })
    }
    if (studentId) {
      const firstRow = seen.get(studentId)
      if (firstRow !== undefined) {
        errors.push({ row: rowNumber, field: 'student_id', message: `Duplicate student ID; first used on row ${firstRow}.` })
      } else {
        seen.set(studentId, rowNumber)
      }
    }
    if (name && studentId && position && validPositions.has(position)) {
      rows.push({ rowNumber, name, student_id: studentId, position, ...(contact ? { contact_number: contact } : {}) })
    }
  })

  return errors.length > 0 ? { rows: [], errors } : { rows, errors: [] }
}

export async function parsePracticeRosterFile(
  file: File,
  validPositions: Set<string>,
): Promise<ImportValidation> {
  if (file.size > MAX_FILE_BYTES) return fileError('The roster must be 5 MB or smaller.')
  try {
    const parsed = await parseFile(file)
    if ('errors' in parsed) return parsed
    return validateRows(parsed.rows, parsed.rowNumbers, validPositions)
  } catch (error) {
    return fileError(
      error instanceof RosterParseError ? error.message : 'The roster could not be read. Check that it is valid JSON.',
      error instanceof RosterParseError ? error.row : null,
    )
  }
}
