'use client'

import { useState } from 'react'

/** A value to paste somewhere else, with a Copy button beside it. */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div>
      <span className="block text-[13px]" style={{ color: 'var(--mm-muted)' }}>{label}</span>
      <div className="mt-1 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border px-3 py-2.5 text-[13px]"
              style={{ borderColor: 'var(--mm-line)', background: 'var(--mm-surface-2)' }}>{value}</code>
        <button type="button" onClick={copy} className="mm-btn mm-btn-secondary shrink-0" aria-label={`Copy ${label}`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
