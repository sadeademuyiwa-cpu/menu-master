/**
 * Placeholders shaped like the page they stand in for, shown while its data
 * streams in and replaced by the real page when it arrives. Every block is
 * aria-hidden: a screen reader hears "loading", not a wall of empty boxes.
 *
 * WHERE THEY ARE USED, AND WHERE THEY MUST NOT BE
 *   Only on pages that are read-only and reached by a link -- dashboard,
 *   reports, pricing, account, subscribe, more, the admin views. Each keeps
 *   its skeleton in a plain `skeleton.tsx` module and renders its body inside
 *   an in-page <Suspense fallback={<Loading/>}>.
 *
 *   NOT on any page with a server action that redirects back to itself --
 *   every Add, Save and Record in the app -- and never as a route-level
 *   loading.tsx. Measured in the production build against the local stack
 *   (Next 15.5): with a Suspense boundary on the redirect target, the router
 *   aborts the redirect's payload and re-fetches, and intermittently the
 *   transition stalls for 7-19 s (or longer) instead of ~2 s. Without a
 *   boundary the page renders whole, React keeps the old page on screen until
 *   the new one is ready, and the progress bar shows the wait. Route-level
 *   loading.tsx files stalled every time; in-page boundaries stalled some of
 *   the time; the journey suite (web/e2e/journey.mjs) is the proof either way.
 */
export function Skeleton({ w = '100%', h = '1rem', className = '' }: {
  w?: string; h?: string; className?: string
}) {
  return <span className={`mm-skeleton ${className}`} style={{ width: w, height: h }} />
}

export function SkeletonHeader({ sub = true }: { sub?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton w="40%" h="1.5rem" />
      {sub && <Skeleton w="70%" h="0.875rem" />}
    </div>
  )
}

/** An input row, as on every add form: n fields and a button. */
export function SkeletonForm({ fields = 3 }: { fields?: number }) {
  return (
    <div className="grid gap-3 sm:items-end" style={{ gridTemplateColumns: `repeat(${Math.min(fields + 1, 5)}, minmax(0, 1fr))` }}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton w="50%" h="0.75rem" />
          <Skeleton h="44px" />
        </div>
      ))}
      <Skeleton h="44px" />
    </div>
  )
}

/** Card rows, as on every list. */
export function SkeletonList({ rows = 4, lines = 2 }: { rows?: number; lines?: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="rounded border p-3" style={{ borderColor: 'var(--mm-line)' }}>
          <div className="flex items-baseline justify-between gap-4">
            <Skeleton w="45%" h="1rem" />
            <Skeleton w="20%" h="0.875rem" />
          </div>
          {lines > 1 && <Skeleton w="60%" h="0.75rem" className="mt-2" />}
        </li>
      ))}
    </ul>
  )
}

/** The three-figure block at the top of a recipe or a report. */
export function SkeletonStats({ n = 3 }: { n?: number }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--mm-line)' }}>
          <Skeleton w="40%" h="0.75rem" />
          <Skeleton w="60%" h="1.5rem" />
        </div>
      ))}
    </div>
  )
}

/** The whole-page frame every loading.tsx uses. */
export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="space-y-8">{children}</div>
    </div>
  )
}
