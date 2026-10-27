'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BrandMark } from '@/components/brand-mark'
import { AppIcon, type IconName } from '@/components/icons'
import { ADMIN_NAV_GROUPS, adminCrumbs, adminTitle, isCurrent, type AdminNavKey } from '@/lib/admin/nav'

export type NavCount = { n: number; tone: 'critical' | 'warn' | 'neutral'; label: string }
export type NavCounts = Partial<Record<AdminNavKey, NavCount>>

const ICONS: Record<AdminNavKey, IconName> = {
  overview: 'home',
  alerts: 'alert',
  live: 'chart',
  journeys: 'arrow-right',
  feedback: 'info',
  subscriptions: 'card',
  billing: 'money',
  signups: 'people',
  site: 'store',
  help: 'play',
}

/** The sidebar's contents: the same in the laptop sidebar and the phone menu. */
export function AdminNav({ counts, email, onNavigate }: {
  counts: NavCounts | null
  email: string | null
  onNavigate?: () => void
}) {
  const pathname = usePathname() ?? ''
  return (
    <>
      <Link href="/admin" className="ad-brand" onClick={onNavigate}>
        <BrandMark />
        <span className="ad-brand-name">Menu Master</span>
        <span className="ad-admin-tag">Admin</span>
      </Link>
      <nav aria-label="Admin" className="ad-nav">
        {ADMIN_NAV_GROUPS.map((g) => (
          <div key={g.label ?? 'top'} className="grid gap-0.5">
            {g.label && <p className="ad-nav-label">{g.label}</p>}
            {g.items.map((i) => {
              const c = counts?.[i.key]
              return (
                <Link key={i.href} href={i.href} className="ad-nav-link" onClick={onNavigate}
                      aria-current={isCurrent(i.href, pathname) ? 'page' : undefined}>
                  <AppIcon name={ICONS[i.key]} size={18} />
                  <span>{i.label}</span>
                  {c && c.n > 0 && (
                    <span className="ad-count" data-tone={c.tone === 'neutral' ? undefined : c.tone} title={c.label}>
                      {c.n}<span className="sr-only"> {c.label}</span>
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="ad-side-foot">
        {email && <p className="ad-side-who" title={email}>Signed in as {email}</p>}
        <Link href="/?preview=1" target="_blank" rel="noopener" className="ad-nav-link">
          <AppIcon name="arrow-right" size={18} /><span>View the website</span>
        </Link>
        <Link href="/dashboard" className="ad-nav-link" onClick={onNavigate}>
          <AppIcon name="arrow-left" size={18} /><span>Back to the app</span>
        </Link>
      </div>
    </>
  )
}

/**
 * The bar across the top of every admin page. On a laptop: where you are.
 * On a phone: the admin's green, the menu button and the open alerts, so
 * "you are in admin" and "something is wrong" both hold with the menu shut.
 * It also names the browser tab.
 */
export function AdminTopbar({ counts, email }: { counts: NavCounts | null; email: string | null }) {
  const pathname = usePathname() ?? ''
  const crumbs = adminCrumbs(pathname)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  const alerts = counts?.alerts

  useEffect(() => { document.title = adminTitle(pathname) }, [pathname])
  // The layout stays mounted between pages, so arriving on a new page must
  // close the menu itself; so does widening the window past the sidebar.
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)')
    const shut = () => { if (wide.matches) setOpen(false) }
    wide.addEventListener('change', shut)
    return () => wide.removeEventListener('change', shut)
  }, [])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <header className="ad-topbar">
      <button type="button" className="ad-menu-btn" aria-label="Open the admin menu" aria-expanded={open}
              onClick={() => setOpen(true)}>
        {/* Three lines: the menu sign people expect, not the app's "more" dots. */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <Link href="/admin" className="ad-top-brand">
        <BrandMark />
        <span className="ad-admin-tag">Admin</span>
      </Link>
      <span className="ad-top-spacer" />
      {alerts && alerts.n > 0 && (
        <Link href="/admin/alerts" className="ad-top-alerts" aria-label={`${alerts.n} ${alerts.label}`}>
          <AppIcon name="alert" size={18} />
          <span className="ad-count" data-tone={alerts.tone === 'neutral' ? undefined : alerts.tone}>{alerts.n}</span>
        </Link>
      )}
      <nav aria-label="You are here" className="ad-crumbs">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <span key={c.href + c.label} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span className="ad-crumb-sep" aria-hidden>/</span>}
              {last
                ? <span aria-current="page">{c.label}</span>
                : <Link href={c.href}>{c.label}</Link>}
            </span>
          )
        })}
      </nav>
      <Link href="/?preview=1" target="_blank" rel="noopener" className="ad-top-link" title="Open the public website in a new tab">
        <span className="hidden sm:inline">View website</span>
        <AppIcon name="arrow-right" size={16} />
      </Link>

      <dialog ref={ref} className="ad-drawer" aria-label="Admin menu"
              onClose={() => setOpen(false)}
              onClick={(e) => { if (e.target === ref.current) setOpen(false) }}>
        <AdminNav counts={counts} email={email} onNavigate={() => setOpen(false)} />
      </dialog>
    </header>
  )
}
