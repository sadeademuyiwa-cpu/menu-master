'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { track } from '@/lib/analytics/client'
import { BUSINESS_TYPES } from '@/lib/business-types'
import { normaliseNgMobile, CONTACT_WORDING_VERSION } from '@/lib/phone'
// The database's refusal, in words an owner can act on (tested). The raw
// text goes to the console for us, never to the screen -- except MMLGN and
// MMENT, whose sentences the database wrote for the person.
import { onboardingRefusal } from './onboarding-refusal'

export function OnboardingForm() {
  const router = useRouter()
  const [businessName, setBusinessName] = useState('')
  const [businessType, setBusinessType] = useState<string>('')
  const [phone, setPhone] = useState('')
  const [offers, setOffers] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // C10 CONTRACT: one idempotency key per onboarding ATTEMPT, reused on every
  // retry. Generated once when this form mounts and deliberately not
  // regenerated on submit, so a retry after a timeout cannot create a second
  // account.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!businessType) {
      setError('Choose what you sell, so we can set things up for you.')
      return
    }
    // The number is optional; a mistyped one is caught here, before the
    // account exists, rather than lost quietly afterwards.
    const number = phone.trim() ? normaliseNgMobile(phone) : null
    if (phone.trim() && !number) {
      setError('Use a Nigerian mobile number, like 0803 123 4567, or leave the WhatsApp box empty.')
      return
    }
    setBusy(true)
    setError(null)

    const name = businessName.trim()
    const supabase = createClient()
    // The account holds the business; most owners have one of each, so the
    // account simply takes the business's name. It can be renamed later.
    const { error } = await supabase.rpc('fn_create_account_and_business', {
      p_account_name: name,
      p_business_name: name,
      p_business_type: businessType,
      p_idempotency_key: idempotencyKey,
    })

    if (error) {
      console.error('[onboarding] fn_create_account_and_business refused:', error)
      setBusy(false)
      setError(onboardingRefusal(error))
      return
    }
    track('business_created')
    // The WhatsApp number goes through its own call (0068), so a refusal
    // there can never stop the business being set up -- nor a stalled
    // connection: after 4 seconds onboarding moves on and the request
    // finishes on its own. Logged, not shown: it can be added again in
    // More -> Account.
    if (number) {
      const saving = supabase.rpc('fn_set_my_contact', {
        p_phone: number, p_marketing_ok: offers, p_wording: CONTACT_WORDING_VERSION, p_source: 'onboarding',
      }).then(({ error: refused }) => { if (refused) console.error('[onboarding] fn_set_my_contact refused:', refused) })
      await Promise.race([saving, new Promise((done) => setTimeout(done, 4000))])
    }
    router.push('/start')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Welcome! Tell us about your business</h1>
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--mm-muted)' }}>
          Four short steps and Menu Master will show you what one plate of your food really
          costs, and what to charge for it.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Business name</span>
        <input
          required value={businessName} onChange={(e) => setBusinessName(e.target.value)}
          placeholder="e.g. Iya Basira Foods" autoComplete="organization"
          className="mm-input mt-1"
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">What do you sell?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {BUSINESS_TYPES.map((t) => {
            const chosen = businessType === t.value
            return (
              <label
                key={t.value}
                className="mm-card flex cursor-pointer items-start gap-3"
                style={chosen ? { borderColor: 'var(--mm-accent)', boxShadow: '0 0 0 1px var(--mm-accent)' } : undefined}
              >
                <input
                  type="radio" name="business_type" value={t.value}
                  checked={chosen} onChange={() => { setBusinessType(t.value); setError(null) }}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--mm-accent)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold">{t.label}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: 'var(--mm-muted)' }}>{t.example}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div>
        <label className="block">
          <span className="text-sm font-medium">WhatsApp number <span className="font-normal" style={{ color: 'var(--mm-muted)' }}>(optional)</span></span>
          <input
            name="phone" type="tel" inputMode="tel" autoComplete="tel"
            value={phone} onChange={(e) => { setPhone(e.target.value); setError(null) }}
            placeholder="0803 123 4567" className="mm-input mt-1"
          />
        </label>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--mm-muted)' }}>
          So Menu Master can WhatsApp or call you to help you get set up, or if something goes wrong
          with your account. Not for adverts. Remove it any time in More → Account.{' '}
          <a href="/privacy" target="_blank" rel="noopener" className="underline">How we use it</a>
        </p>
        {phone.trim() && (
          <label className="mt-2 flex min-h-[44px] items-start gap-3 text-sm">
            <input type="checkbox" name="offers" checked={offers} onChange={(e) => setOffers(e.target.checked)}
                   className="mt-1 h-4 w-4 shrink-0 accent-[var(--mm-accent)]" />
            <span>Also send me tips and offers from Menu Master on WhatsApp. I can stop any time by replying STOP or in More → Account.</span>
          </label>
        )}
      </div>

      {error && <p role="alert" className="text-sm" style={{ color: 'var(--mm-warn)' }}>{error}</p>}

      <Button busy={busy} busyLabel="Setting up your business…" className="w-full">Continue</Button>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--mm-muted)' }}>
        We add a starter list of common Nigerian ingredients, with no prices. You enter what
        you actually pay in the next step. Menu Master only ever calculates from your own figures.
      </p>
    </form>
  )
}
