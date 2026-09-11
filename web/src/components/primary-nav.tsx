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

export function PrimaryNav({ variant }: { variant: 'header' | 'bottom' }) {
  const pathname = usePathname() ?? ''
  const active = activeHref(pathname)
  const isHeader = variant === 'header'

  return (
    <nav aria-label="Primary" className={isHeader ? 'hidden md:block' : 'md:hidden'}>
      <ul className={isHeader ? 'flex items-center gap-1' : 'mx-auto grid max-w-lg grid-cols-5'}>
        {NAV.map((item) => {
          const current = item.href === active
          const icon = ICONS[item.href] ?? 'more'
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={isHeader ? 'mm-nav-desktop' : 'mm-nav-mobile'}
                data-current={current || undefined}
              >
                <AppIcon name={icon} size={isHeader ? 18 : 21} />
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
