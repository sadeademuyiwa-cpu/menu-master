/**
 * What setting up a business says when the database refuses it.
 *
 * Kept free of React and Next so every sentence is tested directly
 * (tests/onboarding-refusal.test.mts). The raw error goes to the console for
 * us (onboarding-form.tsx), never to the screen -- except where the database
 * wrote the sentence for the person, which is shown as it is:
 *
 *   MMLGN  this login already belongs to a business (as staff), so it cannot
 *          start one of its own (0066, owner decision D4)
 *   MMENT  the owner's account has no access (the trial ended, a payment
 *          failed, the plan ended), so no business can be added (0066)
 */
export type OnboardingError = { code?: string; message?: string } | null | undefined

/** 0066's own words for a login that is already staff somewhere. */
export const LOGIN_TAKEN =
  'This login already belongs to a business on Menu Master. To run a business of your own, ' +
  'sign up with a different email address.'

/** 0066's gate, when it sent the code without its sentence. */
export const NO_ACCESS =
  'This account cannot add a business until a plan is chosen. Choose a plan on Plans & billing to carry on.'

export function onboardingRefusal(error: OnboardingError): string {
  const code = error?.code ?? ''
  const message = (error?.message ?? '').trim()
  if (code === 'MMLGN') return message || LOGIN_TAKEN
  if (code === 'MMENT') return message || NO_ACCESS
  if (/idempotency/i.test(message) && /different/i.test(message)) {
    return 'Your business was already being set up with the details you entered first. Reload this page to carry on.'
  }
  if (code === '23505') {
    return 'You already have a business with that name. Try a slightly different name.'
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'We could not set up a business for this login. Sign out, sign back in and try once more.'
  }
  return 'We could not set up your business just now. Check your connection and press Continue again.'
}
