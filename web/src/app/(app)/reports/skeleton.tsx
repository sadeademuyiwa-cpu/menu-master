import { SkeletonPage, SkeletonHeader, SkeletonList, Skeleton } from '@/components/skeleton'

/** The month card (a figure over its bars), then the dishes. */
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeader sub={false} />
      <div className="space-y-3 rounded border p-4" style={{ borderColor: 'var(--mm-line)' }}>
        <Skeleton w="30%" h="0.875rem" />
        <Skeleton w="55%" h="2rem" />
        <Skeleton h="140px" />
      </div>
      <SkeletonList rows={4} lines={1} />
    </SkeletonPage>
  )
}
