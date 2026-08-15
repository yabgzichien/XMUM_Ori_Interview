'use client'

import { useMemo, useState } from 'react'

type Props = {
  /** Selected dates as local 'YYYY-MM-DD' strings. */
  value: string[]
  /**
   * A `useState` setter, not a plain callback: every update below is
   * functional, so two clicks batched into one render can't drop a selection
   * by both computing from the same stale `value`.
   */
  onChange: React.Dispatch<React.SetStateAction<string[]>>
  /** Dates before this are not selectable. Defaults to today. */
  minDate?: Date
  /** Optional per-date annotation shown as a dot under the day number. */
  markedDates?: Set<string>
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function toIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const navBtnStyle: React.CSSProperties = {
  border: 'none',
  background: '#F1F5F9',
  borderRadius: '8px',
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: '#475569',
  fontSize: '14px',
}

/**
 * Inline calendar for picking any number of individual dates. Clicking a day
 * toggles it, so building "every weekday next week" is a handful of clicks
 * instead of re-opening a native date input once per date.
 */
export function MultiDatePicker({ value, onChange, minDate, markedDates }: Props) {
  const min = useMemo(() => {
    const d = minDate ? new Date(minDate) : startOfToday()
    d.setHours(0, 0, 0, 0)
    return d
  }, [minDate])

  const [view, setView] = useState(() => {
    // Open on the month of the first selection so an edit lands in context.
    const anchor = value.length > 0 ? new Date(`${[...value].sort()[0]}T00:00:00`) : min
    return { month: anchor.getMonth(), year: anchor.getFullYear() }
  })

  const selected = useMemo(() => new Set(value), [value])

  const cells = useMemo(() => {
    const { month, year } = view
    const leading = new Date(year, month, 1).getDay()
    const days = new Date(year, month + 1, 0).getDate()
    const out: (Date | null)[] = Array.from({ length: leading }, () => null)
    for (let day = 1; day <= days; day++) out.push(new Date(year, month, day))
    return out
  }, [view])

  function shiftMonth(delta: number) {
    setView((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1)
      return { month: next.getMonth(), year: next.getFullYear() }
    })
  }

  function toggle(date: Date) {
    const iso = toIso(date)
    onChange((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()))
  }

  /** Select or clear every remaining weekday (Mon–Fri) in the visible month. */
  function toggleWeekdaysInView() {
    const weekdays = cells
      .filter((d): d is Date => d !== null && d >= min && d.getDay() !== 0 && d.getDay() !== 6)
      .map(toIso)
    if (weekdays.length === 0) return
    onChange((prev) =>
      weekdays.every((d) => prev.includes(d))
        ? prev.filter((d) => !weekdays.includes(d))
        : Array.from(new Set([...prev, ...weekdays])).sort(),
    )
  }

  const todayIso = toIso(startOfToday())

  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: '12px', padding: '14px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <button type="button" onClick={() => shiftMonth(-1)} style={navBtnStyle} aria-label="Previous month">&larr;</button>
        <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>
          {MONTH_NAMES[view.month]} {view.year}
        </span>
        <button type="button" onClick={() => shiftMonth(1)} style={navBtnStyle} aria-label="Next month">&rarr;</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '6px' }}>
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} style={{ fontSize: '10.5px', fontWeight: 700, color: '#94A3B8', textAlign: 'center' }}>
            {label}
          </span>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {cells.map((date, idx) => {
          if (!date) return <div key={`pad-${idx}`} style={{ height: '34px' }} />
          const iso = toIso(date)
          const isSelected = selected.has(iso)
          const isDisabled = date < min
          const isToday = iso === todayIso
          const isMarked = markedDates?.has(iso) ?? false
          return (
            <button
              key={iso}
              type="button"
              disabled={isDisabled}
              onClick={() => toggle(date)}
              aria-pressed={isSelected}
              title={isMarked ? 'Already has slots' : undefined}
              style={{
                height: '34px',
                border: isSelected ? '1px solid #2563EB' : '1px solid transparent',
                background: isSelected ? '#2563EB' : isDisabled ? 'transparent' : '#F8FAFC',
                color: isSelected ? '#fff' : isDisabled ? '#CBD5E1' : '#334155',
                borderRadius: '9px',
                fontSize: '12.5px',
                fontWeight: isSelected || isToday ? 700 : 500,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                transition: 'background .12s, color .12s',
                boxShadow: isToday && !isSelected ? 'inset 0 0 0 1px #94A3B8' : 'none',
              }}
            >
              {date.getDate()}
              <span
                style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '99px',
                  background: isMarked ? (isSelected ? '#BFDBFE' : '#F59E0B') : 'transparent',
                }}
              />
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #F1F5F9' }}>
        <button
          type="button"
          onClick={toggleWeekdaysInView}
          style={{ border: 'none', background: 'transparent', color: '#2563EB', fontSize: '12px', fontWeight: 700, cursor: 'pointer', padding: '2px 0' }}
        >
          Toggle weekdays
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={value.length === 0}
          style={{
            border: 'none',
            background: 'transparent',
            color: value.length === 0 ? '#CBD5E1' : '#EF4444',
            fontSize: '12px',
            fontWeight: 700,
            cursor: value.length === 0 ? 'default' : 'pointer',
            padding: '2px 0',
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}
