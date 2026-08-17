import { SkPage, SkPageHeader, SkTable } from '@/app/Skeleton'

/** Fallback boundary for any route without a closer `loading.tsx`. Its job is
 *  to make navigation non-blocking, so it stays intentionally generic. */
export default function Loading() {
  return (
    <SkPage maxWidth={1120}>
      <SkPageHeader titleWidth={360} />
      <SkTable rows={4} />
    </SkPage>
  )
}
