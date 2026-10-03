import { SkeletonPage, SkeletonHeader, SkeletonList } from '@/components/skeleton'

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeader />
      <SkeletonList rows={6} />
    </SkeletonPage>
  )
}
