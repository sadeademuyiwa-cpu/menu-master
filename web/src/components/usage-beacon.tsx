'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { sendUsage } from '@/lib/usage-client'
import { helpScreenFor } from '@/lib/site/help-videos'
import { BEAT_MS, IDLE_MS, LONG_IDLE_MS, VISIT_MAX_MS, deviceFor, routePattern, withSetupStep } from '@/lib/usage'

/**
 * Tells the admin which screen a signed-in person is on (0069 fn_usage_beat):
 * one visit per screen, a beat a minute while it is showing, the running
 * total of active seconds, and the state -- active, idle (5 minutes without
 * a touch or key), hidden (phone locked or tab away), left (moved on).
 *
 * What it sends: the route PATTERN (/recipes/:id), the help-video screen key,
 * phone/tablet/desktop. Never ids, the query string, the page title or
 * anything typed. A hidden tab sends nothing more: timers there are
 * throttled and mobile browsers may never run them, so "live" is only ever
 * claimed from a showing screen. A screen left untouched for 30 minutes
 * stops beating too: open all day on a counter is not "using it". Coming
 * back after such a spell, after 30 minutes hidden, on a new day or after 12
 * hours on one visit starts a fresh visit, so a visit is one sitting. Nothing
 * is sent until she has seen the notice that this happens (lib/usage-notice.ts).
 * Any error is ignored -- this must never get in anyone's way.
 *
 * The session id lives in memory only (no cookie, no storage): one page load.
 */
const session = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null

type Visit = {
  id: string; screen: string | null; path: string; openedAt: number
  activeMs: number; since: number | null; lastInput: number; hiddenAt: number | null; state: string
}

const now = () => Date.now()
// Active time runs from `since` to the last touch plus one beat of grace, so
// minutes of looking count and an untouched spell does not.
const activeEnd = (v: Visit) => Math.min(now(), v.lastInput + BEAT_MS)
const activeSeconds = (v: Visit) => Math.round((v.activeMs + (v.since !== null ? Math.max(0, activeEnd(v) - v.since) : 0)) / 1000)
const pause = (v: Visit) => { if (v.since !== null) { v.activeMs += Math.max(0, activeEnd(v) - v.since); v.since = null } }

function send(v: Visit, state: string) {
  if (!session) return
  v.state = state
  const device = deviceFor(window.innerWidth, window.innerHeight, window.matchMedia?.('(pointer: coarse)').matches ?? false)
  // keepalive (lib/usage-client.ts): the beat sent as the page hides or moves
  // on still arrives.
  sendUsage('fn_usage_beat', {
    p_id: v.id, p_session: session, p_screen: v.screen, p_path: v.path,
    p_device: device, p_active: activeSeconds(v), p_state: state,
  })
}

/** A new visit, opened because she is on the screen now (never from the timer alone). */
function open(screen: string | null, path: string, lastInput = now()): Visit {
  const shown = document.visibilityState === 'visible'
  const v: Visit = {
    id: crypto.randomUUID(), screen, path, openedAt: now(),
    activeMs: 0, since: shown ? now() : null, lastInput, hiddenAt: shown ? null : now(), state: shown ? 'active' : 'hidden',
  }
  if (shown) send(v, 'active')
  return v
}

const lagosDay = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
/** Twelve hours on one visit, or a new day: time for a fresh one. */
const overdue = (v: Visit) => now() - v.openedAt > VISIT_MAX_MS || lagosDay(now()) !== lagosDay(v.openedAt)

/**
 * She is back after a spell away (or the visit has run long): close the old
 * visit -- with a "left" only if it was in use, since a beat stamps it as
 * seen now -- and open a fresh one.
 */
function resume(v: Visit): Visit {
  const inUse = v.hiddenAt === null && now() - v.lastInput <= LONG_IDLE_MS
  if (inUse) { pause(v); send(v, 'left') }
  return open(v.screen, v.path)
}

/** Setup is one address with several steps; the page marks the one it shows. */
const pageStep = () => document.querySelector('[data-setup-step]')?.getAttribute('data-setup-step') ?? null

/** Rendered inside <Suspense> by the layouts: it reads the query for setup's ?step=. */
export function UsageBeacon() {
  const pathname = usePathname() ?? '/'
  const stepParam = useSearchParams()?.get('step') ?? null
  // Setup returns to plain /start after each step, so the step is watched on
  // the page itself, not read from the address.
  const [shownStep, setShownStep] = useState<string | null>(null)
  const visit = useRef<Visit | null>(null)

  useEffect(() => {
    if (routePattern(pathname) !== '/start') return
    const read = () => setShownStep(pageStep())
    read()
    const watch = new MutationObserver(read)
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-setup-step'] })
    return () => watch.disconnect()
  }, [pathname])

  // A different screen: close the last visit, open this one. The same screen
  // again (a refresh of its data, a ?notice=) keeps its visit.
  useEffect(() => {
    if (!session) return
    const step = stepParam ?? shownStep ?? (routePattern(pathname) === '/start' ? pageStep() : null)
    const path = withSetupStep(routePattern(pathname), step)
    const last = visit.current
    if (last?.path === path) return
    if (last) { pause(last); send(last, 'left') }
    visit.current = open(helpScreenFor(pathname), path)
  }, [pathname, stepParam, shownStep])

  // Leaving this layout (setup -> the app) closes the visit; the next
  // layout's beacon opens its own, in the same session.
  useEffect(() => () => {
    const v = visit.current
    if (v) { pause(v); send(v, 'left') }
    visit.current = null
  }, [])

  // One beat a minute while the screen shows; idle, hidden and back again.
  useEffect(() => {
    if (!session) return
    const onInput = () => {
      const v = visit.current
      if (!v) return
      if (now() - v.lastInput > LONG_IDLE_MS || overdue(v)) { visit.current = resume(v); return }
      // back after a short spell untouched: the spell is not active time
      if (v.since !== null && now() - v.lastInput > BEAT_MS) { pause(v); v.since = now() }
      v.lastInput = now()
      if (v.state === 'idle' && document.visibilityState === 'visible') { v.since = now(); send(v, 'active') }
    }
    const onVisibility = () => {
      const v = visit.current
      if (!v) return
      if (document.visibilityState === 'hidden') { pause(v); v.hiddenAt = now(); send(v, 'hidden'); return }
      // shown again: after 30 minutes away, or on another day, a fresh visit
      if (v.hiddenAt !== null && (now() - v.hiddenAt > LONG_IDLE_MS || overdue(v))) { visit.current = resume(v); return }
      v.hiddenAt = null; v.since = now(); v.lastInput = now(); send(v, 'active')
    }
    const tick = setInterval(() => {
      const v = visit.current
      if (!v || document.visibilityState !== 'visible') return
      const untouched = now() - v.lastInput
      if (untouched > LONG_IDLE_MS) return            // open, not in use: stop beating
      // in use for twelve hours, or past midnight: a fresh visit, carrying
      // the last touch over (an idle screen waits for a touch instead)
      if (untouched <= IDLE_MS && overdue(v)) {
        pause(v); send(v, 'left')
        visit.current = open(v.screen, v.path, v.lastInput)
        return
      }
      if (untouched > IDLE_MS) {
        if (v.state !== 'idle') pause(v)
        send(v, 'idle')                               // still there, not using it
        return
      }
      send(v, 'active')
    }, BEAT_MS)

    document.addEventListener('visibilitychange', onVisibility)
    for (const e of ['pointerdown', 'keydown', 'scroll'] as const) window.addEventListener(e, onInput, { passive: true })
    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const e of ['pointerdown', 'keydown', 'scroll'] as const) window.removeEventListener(e, onInput)
    }
  }, [])

  return null
}
