'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { isInternalNavigation } from '@/lib/ui/navigation-intent'

type State = 'idle' | 'busy' | 'done'

/**
 * The thin bar across the top while the next page is on its way.
 *
 * The app router has no navigation events, so this listens for the two
 * things that start one -- a click on an internal link and a form submit --
 * and treats a change of URL as the arrival. A safety timer clears a bar
 * whose navigation never produced a new URL (a refused submit that redirects
 * back to the same page with a notice does change the URL, so it completes).
 */
export function Progress() {
  const pathname = usePathname()
  const search = useSearchParams()
  const [state, setState] = useState<State>('idle')
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const start = () => {
      setState('busy')
      if (safety.current) clearTimeout(safety.current)
      safety.current = setTimeout(() => setState('idle'), 15000)
    }
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest('a')
      if (!a || e.defaultPrevented) return
      if (isInternalNavigation({
        href: a.getAttribute('href'), target: a.getAttribute('target'),
        download: a.hasAttribute('download'), button: e.button,
        modifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        origin: window.location.origin,
        current: window.location.pathname + window.location.search,
      })) start()
    }
    const onSubmit = (e: SubmitEvent) => { if (!e.defaultPrevented) start() }
    // CAPTURE phase. Next's <Link> and React's form actions call
    // preventDefault() in their own handlers, so by the bubble phase every
    // real navigation looked "already handled" and the bar never started.
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', onSubmit, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('submit', onSubmit, true)
    }
  }, [])

  // The URL changed: the page arrived. Run the bar to the end, then hide it.
  useEffect(() => {
    if (safety.current) clearTimeout(safety.current)
    setState((s) => (s === 'busy' ? 'done' : s))
    const t = setTimeout(() => setState('idle'), 350)
    return () => clearTimeout(t)
  }, [pathname, search])

  return <div className="mm-progress" data-state={state} aria-hidden />
}
