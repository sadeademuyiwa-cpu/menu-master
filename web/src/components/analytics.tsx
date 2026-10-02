'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { anyAnalytics, type AnalyticsSettings } from '@/lib/site/settings'
import {
  EVENT_COOKIE, decodeQueue, googleAdsConversion, isAppEvent, metaCall,
  type AppEvent, type EventProps,
} from '@/lib/analytics/events'
import { takeEarlyEvents } from '@/lib/analytics/client'

type Consent = 'granted' | 'denied' | null
const CONSENT_KEY = 'mm_consent'

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: (...a: unknown[]) => void; push?: unknown }
type W = Window & {
  fbq?: Fbq; _fbq?: Fbq
  dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void
}

function readConsent(): Consent {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

function writeConsent(v: 'granted' | 'denied') {
  try { localStorage.setItem(CONSENT_KEY, v) } catch { /* private mode: asked again next visit */ }
}

function addScript(src: string) {
  const s = document.createElement('script')
  s.async = true
  s.src = src
  document.head.appendChild(s)
}

/** Takes the events a server action left in the cookie, and clears it. */
function takeQueued() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${EVENT_COOKIE}=([^;]*)`))
  if (!m) return []
  document.cookie = `${EVENT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`
  return decodeQueue(m[1])
}

/**
 * Advert and analytics tags, and the notice that asks first.
 *
 * Nothing loads until the visitor presses Accept (NDPA: consent before
 * non-essential cookies). With no ids set by the admin, there is no notice
 * and no tag at all. Ids reach here already checked (parseAnalytics); the
 * scripts are added as elements with those ids as plain arguments, never by
 * writing HTML.
 *
 * Privacy choices made here, not left to the tools' defaults:
 *   Meta autoConfig off  -- no automatic reading of buttons and page fields
 *   PostHog autocapture off, no session recording, anonymous visitors
 */
export function Analytics({ settings }: { settings: AnalyticsSettings }) {
  const enabled = anyAnalytics(settings)
  const [consent, setConsent] = useState<Consent>(null)
  const [asked, setAsked] = useState(false)
  const loaded = useRef(false)
  const pending = useRef<{ e: AppEvent; p: EventProps }[]>([])
  const posthog = useRef<{ capture: (e: string, p?: object) => void } | null>(null)
  const pathname = usePathname()
  // The page Meta last counted, so accepting on a page does not count it twice.
  const counted = useRef<string | null>(null)

  useEffect(() => {
    setConsent(readConsent())
    setAsked(true)
  }, [])

  const send = useCallback((e: AppEvent, p: EventProps) => {
    const w = window as W
    if (w.fbq && settings.metaPixelId) {
      const [kind, name, params] = metaCall(e, p)
      w.fbq(kind, name, params)
    }
    if (w.gtag) {
      const conv = googleAdsConversion(e, settings, p)
      if (conv) w.gtag('event', 'conversion', conv)
      if (settings.ga4Id) w.gtag('event', e, { ...p, ...(p.value !== undefined ? { currency: 'NGN' } : {}) })
    }
    posthog.current?.capture(e, p)
  }, [settings])

  const load = useCallback(async () => {
    if (loaded.current) return
    loaded.current = true
    const w = window as W

    if (settings.metaPixelId) {
      if (!w.fbq) {
        const n = function (...args: unknown[]) {
          if (n.callMethod) n.callMethod(...args)
          else n.queue!.push(args)
        } as Fbq
        n.push = n
        n.loaded = true
        n.version = '2.0'
        n.queue = []
        w.fbq = n
        w._fbq = n
        addScript('https://connect.facebook.net/en_US/fbevents.js')
      }
      w.fbq('set', 'autoConfig', false, settings.metaPixelId)
      w.fbq('init', settings.metaPixelId)
      w.fbq('track', 'PageView')
      counted.current = window.location.pathname
    }

    const tagIds = [settings.googleAdsId, settings.ga4Id].filter((x): x is string => Boolean(x))
    if (tagIds.length) {
      w.dataLayer = w.dataLayer || []
      w.gtag = function () {
        // gtag requires the arguments object itself, not an array copy.
        // eslint-disable-next-line prefer-rest-params
        w.dataLayer!.push(arguments)
      }
      w.gtag('js', new Date())
      for (const id of tagIds) w.gtag('config', id)
      addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagIds[0])}`)
    }

    if (settings.posthogKey) {
      try {
        const { default: ph } = await import('posthog-js')
        ph.init(settings.posthogKey, {
          api_host: settings.posthogHost,
          capture_pageview: 'history_change',
          autocapture: false,
          disable_session_recording: true,
          person_profiles: 'identified_only',
        })
        posthog.current = ph
      } catch {
        // blocked by an ad blocker: carry on without it
      }
    }

    const queued = pending.current.splice(0)
    for (const q of queued) send(q.e, q.p)
  }, [settings, send])

  // Consent given (now or on an earlier visit): load once.
  useEffect(() => {
    if (enabled && consent === 'granted') void load()
  }, [enabled, consent, load])

  // Events from browser code (track()) and from server actions (cookie).
  useEffect(() => {
    const handle = (d: { e?: unknown; p?: EventProps } | undefined) => {
      if (!d || !isAppEvent(d.e)) return
      if (!enabled || consent === 'denied') return
      if (loaded.current) send(d.e, d.p ?? {})
      else pending.current.push({ e: d.e, p: d.p ?? {} })
    }
    const onTrack = (ev: Event) => handle((ev as CustomEvent).detail)
    window.addEventListener('mm:track', onTrack)
    // What the page reported before this was listening (first render only).
    for (const early of takeEarlyEvents()) handle(early)
    return () => window.removeEventListener('mm:track', onTrack)
  }, [enabled, consent, send])

  // A "no" (now or remembered) drops anything waiting.
  useEffect(() => {
    if (consent === 'denied') pending.current = []
  }, [consent])

  // Moments a server action left in the cookie. Read on every page change,
  // and every two seconds as well: a server action that redirects back to
  // the SAME page (each step of setup does) changes no pathname.
  useEffect(() => {
    if (!asked) return
    const drain = () => {
      const queued = takeQueued()
      if (!enabled || consent === 'denied') return
      for (const q of queued) {
        if (loaded.current) send(q.e, q.p)
        else pending.current.push(q)
      }
    }
    drain()
    const timer = setInterval(drain, 2000)
    return () => clearInterval(timer)
  }, [pathname, asked, enabled, consent, send])

  // Meta counts the first page itself (in load); later pages are counted here.
  useEffect(() => {
    const w = window as W
    if (loaded.current && w.fbq && settings.metaPixelId && counted.current !== pathname) {
      w.fbq('track', 'PageView')
      counted.current = pathname
    }
  }, [pathname, settings.metaPixelId])

  if (!enabled || !asked || consent !== null) return null

  return (
    <div role="dialog" aria-label="Cookies" className="mm-consent">
      <p className="text-sm">
        We use cookies to see which adverts bring people to Menu Master and to make the app better.
        You can say no and still use everything. <Link href="/privacy" className="underline">Privacy policy</Link>
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="mm-btn mm-btn-primary flex-1"
                onClick={() => { writeConsent('granted'); setConsent('granted') }}>Accept</button>
        <button type="button" className="mm-btn mm-btn-secondary flex-1"
                onClick={() => { writeConsent('denied'); setConsent('denied'); pending.current = [] }}>No thanks</button>
      </div>
    </div>
  )
}
