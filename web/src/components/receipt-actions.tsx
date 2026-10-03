'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/icons'
import { track } from '@/lib/analytics/client'

/**
 * Send or copy a receipt. The text is built on the server from the confirmed
 * sale; this only hands it to WhatsApp or the clipboard.
 */
export function ReceiptActions({ text, whatsappHref, toName }: {
  text: string
  whatsappHref: string
  /** Who WhatsApp will open for, or null when it opens without a recipient. */
  toName: string | null
}) {
  const [copied, setCopied] = useState(false)

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
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer"
           onClick={() => track('receipt_shared', { method: 'whatsapp' })}
           className="mm-btn w-full text-white" style={{ background: '#1f9d55' }}>
          Send on WhatsApp
        </a>
        <button type="button" className="mm-btn mm-btn-secondary w-full" onClick={copy}>
          <AppIcon name={copied ? 'check' : 'card'} size={18} /> {copied ? 'Copied' : 'Copy receipt'}
        </button>
      </div>
      <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
        {toName
          ? `WhatsApp opens a chat with ${toName}, with the receipt ready to send.`
          : 'WhatsApp opens with the receipt ready; choose who to send it to. Add a phone number to the customer to skip this.'}
      </p>
    </div>
  )
}
