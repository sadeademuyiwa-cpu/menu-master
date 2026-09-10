import { SkeletonPage, SkeletonStats, SkeletonList } from '@/components/skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonStats n={3} />
      <SkeletonList rows={5} />
    </SkeletonPage>
  )
}
