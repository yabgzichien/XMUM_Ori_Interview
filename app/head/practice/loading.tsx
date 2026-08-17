import { Sk, SkPage, SkPageHeader, SkTable } from '@/app/Skeleton'

export default function Loading() {
  return (
    <SkPage>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <SkPageHeader titleWidth={400} />
        <div style={{ display: 'flex', gap: '8px' }}>
          <Sk w={104} h={34} r={10} />
          <Sk w={104} h={34} r={10} />
          <Sk w={104} h={34} r={10} />
        </div>
      </div>
      <SkTable rows={6} />
    </SkPage>
  )
}
