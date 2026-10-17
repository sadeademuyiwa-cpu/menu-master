'use client'

import { useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { AppIcon } from '@/components/icons'

/**
 * One short row ("Ofada rice · 4.5 kg · ₦7,650") that opens a sheet with
 * everything else about it: where its cost came from, and the forms to
 * change or remove it. Fifteen rows of inline Update and Remove buttons made
 * the dish page six phone screens long; one tap per row does the same work.
 *
 * The sheet's contents are rendered on the server (`sheet`), forms and server
 * actions included, so nothing about the row's cost is decided here.
 *
 * `stamp` changes each time the server renders the page. A save or remove in
 * the sheet ends in a redirect that brings the page back with a new stamp,
 * and the sheet closes then -- after the work is done, so the button's busy
 * state is seen, and before the notice, so the notice is not hidden behind
 * the sheet.
 */
export function TapRow({ title, sheet, stamp, children }: {
  /** The sheet's heading: the item's own name. */
  title: string
  sheet: React.ReactNode
  stamp: number
  /** The row itself. */
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [stamp])

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-[var(--mm-surface-2)]"
      >
        <span className="min-w-0 flex-1">{children}</span>
        <AppIcon name="chevron-right" size={16} className="shrink-0" style={{ color: 'var(--mm-muted)' }} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>{sheet}</Sheet>
    </>
  )
}
