import { SkeletonPage, SkeletonHeader, SkeletonList } from '@/components/skeleton'

/** The default for any page under (app) without a skeleton of its own. */
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeader />
      <SkeletonList rows={4} />
    </SkeletonPage>
  )
}
