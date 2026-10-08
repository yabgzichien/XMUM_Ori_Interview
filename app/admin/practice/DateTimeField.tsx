'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './practice-admin.module.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MINUTE_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
const ORIENTATION_VIEW = { year: 2026, month: 11 }

type Clock = { year: number; month: number; day: number; hour: number; minute: number }
type Preset = { label: string; value: string }

const wallFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h12',
})

export function formatInstant(value: string) {
  return wallFormat.format(new Date(value))
}

export function formatDateTimeValue(value: string) {
  const clock = parseClock(value)
  if (!clock) return ''
  return wallFormat.format(new Date(clock.year, clock.month, clock.day, clock.hour, clock.minute))
}

export function addMinutesToDateTime(value: string, minutes: number) {
  const clock = parseClock(value)
  if (!clock) return ''
  const next = new Date(clock.year, clock.month, clock.day, clock.hour, clock.minute + minutes)
  return compose(next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes())
}

function parseClock(value: string): Clock | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  }
}

function compose(year: number, month: number, day: number, hour: number, minute: number) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}`
}

function to12(hour24: number) {
  return {
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    period: hour24 >= 12 ? 'pm' as const : 'am' as const,
  }
}

function to24(hour12: number, period: 'am' | 'pm') {
  if (period === 'am') return hour12 === 12 ? 0 : hour12
  return hour12 === 12 ? 12 : hour12 + 12
}

export function DateTimeField({
  label,
  ariaLabel = label,
  value,
  onChange,
  presets,
  allowClear = false,
}: {
  label: string
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  presets?: Preset[]
  allowClear?: boolean
}) {
  const dialogId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const clock = parseClock(value)
  const initial = clock ? to12(clock.hour) : { hour12: 9, period: 'am' as const }
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => clock ? { year: clock.year, month: clock.month } : ORIENTATION_VIEW)
  const [hour12, setHour12] = useState(initial.hour12)
  const [minute, setMinute] = useState(clock?.minute ?? 0)
  const [period, setPeriod] = useState<'am' | 'pm'>(initial.period)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 })
  const [placed, setPlaced] = useState(false)

  useEffect(() => {
    const next = parseClock(value)
    if (!next) return
    const parts = to12(next.hour)
    setHour12(parts.hour12)
    setMinute(next.minute)
    setPeriod(parts.period)
  }, [value])

  useEffect(() => {
    function onAnotherPicker(event: Event) {
      if ((event as CustomEvent<string>).detail !== dialogId) setOpen(false)
    }
    document.addEventListener('practice-datetime-open', onAnotherPicker)
    return () => document.removeEventListener('practice-datetime-open', onAnotherPicker)
  }, [dialogId])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPlaced(false)
      return
    }
    function place() {
      const rect = buttonRef.current?.getBoundingClientRect()
      const popover = popoverRef.current
      if (!rect || !popover) return
      const width = Math.min(320, window.innerWidth - 24)
      const height = popover.offsetHeight
      let top = rect.bottom + 8
      if (top + height > window.innerHeight - 8 && rect.top > height + 8) top = rect.top - height - 8
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
      setPosition({ top, left, width })
      setPlaced(true)
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, view.year, view.month])

  useEffect(() => {
    if (!open) return
    popoverRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
  }, [open])

  function commit(next: { year: number; month: number; day: number; hour12: number; minute: number; period: 'am' | 'pm' }) {
    onChange(compose(next.year, next.month, next.day, to24(next.hour12, next.period), next.minute))
  }

  function chooseDay(year: number, month: number, day: number) {
    commit({ year, month, day, hour12, minute, period })
  }

  function changeHour(nextHour: number) {
    setHour12(nextHour)
    if (clock) commit({ ...clock, hour12: nextHour, minute, period })
  }

  function changeMinute(nextMinute: number) {
    setMinute(nextMinute)
    if (clock) commit({ ...clock, hour12, minute: nextMinute, period })
  }

  function changePeriod(nextPeriod: 'am' | 'pm') {
    setPeriod(nextPeriod)
    if (clock) commit({ ...clock, hour12, minute, period: nextPeriod })
  }

  function openPicker() {
    document.dispatchEvent(new CustomEvent('practice-datetime-open', { detail: dialogId }))
    const next = parseClock(value)
    setView(next ? { year: next.year, month: next.month } : ORIENTATION_VIEW)
    setOpen(true)
  }

  const leading = new Date(view.year, view.month, 1).getDay()
  const days = new Date(view.year, view.month + 1, 0).getDate()
  const cells: Array<number | null> = [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)]
  const minutes = Array.from(new Set([...MINUTE_STEPS, minute])).sort((a, b) => a - b)
  const formatted = formatDateTimeValue(value)
  const today = new Date()

  return (
    <label className={styles.label}>{label}
      <button
        ref={buttonRef}
        className={`${styles.dateField} ${formatted ? '' : styles.dateFieldEmpty}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={formatted ? `${ariaLabel}, ${formatted}` : ariaLabel}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>{formatted || 'Choose date and time'}</span>
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          id={dialogId}
          className={styles.datePopover}
          role="dialog"
          aria-label={ariaLabel}
          style={{ top: position.top, left: position.left, width: position.width, visibility: placed ? 'visible' : 'hidden' }}
        >
          <div className={styles.calendarHeader}>
            <button className={styles.calendarNav} type="button" aria-label={`${ariaLabel} previous month`} onClick={() => setView((current) => {
              const next = new Date(current.year, current.month - 1, 1)
              return { year: next.getFullYear(), month: next.getMonth() }
            })}><ChevronLeft size={16} /></button>
            <strong>{MONTHS[view.month]} {view.year}</strong>
            <button className={styles.calendarNav} type="button" aria-label={`${ariaLabel} next month`} onClick={() => setView((current) => {
              const next = new Date(current.year, current.month + 1, 1)
              return { year: next.getFullYear(), month: next.getMonth() }
            })}><ChevronRight size={16} /></button>
          </div>
          <div className={styles.calendarGrid}>
            {WEEKDAYS.map((weekday) => <span className={styles.calendarWeekday} key={weekday}>{weekday}</span>)}
            {cells.map((day, index) => day === null ? <span key={`pad-${index}`} /> : (
              <button
                key={day}
                className={`${styles.dayButton} ${clock && clock.year === view.year && clock.month === view.month && clock.day === day ? styles.dayButtonSelected : ''} ${today.getFullYear() === view.year && today.getMonth() === view.month && today.getDate() === day ? styles.dayButtonToday : ''}`}
                type="button"
                aria-pressed={Boolean(clock && clock.year === view.year && clock.month === view.month && clock.day === day)}
                aria-label={`${day} ${MONTHS[view.month]} ${view.year}`}
                onClick={() => chooseDay(view.year, view.month, day)}
              >{day}</button>
            ))}
          </div>
          <div className={styles.timeRow}>
            <label className={styles.label}>Hour
              <select className={styles.select} aria-label={`${ariaLabel} hour`} value={hour12} onChange={(event) => changeHour(Number(event.target.value))}>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
              </select>
            </label>
            <label className={styles.label}>Minute
              <select className={styles.select} aria-label={`${ariaLabel} minute`} value={minute} onChange={(event) => changeMinute(Number(event.target.value))}>
                {minutes.map((step) => <option key={step} value={step}>{String(step).padStart(2, '0')}</option>)}
              </select>
            </label>
            <div className={styles.periodToggle} role="group" aria-label={`${ariaLabel} period`}>
              <button type="button" aria-pressed={period === 'am'} onClick={() => changePeriod('am')}>AM</button>
              <button type="button" aria-pressed={period === 'pm'} onClick={() => changePeriod('pm')}>PM</button>
            </div>
          </div>
          {presets && presets.length > 0 && (
            <div className={styles.presetRow}>
              {presets.map((preset) => (
                <button key={preset.label} className={styles.presetButton} type="button" onClick={() => { onChange(preset.value); setOpen(false) }}>{preset.label}</button>
              ))}
            </div>
          )}
          {allowClear && value && (
            <button className={styles.dateClear} type="button" onClick={() => { onChange(''); setOpen(false) }}>Clear this time</button>
          )}
        </div>,
        buttonRef.current?.closest('main') ?? document.body,
      )}
    </label>
  )
}
