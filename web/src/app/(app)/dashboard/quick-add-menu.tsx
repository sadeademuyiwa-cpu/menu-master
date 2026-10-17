'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sheet } from '@/components/sheet'
import { AppIcon } from '@/components/icons'
import type { QuickAction } from './roles'

/**
 * The raised "+" on a phone (components/quick-add.tsx decides what it offers,
 * on the server, from the person's role). Hidden on the screens that ARE one
 * of these, and during setup, where the next step is already the whole page.
 *
 * One thing to offer: the "+" goes straight to it, a sheet of one would only
 * cost a tap. Several: a sheet lists them.
 */
export function QuickAddMenu({ actions }: { actions: QuickAction[] }) {
  const pathname = usePathname() ?? ''
  const [open, setOpen] = useState(false)
  if (actions.length === 0 || /\/new$|\/correct$|^\/start|^\/onboarding/.test(pathname)) return null

  if (actions.length === 1) {
    const only = actions[0]
    return (
      <Link href={only.href} className="mm-fab" aria-label={only.label}>
        <AppIcon name="plus" size={26} />
      </Link>
    )
  }

  return (
    <>
      <button type="button" className="mm-fab" aria-label="Add something" onClick={() => setOpen(true)}>
        <AppIcon name="plus" size={26} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="What are you recording?">
        <ul className="mm-quick-list">
          {actions.map((a) => (
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
