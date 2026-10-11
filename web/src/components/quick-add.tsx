'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sheet } from '@/components/sheet'
import { AppIcon, type IconName } from '@/components/icons'

/**
 * The raised "+" on a phone. One tap, then the four things an owner records:
 * a sale, a purchase, a dish, an item. Hidden on the screens that ARE one of
 * those, and during setup, where the next step is already the whole page.
 */
const ACTIONS: { href: string; icon: IconName; label: string; meta: string }[] = [
  { href: '/sales/new', icon: 'sales', label: 'Record a sale', meta: 'What you sold' },
  { href: '/purchases/new', icon: 'purchases', label: 'Record a purchase', meta: 'What you paid' },
  { href: '/recipes/new', icon: 'recipes', label: 'New dish', meta: 'Cost what you make' },
  { href: '/ingredients', icon: 'ingredients', label: 'Add an item', meta: 'An ingredient or packaging' },
]

export function QuickAdd() {
  const pathname = usePathname() ?? ''
  const [open, setOpen] = useState(false)
  if (/\/new$|\/correct$|^\/start|^\/onboarding/.test(pathname)) return null

  return (
    <>
      <button type="button" className="mm-fab" aria-label="Add something" onClick={() => setOpen(true)}>
        <AppIcon name="plus" size={26} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="What are you recording?">
        <ul className="mm-quick-list">
          {ACTIONS.map((a) => (
            <li key={a.href}>
              <Link href={a.href} className="mm-action-tile" onClick={() => setOpen(false)}>
                <span className="mm-action-icon"><AppIcon name={a.icon} size={21} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.label}</span>
                  <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--mm-muted)' }}>{a.meta}</span>
                </span>
                <AppIcon name="chevron-right" size={17} className="shrink-0" style={{ color: 'var(--mm-muted)' }} />
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}
