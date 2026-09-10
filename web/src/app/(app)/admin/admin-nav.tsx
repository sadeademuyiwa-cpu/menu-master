'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const ADMIN_NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/alerts', label: 'Alerts' },
  { href: '/admin/billing', label: 'Billing' },
  { href: '/admin/subscriptions', label: 'Subscriptions' },
  { href: '/admin/signups', label: 'Signups' },
] as const

export function AdminNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav aria-label="Platform" className="-mx-1 overflow-x-auto">
      <ul className="flex gap-1 px-1">
        {ADMIN_NAV.map((i) => {
          const current = i.href === '/admin' ? pathname === '/admin' : pathname.startsWith(i.href)
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={current ? 'page' : undefined}
                className={`mm-tap whitespace-nowrap rounded px-3 text-sm ${current ? 'font-medium' : ''}`}
                style={current
                  ? { color: 'var(--mm-fg)', background: 'var(--mm-surface)', boxShadow: 'inset 0 -2px 0 0 var(--mm-accent)' }
                  : { color: 'var(--mm-muted)' }}
              >
                {i.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
