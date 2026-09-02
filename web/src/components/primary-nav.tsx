'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV, activeHref } from '@/lib/nav'

/**
 * The primary navigation, rendered twice by the layout and shown once: in the
 * header from `sm` upward, in a fixed bottom bar below it. The variant only
 * changes the shape of the highlight, never the destinations.
 */
export function PrimaryNav({ variant }: { variant: 'header' | 'bottom' }) {
  const pathname = usePathname() ?? ''
  const active = activeHref(pathname)
  const isHeader = variant === 'header'

  return (
    <nav aria-label="Primary" className={isHeader ? 'hidden sm:block' : 'sm:hidden'}>
      <ul className={isHeader ? 'flex items-center gap-1' : 'mx-auto flex max-w-5xl'}>
        {NAV.map((item) => {
          const current = item.href === active
          return (
            <li key={item.href} className={isHeader ? undefined : 'min-w-0 flex-1'}>
              <Link
                href={item.href}
                /* aria-current is the part that matters to a screen reader; the
                   colour and weight are for everyone else. Never colour alone. */
                aria-current={current ? 'page' : undefined}
                className={
                  isHeader
                    ? `mm-tap block whitespace-nowrap rounded px-3 py-1.5 text-sm ${current ? 'font-medium' : ''}`
                    /* Five destinations at a legible size. Six at 11px ran into
                       each other on a 360px screen: "IngredientsPurchases". */
                    : `mm-tap block w-full justify-center whitespace-nowrap px-1 text-center text-xs ${current ? 'font-medium' : ''}`
                }
                style={current
                  ? {
                      color: 'var(--mm-fg)',
                      background: isHeader ? 'var(--mm-surface)' : undefined,
                      boxShadow: isHeader ? undefined : 'inset 0 2px 0 0 var(--mm-accent)',
                    }
                  : { color: 'var(--mm-muted)' }}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
