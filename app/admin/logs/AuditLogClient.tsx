'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  listAuditLog,
  actionLabel,
  actionStyle,
  actorBadge,
  auditTableLabel,
  diffRows,
  formatAbsolute,
  formatRelative,
  AUDIT_TABLES,
  AUDIT_PAGE_SIZE,
  type AuditAction,
  type AuditEntry,
} from '@/lib/auditLog'
import { fieldLabelStyle, fieldStyle } from '@/app/admin/AdminStaff'

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #EAEEF4',
  borderRadius: '18px',
  boxShadow: '0 1px 2px rgba(16,24,40,.04)',
  overflow: 'hidden',
}

const cardHeaderStyle: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid #EAEEF4',
  background: '#F8FAFC',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}

const thStyle: React.CSSProperties = {
  padding: '16px 20px',
  fontSize: '12.5px',
  fontWeight: 600,
  color: '#64748B',
  letterSpacing: '.02em',
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  padding: '4px 10px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 700,
  width: 'fit-content',
}

const monoStyle: React.CSSProperties = {
  fontSize: '12.5px',
  fontFamily: 'var(--font-jetbrains-mono, monospace)',
  background: '#F1F5F9',
  padding: '2px 6px',
  borderRadius: '4px',
  color: '#0F172A',
}

/** `datetime-local` gives a value with no zone; treat it as local wall time. */
function localInputToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function AuditLogClient() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [action, setAction] = useState<AuditAction | 'all'>('all')
  const [table, setTable] = useState<string>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // First page. Any filter change re-runs this and discards the previous pages.
  useEffect(() => {
    let active = true

    async function run() {
      setLoading(true)
      const { data, hasMore: more, error } = await listAuditLog({
        search: debouncedSearch,
        action,
        table,
        from: localInputToIso(from),
        to: localInputToIso(to),
      })
      if (!active) return
      setLoading(false)
      setExpandedId(null)
      if (error) {
        setLoadError(error.message)
        setEntries([])
        setHasMore(false)
        return
      }
      setLoadError(null)
      setEntries(data ?? [])
      setHasMore(more)
    }

    run()
    return () => {
      active = false
    }
  }, [debouncedSearch, action, table, from, to, reloadToken])

  async function loadMore() {
    setLoadingMore(true)
    const { data, hasMore: more, error } = await listAuditLog({
      search: debouncedSearch,
      action,
      table,
      from: localInputToIso(from),
      to: localInputToIso(to),
      offset: entries.length,
    })
    setLoadingMore(false)
    if (error) {
      setLoadError(error.message)
      return
    }
    setEntries((prev) => [...prev, ...(data ?? [])])
    setHasMore(more)
  }

  const filtersActive =
    debouncedSearch !== '' || action !== 'all' || table !== 'all' || from !== '' || to !== ''

  function clearFilters() {
    setSearch('')
    setDebouncedSearch('')
    setAction('all')
    setTable('all')
    setFrom('')
    setTo('')
  }

  function toggleExpanded(id: number) {
    setExpandedId((current) => (current === id ? null : id))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Filters */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <span style={{ fontSize: '16px' }}>🔎</span>
          <h2 style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', margin: 0 }}>Search the log</h2>
        </div>
        <div style={{ padding: '18px 20px' }}>
          <div className="bookings-filter-bar" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 260px' }}>
              <label style={fieldLabelStyle} htmlFor="audit-search">Person or action</label>
              <input
                id="audit-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. Alice Tan, or interview booking"
                style={fieldStyle}
              />
            </div>
            <div style={{ flex: '0 1 160px' }}>
              <label style={fieldLabelStyle} htmlFor="audit-action">Action</label>
              <select
                id="audit-action"
                value={action}
                onChange={(e) => setAction(e.target.value as AuditAction | 'all')}
                style={fieldStyle}
              >
                <option value="all">All actions</option>
                <option value="insert">Created</option>
                <option value="update">Changed</option>
                <option value="delete">Deleted</option>
              </select>
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <label style={fieldLabelStyle} htmlFor="audit-table">Area</label>
              <select
                id="audit-table"
                value={table}
                onChange={(e) => setTable(e.target.value)}
                style={fieldStyle}
              >
                <option value="all">All areas</option>
                {AUDIT_TABLES.map((t) => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '0 1 190px' }}>
              <label style={fieldLabelStyle} htmlFor="audit-from">From</label>
              <input id="audit-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} style={fieldStyle} />
            </div>
            <div style={{ flex: '0 1 190px' }}>
              <label style={fieldLabelStyle} htmlFor="audit-to">To</label>
              <input id="audit-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} style={fieldStyle} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '14px' }}>
            <button
              type="button"
              onClick={reload}
              style={{ padding: '9px 14px', borderRadius: '9px', border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontWeight: 700, fontSize: '13.5px', cursor: 'pointer' }}
            >
              Refresh
            </button>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                style={{ padding: 0, border: 'none', background: 'none', color: '#2563EB', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <span style={{ fontSize: '16px' }}>🧾</span>
          <h2 style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', margin: 0 }}>Activity</h2>
          {!loading && !loadError && (
            <span style={{ marginLeft: 'auto', fontSize: '12.5px', color: '#94A3B8', fontWeight: 600 }}>
              {entries.length}{hasMore ? '+' : ''} {entries.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>

        {loading && <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>}
        {loadError && <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{loadError}</div>}

        {!loading && !loadError && entries.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
            {filtersActive ? 'No activity matches these filters.' : 'No activity recorded yet.'}
          </div>
        )}

        {!loading && !loadError && entries.length > 0 && (
          <div style={{ width: '100%' }}>
            {/* Desktop table. The mobile card list below is toggled by the
                shared .tbl-desk/.tbl-mob rules in globals.css. */}
            <table className="tbl-desk" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #EAEEF4' }}>
                  <th style={{ ...thStyle, width: '160px' }}>When</th>
                  <th style={{ ...thStyle, width: '260px' }}>Who</th>
                  <th style={thStyle}>What</th>
                  <th style={{ padding: '16px 20px', width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const badge = actorBadge(entry)
                  const act = actionStyle(entry.action)
                  const expanded = expandedId === entry.id
                  return (
                    <Fragment key={entry.id}>
                    <tr style={{ borderBottom: expanded ? 'none' : '1px solid #EAEEF4' }}>
                      <td style={{ padding: '18px 20px', verticalAlign: 'top' }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>{formatRelative(entry.occurred_at)}</div>
                        <div style={{ fontSize: '12.5px', color: '#94A3B8', marginTop: '2px' }}>{formatAbsolute(entry.occurred_at)}</div>
                      </td>
                      <td style={{ padding: '18px 20px', verticalAlign: 'top' }}>
                        <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', marginBottom: '2px' }}>{entry.actor_name}</div>
                        {entry.actor_email && (
                          <div style={{ fontSize: '13px', color: '#64748B', fontWeight: 500, marginBottom: '6px' }}>{entry.actor_email}</div>
                        )}
                        <span style={{ ...pillStyle, background: badge.bg, color: badge.fg }}>{badge.text}</span>
                      </td>
                      <td style={{ padding: '18px 20px', verticalAlign: 'top' }}>
                        <div style={{ fontSize: '14px', color: '#475569', marginBottom: '8px' }}>{entry.summary}</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ ...pillStyle, background: act.bg, color: act.fg }}>{actionLabel(entry.action)}</span>
                          <span style={{ ...pillStyle, background: '#F1F5F9', color: '#475569' }}>{auditTableLabel(entry.table_name)}</span>
                        </div>
                      </td>
                      <td style={{ padding: '18px 20px', textAlign: 'right', verticalAlign: 'top' }}>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(entry.id)}
                          aria-expanded={expanded}
                          aria-label={expanded ? 'Hide details' : 'Show details'}
                          style={{ border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', borderRadius: '8px', padding: '4px 9px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                        >
                          {expanded ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr style={{ borderBottom: '1px solid #EAEEF4' }}>
                        <td colSpan={4} style={{ padding: '0 20px 18px' }}>
                          <DetailPanel entry={entry} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile list */}
            <div className="tbl-mob">
              {entries.map((entry) => {
                const badge = actorBadge(entry)
                const act = actionStyle(entry.action)
                const expanded = expandedId === entry.id
                return (
                  <div key={entry.id} style={{ borderBottom: '1px solid #EAEEF4', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0F172A', lineHeight: 1.4 }}>{entry.summary}</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ ...pillStyle, background: act.bg, color: act.fg }}>{actionLabel(entry.action)}</span>
                      <span style={{ ...pillStyle, background: '#F1F5F9', color: '#475569' }}>{auditTableLabel(entry.table_name)}</span>
                      <span style={{ ...pillStyle, background: badge.bg, color: badge.fg }}>{badge.text}</span>
                    </div>
                    <div style={{ fontSize: '13.5px', color: '#475569', fontWeight: 600 }}>
                      <span style={{ color: '#94A3B8', fontWeight: 500, marginRight: '4px' }}>By:</span>
                      {entry.actor_name}
                      {entry.actor_email && <span style={{ color: '#94A3B8', fontWeight: 500 }}> · {entry.actor_email}</span>}
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>
                      {formatRelative(entry.occurred_at)} · {formatAbsolute(entry.occurred_at)}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(entry.id)}
                      aria-expanded={expanded}
                      style={{ alignSelf: 'flex-start', padding: 0, border: 'none', background: 'none', color: '#2563EB', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {expanded ? 'Hide details' : 'Details'}
                    </button>
                    {expanded && <DetailPanel entry={entry} />}
                  </div>
                )
              })}
            </div>

            {hasMore && (
              <div style={{ padding: '18px 20px', display: 'flex', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{ padding: '12px 16px', borderRadius: '9px', border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontWeight: 700, fontSize: '13.5px', cursor: 'pointer', opacity: loadingMore ? 0.7 : 1 }}
                >
                  {loadingMore ? 'Loading...' : `Load ${AUDIT_PAGE_SIZE} more`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailPanel({ entry }: { entry: AuditEntry }) {
  const rows = diffRows(entry)
  return (
    <div style={{ padding: '16px', border: '1px solid #EAEEF4', borderRadius: '12px', background: '#F8FAFC' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>
          {auditTableLabel(entry.table_name)} record
        </span>
        {entry.record_id && <span style={monoStyle}>{entry.record_id}</span>}
      </div>

      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: '12.5px', color: '#94A3B8' }}>No field detail recorded.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map((row) => (
            <div key={row.field} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span style={{ minWidth: '150px', fontSize: '12.5px', fontWeight: 700, color: '#475569' }}>{row.field}</span>
              {entry.action !== 'insert' && (
                <span style={{ fontSize: '13px', color: '#94A3B8', textDecoration: entry.action === 'update' ? 'line-through' : 'none', wordBreak: 'break-word' }}>
                  {row.before}
                </span>
              )}
              {entry.action === 'update' && <span style={{ fontSize: '12px', color: '#94A3B8' }}>→</span>}
              {entry.action !== 'delete' && (
                <span style={{ fontSize: '13px', color: '#0F172A', fontWeight: 600, wordBreak: 'break-word' }}>{row.after}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
