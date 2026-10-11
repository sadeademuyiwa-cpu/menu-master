'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV, activeHref } from '@/lib/nav'
import { AppIcon, type IconName } from '@/components/icons'

const ICONS: Record<string, IconName> = {
  '/dashboard': 'home',
  '/sales': 'sales',
  '/purchases': 'purchases',
  '/recipes': 'recipes',
  '/more': 'more',
}

/**
 * The same five destinations in three shapes: a column in the sidebar (lg),
 * a row in the header (md), a bar along the bottom (phones).
 */
export function PrimaryNav({ variant }: { variant: 'header' | 'bottom' | 'sidebar' }) {
  const pathname = usePathname() ?? ''
  const active = activeHref(pathname)
  const isHeader = variant === 'header'
  const isSidebar = variant === 'sidebar'
  const linkClass = isSidebar ? 'mm-nav-side' : isHeader ? 'mm-nav-desktop' : 'mm-nav-mobile'

  return (
    <nav
      aria-label="Primary"
      className={isSidebar ? '' : isHeader ? 'hidden md:block' : 'md:hidden'}
    >
      <ul className={isSidebar ? 'grid gap-1' : isHeader ? 'flex items-center gap-1' : 'mx-auto grid max-w-lg grid-cols-5'}>
        {NAV.map((item) => {
          const current = item.href === active
          const icon = ICONS[item.href] ?? 'more'
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={linkClass}
                data-current={current || undefined}
              >
                <AppIcon name={icon} size={isHeader ? 18 : isSidebar ? 20 : 21} />
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
