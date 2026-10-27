'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { normaliseNgMobile, localNgMobile, CONTACT_WORDING_VERSION } from '@/lib/phone'

/**
 * The owner's own WhatsApp number and their "tips and offers" choice, in
 * More -> Account (0068). Saved with fn_set_my_contact straight from the
 * browser, then the page refreshes: Account streams behind a skeleton, and a
 * server action that redirects back to such a page can stall
 * (components/skeleton.tsx).
 *
 * Removing the number is one press, as easy as giving it (NDPA s.35).
 */
export function ContactNumber({ phone, offers, wrong = false }: {
  phone: string | null
  offers: boolean
  /** An admin found the number reached someone else and removed it. */
  wrong?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(localNgMobile(phone))
  const [wantOffers, setWantOffers] = useState(offers)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)

  async function save(next: string, nextOffers: boolean) {
    const number = next.trim() ? normaliseNgMobile(next) : null
    if (next.trim() && !number) {
      setNote({ text: 'Use a Nigerian mobile number, like 0803 123 4567.', bad: true })
      return
    }
    setBusy(true)
    setNote(null)
    const { error } = await createClient().rpc('fn_set_my_contact', {
      p_phone: number ?? '', p_marketing_ok: nextOffers, p_wording: CONTACT_WORDING_VERSION, p_source: 'account',
    })
    setBusy(false)
    if (error) {
      console.error('[account] fn_set_my_contact refused:', error)
      setNote({ text: 'Your number could not be saved just now. Try again in a moment.', bad: true })
      return
    }
    if (!number) { setValue(''); setWantOffers(false) }
    setNote({ text: number ? 'Saved.' : 'Removed. Menu Master will not contact you on WhatsApp.', bad: false })
    router.refresh()
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(value, wantOffers) }}>
      {wrong && (
        <p role="status" className="text-sm" style={{ color: 'var(--mm-warn)' }}>
          We tried the number you gave us and it reached someone else, so we removed it. Add the right one below if
          you would like us to be able to help you on WhatsApp.
        </p>
      )}
      <label className="block">
        <span className="text-sm font-medium">WhatsApp number</span>
        <input
          name="phone" type="tel" inputMode="tel" autoComplete="tel"
          value={value} onChange={(e) => { setValue(e.target.value); setNote(null) }}
          placeholder="0803 123 4567" className="mm-input mt-1"
        />
      </label>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--mm-muted)' }}>
        So Menu Master can WhatsApp or call you to help you get set up, or if something goes wrong
        with your account. Not for adverts.{' '}
        <a href="/privacy" target="_blank" rel="noopener" className="underline">How we use it</a>
      </p>
      {value.trim() && (
        <label className="flex min-h-[44px] items-start gap-3 text-sm">
          <input type="checkbox" name="offers" checked={wantOffers} onChange={(e) => setWantOffers(e.target.checked)}
                 className="mt-1 h-4 w-4 shrink-0 accent-[var(--mm-accent)]" />
          <span>Also send me tips and offers from Menu Master on WhatsApp. I can stop any time by replying STOP or here.</span>
        </label>
      )}
      {note && (
        <p role="status" className="text-sm" style={{ color: note.bad ? 'var(--mm-warn)' : 'var(--mm-accent-strong)' }}>{note.text}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} busyLabel="Saving…">Save number</Button>
        {phone && (
          <Button type="button" variant="quiet" disabled={busy} onClick={() => void save('', false)}>Remove my number</Button>
        )}
      </div>
    </form>
  )
}
