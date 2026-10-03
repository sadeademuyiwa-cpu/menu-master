import { SkeletonPage, SkeletonHeader, SkeletonStats, SkeletonList } from '@/components/skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeader />
      <SkeletonStats />
      <SkeletonList rows={6} lines={1} />
    </SkeletonPage>
  )
}
