'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * "Let Menu Master see which screens I use", in More -> Account (0069).
 * On unless she turns it off: it is how we notice someone stuck and offer
 * help (legitimate interest, NDPA s.25), and turning it off is one press
 * (s.36) that also removes what was recorded. Per person, not per business.
 */
export function UsageTracking({ on }: { on: boolean }) {
  const id = useId()
  const router = useRouter()
  const [value, setValue] = useState(on)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)

  async function toggle() {
    const next = !value
    setBusy(true)
    setNote(null)
    const { error } = await createClient().rpc('fn_set_my_usage_tracking', { p_on: next })
    setBusy(false)
    if (error) {
      console.error('[account] fn_set_my_usage_tracking refused:', error)
      setNote({ text: 'That could not be changed just now. Try again in a moment.', bad: true })
      return
    }
    setValue(next)
    setNote({ text: next ? 'On. Thank you.' : 'Off. We have deleted the screens recorded for you, and record no more.', bad: false })
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span id={`${id}-label`} className="block text-sm font-medium">Let Menu Master see which screens you use</span>
          <span id={`${id}-hint`} className="mt-0.5 block text-[13px]" style={{ color: 'var(--mm-muted)' }}>
            Which screens you open and for how long, on a phone or a computer, and when a screen refuses
            something, breaks, or you open Help. It shows us where people get stuck, so we can offer help.
            Never what you type. Kept 90 days.{' '}
            <a href="/privacy" target="_blank" rel="noopener" className="underline">More</a>
          </span>
        </div>
        <button type="button" role="switch" aria-checked={value} aria-labelledby={`${id}-label`}
                aria-describedby={`${id}-hint`} className="mm-switch" disabled={busy} onClick={() => void toggle()}>
          <span className="mm-switch-track" aria-hidden="true"><span className="mm-switch-knob" /></span>
        </button>
      </div>
      {note && (
        <p role="status" className="text-sm" style={{ color: note.bad ? 'var(--mm-warn)' : 'var(--mm-accent-strong)' }}>{note.text}</p>
      )}
    </div>
  )
}
