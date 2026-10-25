import { SkeletonPage, SkeletonStats, SkeletonList } from '@/components/skeleton'

// The Overview's shape while it loads: the queue, then the four figures.
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonList rows={3} />
      <SkeletonStats n={4} />
    </SkeletonPage>
  )
}
