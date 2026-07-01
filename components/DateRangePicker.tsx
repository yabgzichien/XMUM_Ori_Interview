'use client'

import { useState, useRef, useEffect, useMemo } from 'react'

export type DateRange = {
  start: Date | null
  end: Date | null
}

type Props = {
  value: DateRange
  onChange: (range: DateRange) => void
}

export function DateRangePicker({ value, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Current calendar view month/year
  const [currentView, setCurrentView] = useState(() => {
    const today = new Date()
    return { month: today.getMonth(), year: today.getFullYear() }
  })

  const [hoverDate, setHoverDate] = useState<Date | null>(null)

  // Handle click outside to close popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Month navigation helpers
  const prevMonth = () => {
    setCurrentView(prev => {
      if (prev.month === 0) return { month: 11, year: prev.year - 1 }
      return { month: prev.month - 1, year: prev.year }
    })
  }

  const nextMonth = () => {
    setCurrentView(prev => {
      if (prev.month === 11) return { month: 0, year: prev.year + 1 }
      return { month: prev.month + 1, year: prev.year }
    })
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  // Calendar grid calculation
  const calendarCells = useMemo(() => {
    const { month, year } = currentView
    const firstDayIndex = new Date(year, month, 1).getDay()
    const numDays = new Date(year, month + 1, 0).getDate()
    
    const cells: (Date | null)[] = []
    
    // Fill previous month padding cells
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(null)
    }
    
    // Fill current month days
    for (let day = 1; day <= numDays; day++) {
      cells.push(new Date(year, month, day))
    }
    
    return cells
  }, [currentView])

  const handleDayClick = (date: Date) => {
    const { start, end } = value
    
    if (!start || (start && end)) {
      // First click or reset
      onChange({ start: date, end: null })
    } else {
      // Second click
      if (date < start) {
        onChange({ start: date, end: null })
      } else {
        onChange({ start, end: date })
      }
    }
  }

  const isSelected = (date: Date) => {
    const { start, end } = value
    if (start && isSameDay(date, start)) return 'start'
    if (end && isSameDay(date, end)) return 'end'
    return null
  }

  const isInRange = (date: Date) => {
    const { start, end } = value
    
    // Checked range
    if (start && end) {
      return date > start && date < end
    }
    
    // Hovering preview range
    if (start && !end && hoverDate && date > start && date <= hoverDate) {
      return true
    }
    
    return false
  }

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate()
  }

  const formatButtonText = () => {
    const { start, end } = value
    if (!start) return 'Select date range'
    
    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    if (!end) return `${startStr} - ...`
    
    const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${startStr} - ${endStr}`
  }

  const handleClear = () => {
    onChange({ start: null, end: null })
    setIsOpen(false)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={popoverRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 14px',
          border: '1px solid #E2E8F0',
          borderRadius: '8px',
          background: '#fff',
          fontSize: '13.5px',
          fontWeight: 600,
          color: '#0F172A',
          cursor: 'pointer',
          outline: 'none',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          transition: 'all 0.15s ease',
          height: '38px',
        }}
      >
        {/* Calendar icon */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#64748B' }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <span>{formatButtonText()}</span>
        {/* Dropdown chevron */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px', color: '#94A3B8', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {/* Popover Calendar */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            background: '#fff',
            border: '1px solid #EAEEF4',
            borderRadius: '16px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.03)',
            padding: '16px',
            zIndex: 100,
            width: '280px',
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <button
              type="button"
              onClick={prevMonth}
              style={{
                border: 'none',
                background: '#F1F5F9',
                borderRadius: '6px',
                width: '26px',
                height: '26px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#475569',
              }}
            >
              &larr;
            </button>
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A' }}>
              {monthNames[currentView.month]} {currentView.year}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              style={{
                border: 'none',
                background: '#F1F5F9',
                borderRadius: '6px',
                width: '26px',
                height: '26px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#475569',
              }}
            >
              &rarr;
            </button>
          </div>

          {/* Days Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '4px' }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <span key={day} style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {day}
              </span>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {calendarCells.map((date, idx) => {
              if (!date) {
                return <div key={`empty-${idx}`} style={{ height: '30px' }} />
              }

              const selType = isSelected(date)
              const range = isInRange(date)
              const isToday = isSameDay(date, new Date())

              let bg = 'transparent'
              let color = '#334155'
              let borderRadius = '6px'

              if (selType) {
                bg = '#2563EB'
                color = '#fff'
                borderRadius = selType === 'start' ? '12px 0 0 12px' : '0 12px 12px 0'
                if (selType === 'start' && !value.end) {
                  borderRadius = '12px'
                }
              } else if (range) {
                bg = '#EFF6FF'
                color = '#2563EB'
                borderRadius = '0'
              }

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => handleDayClick(date)}
                  onMouseEnter={() => setHoverDate(date)}
                  onMouseLeave={() => setHoverDate(null)}
                  style={{
                    height: '30px',
                    width: '100%',
                    border: 'none',
                    background: bg,
                    color: color,
                    borderRadius: borderRadius,
                    fontSize: '12px',
                    fontWeight: selType || isToday ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                    boxShadow: isToday && !selType ? 'inset 0 0 0 1px #CBD5E1' : 'none',
                  }}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>

          {/* Footer actions */}
          {(value.start || value.end) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #F1F5F9' }}>
              <button
                type="button"
                onClick={handleClear}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#EF4444',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{
                  border: 'none',
                  background: '#2563EB',
                  color: '#fff',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '5px 12px',
                }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
