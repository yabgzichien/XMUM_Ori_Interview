'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import styles from './practice-admin.module.css'

export type SearchOption = { value: string; label: string; hint?: string }

type Props = {
  value: string
  onChange: (value: string) => void
  options: SearchOption[]
  ariaLabel: string
  placeholder?: string
  /** When set, adds a first row that clears the selection. */
  emptyLabel?: string
  searchPlaceholder?: string
}

/** A select replacement with a search box, for long lists of people or titles. */
export function SearchSelect({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = 'Select…',
  emptyLabel,
  searchPlaceholder = 'Search…',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const selected = options.find((option) => option.value === value)
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(needle))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // Close only the list, not the modal around it.
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  function choose(next: string) {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={styles.ssRoot} ref={rootRef}>
      <button
        type="button"
        className={styles.ssTrigger}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? undefined : styles.ssPlaceholder}>{selected ? selected.label : (emptyLabel ?? placeholder)}</span>
        {selected?.hint && <small>{selected.hint}</small>}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.ssPanel}>
          <div className={styles.ssSearch}>
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              aria-label={`Search ${ariaLabel}`}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (matches[0]) choose(matches[0].value)
                }
              }}
            />
          </div>
          <ul className={styles.ssList} role="listbox" id={listId} aria-label={ariaLabel}>
            {emptyLabel !== undefined && !query.trim() && (
              <li role="option" aria-selected={value === ''}>
                <button type="button" className={styles.ssOption} onClick={() => choose('')}>
                  <span>{emptyLabel}</span>{value === '' && <Check size={14} aria-hidden="true" />}
                </button>
              </li>
            )}
            {matches.map((option) => (
              <li role="option" aria-selected={option.value === value} key={option.value}>
                <button type="button" className={styles.ssOption} onClick={() => choose(option.value)}>
                  <span>{option.label}{option.hint && <small>{option.hint}</small>}</span>
                  {option.value === value && <Check size={14} aria-hidden="true" />}
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className={styles.ssEmpty}>No matches</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
