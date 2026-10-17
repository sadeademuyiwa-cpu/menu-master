'use client'

import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/icons'
import { receiptMoney } from '@/lib/receipt'
import { track } from '@/lib/analytics/client'

export type CardLine = { name: string; qty: number; gross: number }

/**
 * The receipt (or, on a draft, the quote) as the customer will read it, with
 * the business's name on top and "Send on WhatsApp" first. The text itself
 * is built on the server from the confirmed sale (lib/receipt.ts); this only
 * shows it and hands it to WhatsApp or the clipboard. No cost or profit is
 * ever passed in: this is the customer's view.
 *
 * Every amount is formatted with receiptMoney, the receipt text's own rule,
 * not money(): this is the customer's record, so it keeps the kobo exactly
 * as the text sent does. With money() a sale of 3 x ₦1,450.50 read ₦4,352
 * here and ₦4,351.50 in the message.
 *
 * No Menu Master mark: the receipt is the business's, and the app header
 * already carries the one gold mark the screen allows.
 *
 * `focusSend`: the owner pressed "Confirm and send receipt", so the page
 * opens with the WhatsApp button in view and focused, one tap from sent.
 * WhatsApp is not opened by itself: a phone only opens the app from a real
 * tap, and a page that jumps out of the app on its own is a surprise.
 */
export function ReceiptCard({
  kind, businessName, dateText, reference, customerName, lines, discount, total, paymentText,
  text, whatsappHref, toName, focusSend = false,
}: {
  kind: 'receipt' | 'quote'
  businessName: string
  dateText: string
  reference: string | null
  customerName: string | null
  lines: CardLine[]
  discount: number
  total: number
  /** "Paid in full", "Paid ₦10,000 so far", "Not paid yet"; receipts only.
   *  Formatted by the caller with receiptMoney, like the text sent. */
  paymentText?: string | null
  text: string
  whatsappHref: string
  /** Who WhatsApp will open for, or null when it opens without a recipient. */
  toName: string | null
  focusSend?: boolean
}) {
  const sendRef = useRef<HTMLAnchorElement>(null)
  const [copied, setCopied] = useState(false)
  const noun = kind === 'quote' ? 'quote' : 'receipt'

  useEffect(() => {
    if (!focusSend || !sendRef.current) return
    sendRef.current.scrollIntoView({ block: 'center' })
    sendRef.current.focus({ preventScroll: true })
  }, [focusSend])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Older browsers and plain-http pages: fall back to a hidden textarea.
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    track('receipt_shared', { method: 'copy' })
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <section className="mm-card space-y-3" aria-label={kind === 'quote' ? 'Quote' : 'Receipt'}>
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{businessName}</div>
          <div className="truncate text-xs" style={{ color: 'var(--mm-muted)' }}>
            {kind === 'quote' ? 'Quote' : 'Receipt'} · {dateText}{reference ? ` · ${reference}` : ''}
          </div>
        </div>
      </header>
      {customerName && <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>For {customerName}</p>}

      <ul className="space-y-1.5 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">{l.name} <span style={{ color: 'var(--mm-muted)' }}>× {l.qty.toLocaleString('en-NG')}</span></span>
            <span className="mm-num shrink-0">{receiptMoney(l.gross)}</span>
          </li>
        ))}
      </ul>
      <div className="space-y-1 border-t border-dashed pt-2" style={{ borderColor: 'var(--mm-line)' }}>
        {discount > 0 && (
          <div className="flex justify-between text-sm" style={{ color: 'var(--mm-muted)' }}>
            <span>Discount</span><span className="mm-num">−{receiptMoney(discount)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">Total</span>
          <span className="mm-num text-xl font-semibold">{receiptMoney(total)}</span>
        </div>
        {kind === 'quote' ? (
          <div className="text-xs" style={{ color: 'var(--mm-muted)' }}>Send as a quote · prices hold for 7 days</div>
        ) : paymentText ? (
          <div className="text-xs" style={{ color: 'var(--mm-muted)' }}>{paymentText}</div>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* The brand's primary green, not WhatsApp's own: white on #1f9d55
            was under 4:1, too faint for a 15px label in sunlight. */}
        <a ref={sendRef} href={whatsappHref} target="_blank" rel="noopener noreferrer"
           onClick={() => track('receipt_shared', { method: 'whatsapp' })}
           className="mm-btn mm-btn-primary w-full">
          Send on WhatsApp
        </a>
        <button type="button" className="mm-btn mm-btn-secondary w-full" onClick={copy}>
          <AppIcon name={copied ? 'check' : 'card'} size={18} /> {copied ? 'Copied' : `Copy ${noun}`}
        </button>
      </div>
      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        {toName
          ? `WhatsApp opens a chat with ${toName}, with the ${noun} ready to send.`
          : `WhatsApp opens with the ${noun} ready; choose who to send it to.`}
      </p>

      {/* Exactly what the customer receives, word for word. */}
      <details className="mm-disclosure">
        <summary className="mm-tap cursor-pointer list-none px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <AppIcon name="chevron-right" size={16} className="mr-2 transition-transform [details[open]_&]:rotate-90" />
          See the {noun}
        </summary>
        <div className="border-t px-3 py-3" style={{ borderColor: 'var(--mm-line)' }}>
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">{text}</pre>
        </div>
      </details>
    </section>
  )
}
