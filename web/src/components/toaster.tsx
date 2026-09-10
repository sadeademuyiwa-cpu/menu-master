'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { noticeTone, noticeDuration, type NoticeTone } from '@/lib/ui/notice-tone'

type Toast = { id: number; text: string; tone: NoticeTone; leaving: boolean }

/**
 * Shows the outcome of an action.
 *
 * Server actions cannot hand a value back to a plain form, so every outcome
 * already travels as ?notice= on the redirect (withNotice). This reads it and
 * shows it where the eye is after pressing a button -- the bottom of the
 * screen. The page's own inline notice, which is the durable record, is
 * untouched.
 *
 * The URL is deliberately LEFT ALONE. A first version removed ?notice= with
 * history.replaceState; Next treats that as a navigation to the bare path and
 * served it from the client router cache -- the render from BEFORE the write
 * -- so a freshly added ingredient vanished from its own list. The journey
 * caught it. A reload or back/forward simply does not replay the toast.
 */
export function Toaster() {
  const params = useSearchParams()
  const pathname = usePathname()
  const notice = params.get('notice')
  const [toasts, setToasts] = useState<Toast[]>([])

  // Once the app has navigated client-side, the document's navigation entry
  // no longer describes how the CURRENT page arrived, so the reload check
  // below stops applying.
  const navigatedSoftly = useRef(false)
  const firstPath = useRef(pathname)
  useEffect(() => {
    if (pathname !== firstPath.current) navigatedSoftly.current = true
  }, [pathname])

  useEffect(() => {
    if (!notice) return
    // The document itself arrived by reload or history traversal: the inline
    // notice is still on the page, and re-announcing it would be noise.
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav && nav.type !== 'navigate' && !navigatedSoftly.current) return

    const id = Date.now()
    const tone = noticeTone(notice)
    setToasts((t) => [...t, { id, text: notice, tone, leaving: false }])

    const leave = setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)))
    }, noticeDuration(tone))
    const gone = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
    }, noticeDuration(tone) + 300)
    return () => { clearTimeout(leave); clearTimeout(gone) }
  }, [notice, pathname])

  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div key={t.id} className="mm-toast" data-tone={t.tone} data-leaving={t.leaving || undefined} role="status">
          <span className="flex-1">{t.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="mm-tap -my-2 -mr-2 px-2 text-base leading-none"
            style={{ color: 'var(--mm-muted)' }}
            onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
