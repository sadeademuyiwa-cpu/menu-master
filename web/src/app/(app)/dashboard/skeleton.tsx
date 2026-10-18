import { SkeletonPage, Skeleton } from '@/components/skeleton'

/**
 * Home while its data streams in, in Home's own shape: the two buttons, the
 * week's figure and its bars, a few "Needs you" rows and the dish grid. The
 * same two columns from lg as the page, so nothing jumps when it arrives.
 */
export default function Loading() {
  return (
    <SkeletonPage>
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="grid gap-2 sm:grid-cols-2 lg:col-span-2">
          <Skeleton h="46px" />
          <Skeleton h="46px" />
        </div>
        <div className="space-y-5">
          <div className="mm-card space-y-2">
            <Skeleton w="45%" h="0.875rem" />
            <Skeleton w="60%" h="2.25rem" />
            <Skeleton w="35%" h="0.8rem" />
            <div className="flex h-[132px] items-end gap-3 pt-4">
              {[40, 65, 30, 80, 55, 90, 45].map((h, i) => (
                <Skeleton key={i} h={`${h}%`} className="flex-1" />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton w="30%" h="1.25rem" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="mm-card flex items-center gap-3">
                <Skeleton w="40px" h="40px" />
                <div className="flex-1 space-y-2">
                  <Skeleton w="60%" h="1rem" />
                  <Skeleton w="35%" h="0.8rem" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div className="space-y-3">
            <Skeleton w="35%" h="1.25rem" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="space-y-2 rounded-2xl border p-2" style={{ borderColor: 'var(--mm-line)' }}>
                  <Skeleton h="auto" className="aspect-[4/3]" />
                  <Skeleton w="75%" h="0.9rem" />
                  <Skeleton w="50%" h="0.8rem" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonPage>
  )
}
