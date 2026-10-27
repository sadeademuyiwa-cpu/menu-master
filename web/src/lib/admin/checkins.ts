/**
 * The admin's check-ins (0068): why an owner is due a message, and the
 * message, already written, for the WhatsApp button. Pure; no imports, so
 * node --test runs it as it is.
 *
 * Every message is service contact -- help with setting up, the trial
 * ending, a payment that did not go through -- which is what the owner
 * agreed to beside the number ("to help you get set up, or if something goes
 * wrong with your account. Not for adverts."). Offers never go here; they
 * need the separate box (NDPA s.26, WhatsApp Business Policy).
 */

export type CheckinReason = 'welcome' | 'day3' | 'trial_end' | 'payment_failed'

export const CHECKIN_REASONS: Record<CheckinReason, { label: string; tone: 'warn' | 'neutral' }> = {
  payment_failed: { label: 'Payment failed', tone: 'warn' },
  trial_end: { label: 'Trial ends soon', tone: 'warn' },
  welcome: { label: 'New: say hello', tone: 'neutral' },
  day3: { label: 'Day 3: first dish?', tone: 'neutral' },
}

// What "Mark done" can record (0068 fn_admin_record_checkin):
//   reached        on WhatsApp or a call, the number is confirmed
//   no_reply       the check-in comes back a day later
//   wrong_number   the number reached someone else: removed, and the owner is asked again
//   stopped_offers they replied STOP to tips and offers: offers off, number kept
//   opted_out      no more contact: number and offers removed, off this list
export const CHECKIN_OUTCOMES = [
  { value: 'reached', label: 'Talked to them' },
  { value: 'no_reply', label: 'No reply yet (ask again tomorrow)' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'stopped_offers', label: 'Replied STOP to offers' },
  { value: 'opted_out', label: 'Asked not to be contacted' },
] as const

export const CHECKIN_CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
] as const

/**
 * The message for the WhatsApp button, in the admin's voice, plain and short.
 * `selfServe`: whether a paying owner can pay again in the app themselves
 * (lib/site/billing-words.ts billingSelfServe). While it is off there is no
 * Pay now button, so the message offers help instead of pointing at one.
 */
export function checkinMessage(reason: CheckinReason, ctx: { business: string; endsOn?: string | null; selfServe?: boolean }): string {
  const hi = `Hello, this is Menu Master.`
  switch (reason) {
    case 'welcome':
      return `${hi} Welcome! Did setting up ${ctx.business} go okay? If anything is confusing, reply here and I will help.`
    case 'day3':
      return `${hi} Have you costed your first dish for ${ctx.business} yet? Send me one recipe and I will show you how to put it in.`
    case 'trial_end':
      return `${hi} Your free trial ends ${ctx.endsOn ? `on ${ctx.endsOn}` : 'soon'}. Your records stay safe either way. If you have any questions about the plans, reply here.`
    case 'payment_failed':
      return ctx.selfServe
        ? `${hi} Your last payment for ${ctx.business} did not go through. You can pay again in More, then Plans & billing. Reply here if you need help.`
        : `${hi} Your last payment for ${ctx.business} did not go through. Reply here and I will help you pay again.`
  }
}

/** The outcome a person would say, for the "last check-in" line. */
export function outcomeWords(outcome: string | null | undefined): string {
  return CHECKIN_OUTCOMES.find((o) => o.value === outcome)?.label ?? 'not yet'
}
