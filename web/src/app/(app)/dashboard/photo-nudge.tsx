'use client'

import { useSyncExternalStore } from 'react'

const KEY = 'mm_photo_nudge'
const CHANGED = 'mm-photo-nudge-change'
/** Set on Not now, so it hides at once even where storage is refused. */
let closedHere = false

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Dismissed on this phone? Storage can be off (private mode): then it is
 *  simply asked again next time, which is harmless. */
function dismissed(): boolean {
  if (closedHere) return true
  try {
    return window.localStorage.getItem(KEY) === 'dismissed'
  } catch {
    return false
  }
}

/**
 * Home's one-time "Add photos of your best sellers". Once she taps Not now it
 * stays away on this phone. It also goes by itself once those dishes have
 * photos, because the page stops sending it.
 *
 * The server renders it hidden (it cannot read this phone's storage) and it
 * appears once the page is running, so a phone that dismissed it never sees
 * it flash.
 */
export function PhotoNudge({ title, children }: { title: string; children: React.ReactNode }) {
  const hidden = useSyncExternalStore(subscribe, dismissed, () => true)

  function dismiss() {
    closedHere = true
    try {
      window.localStorage.setItem(KEY, 'dismissed')
    } catch {
      // No storage: hidden for this visit; it may ask again on the next.
    }
    window.dispatchEvent(new Event(CHANGED))
  }

  if (hidden) return null
  return (
    <section className="mm-card space-y-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <button type="button" onClick={dismiss}
                className="inline-flex min-h-[44px] shrink-0 items-center px-2 text-sm font-semibold"
                style={{ color: 'var(--mm-muted)' }}>
          Not now
        </button>
      </div>
      {children}
    </section>
  )
}
