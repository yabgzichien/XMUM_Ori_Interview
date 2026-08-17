import React from 'react'

/** A single shimmering placeholder block. */
export function Sk({
  w,
  h = 14,
  r,
  style,
}: {
  w?: number | string
  h?: number | string
  r?: number
  style?: React.CSSProperties
}) {
  return (
    <div
      className="sk"
      style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }}
    />
  )
}

/** The page title + subtitle block every dashboard route opens with. */
export function SkPageHeader({ titleWidth = 340 }: { titleWidth?: number }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <Sk w={titleWidth} h={30} r={9} style={{ marginBottom: '10px' }} />
      <Sk w={420} h={15} r={7} style={{ maxWidth: '100%' }} />
    </div>
  )
}

/** A card containing `rows` placeholder table rows. */
export function SkTable({ rows = 6 }: { rows?: number }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #EAEEF4',
        borderRadius: '14px',
        padding: '18px 20px',
      }}
    >
      <Sk w={180} h={16} r={7} style={{ marginBottom: '18px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <Sk w={38} h={38} r={10} style={{ flexShrink: 0 }} />
            <Sk h={13} r={6} style={{ flex: 1 }} />
            <Sk w={90} h={13} r={6} style={{ flexShrink: 0 }} />
            <Sk w={64} h={26} r={8} style={{ flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Standard wrapper: fades in only if the wait is long enough to notice. */
export function SkPage({
  children,
  maxWidth = 1440,
}: {
  children: React.ReactNode
  maxWidth?: number
}) {
  return (
    <main
      className="sk-delay"
      aria-busy="true"
      aria-label="Loading"
      style={{
        width: '100%',
        maxWidth: `${maxWidth}px`,
        margin: '0 auto',
        padding: '32px 24px 48px',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </main>
  )
}
