import { SkPage, SkPageHeader, SkTable } from '@/app/Skeleton'

export default function Loading() {
  return (
    <SkPage maxWidth={1000}>
      <SkPageHeader titleWidth={380} />
      <SkTable rows={5} />
    </SkPage>
  )
}
