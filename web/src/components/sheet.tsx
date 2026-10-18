'use client'

import { useEffect, useRef } from 'react'

/**
 * A pop-up for a short, occasional form: a discount, an item that is not on
 * the menu, a price. It slides up from the bottom on a phone and sits in the
 * middle on a larger screen, so the page behind it stays as it was.
 *
 * Built on <dialog>, so focus, Escape and the backdrop are the browser's own.
 *
 * `top` hangs it from the top of a phone instead: for a search, where the
 * keyboard takes the bottom of the screen and would hide the results.
 */
export function Sheet({
  open, onClose, title, children, top = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  top?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={top ? 'mm-sheet mm-sheet--top' : 'mm-sheet'}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      aria-label={title}
    >
      <div className="mm-sheet-body">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" className="mm-icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  )
}
