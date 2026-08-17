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
        <SkPageHeader titleWidth={320} />
        <Sk w={132} h={36} r={10} />
      </div>
      <SkTable rows={6} />
    </SkPage>
  )
}
