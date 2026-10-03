import { SkeletonPage, SkeletonHeader, Skeleton } from '@/components/skeleton'

/** Two plan cards, side by side from sm. */
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeader />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded border p-3 space-y-3" style={{ borderColor: 'var(--mm-line)' }}>
            <Skeleton w="40%" h="1rem" />
            <Skeleton w="50%" h="1.75rem" />
            <Skeleton w="90%" h="0.875rem" />
            <Skeleton h="44px" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  )
}
