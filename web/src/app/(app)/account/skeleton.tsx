import { SkeletonPage, SkeletonHeader, SkeletonStats, Skeleton } from '@/components/skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <Skeleton w="20%" h="0.875rem" />
      <SkeletonHeader />
      <Skeleton h="3rem" />
      <SkeletonStats n={2} />
      <SkeletonStats n={2} />
    </SkeletonPage>
  )
}
