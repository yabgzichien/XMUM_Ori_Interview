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
        <SkPageHeader titleWidth={200} />
        <Sk w={128} h={36} r={10} />
      </div>
      <SkTable rows={8} />
    </SkPage>
  )
}
