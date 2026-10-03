'use client'

import type { AppEvent, EventProps } from './events'

type Pending = { e: AppEvent; p: EventProps }
type W = Window & { __mmTrackReady?: boolean; __mmPending?: Pending[] }

/**
 * Report a moment from browser code (signup, checkout, receipt). It goes to
 * <Analytics/>, which forwards it only if the visitor accepted cookies and
 * only to the tools the admin switched on. Safe to call anywhere, any time:
 * with nothing listening it does nothing.
 *
 * A page's own effects run before <Analytics/> (later in the tree) has
 * started listening, so until it says it is ready, moments wait in a small
 * buffer instead of being lost.
 */
export function track(e: AppEvent, p: EventProps = {}): void {
  if (typeof window === 'undefined') return
  const w = window as W
  if (!w.__mmTrackReady) {
    (w.__mmPending ??= []).push({ e, p })
    if (w.__mmPending.length > 20) w.__mmPending.shift()
    return
  }
  window.dispatchEvent(new CustomEvent('mm:track', { detail: { e, p } }))
}

/** For <Analytics/>: start listening, and take what arrived before it did. */
export function takeEarlyEvents(): Pending[] {
  const w = window as W
  w.__mmTrackReady = true
  return (w.__mmPending ?? []).splice(0)
}
