import { SkeletonPage, SkeletonHeader, SkeletonList, Skeleton } from '@/components/skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeader />
      <div className="space-y-3">
        <Skeleton w="30%" h="1rem" />
        <Skeleton h="5rem" />
        <SkeletonList rows={5} />
      </div>
    </SkeletonPage>
  )
}
