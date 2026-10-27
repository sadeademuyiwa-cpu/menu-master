'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Reloads the page's data every `seconds` while the tab is showing, and once
 * on coming back to it -- "Live now" stays live without a reload button. A
 * hidden tab asks nothing.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter()
  const [at, setAt] = useState(() => new Date())

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') { router.refresh(); setAt(new Date()) } }
    const t = setInterval(refresh, seconds * 1000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', refresh) }
  }, [router, seconds])

  return (
    <span className="ad-small ad-muted" aria-live="off" suppressHydrationWarning>
      Updates every {seconds} seconds · last {at.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Lagos' })}
    </span>
  )
}
