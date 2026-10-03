/**
 * First-run setup: who must finish it, where they may go meanwhile, and which
 * step they are on.
 *
 * Kept free of React, Next and Supabase so every rule is tested directly.
 *
 * WHY THIS EXISTS
 *   New owners signed up, landed on an eleven-step checklist and a list of 180
 *   unpriced starter items, and told us they did not know what to do. The app
 *   only becomes useful once ONE dish is fully costed from the owner's own
 *   purchases and has a selling price, so that is what setup now walks them
 *   through before anything else opens. Every figure on the way is entered by
 *   the owner; nothing is pre-filled.
 */

/** Set once setup is finished, holding the user's id, so the check stops running. */
export const SETUP_COOKIE = 'mm_setup_done'

/**
 * Paths an owner may still open while setup is unfinished: the setup screens
 * themselves, their account and plan (a lapsed trial must be able to pay),
 * the payment return, a new password, platform administration, and the
 * non-page routes.
 */
export const SETUP_OPEN_PATHS = [
  '/start',
  '/onboarding',
  '/account',
  '/subscribe',
  '/checkout',
  '/reset-password',
  '/admin',
  '/api',
  '/auth',
] as const

export function isSetupExempt(pathname: string): boolean {
  return SETUP_OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export type SetupFacts = {
  /** The login is on an account that has a business. */
  hasBusiness: boolean
  /** The login's own role on that account. */
  role: string | null
  /** Cost snapshots that are complete: every input of the dish has a real figure. */
  completeCostings: number
  /** Selling prices recorded for this business's dishes. */
  pricesSet: number
}

/**
 * Whether this login must finish setup before using the rest of the app.
 *
 * Only owners and managers are sent through it: they are the roles that can
 * record purchases and prices. A cook or cashier invited into an unfinished
 * business is not trapped in a wizard the database would refuse them.
 * No business yet is onboarding's job, not this one.
 */
export function needsFirstRunSetup(f: SetupFacts): boolean {
  if (!f.hasBusiness) return false
  if (f.role !== 'owner' && f.role !== 'manager') return false
  return f.completeCostings === 0 || f.pricesSet === 0
}

export type WizardStep = 'purchase' | 'dish' | 'price' | 'done'

/**
 * Which setup step to show, read from what the database already holds, so a
 * refresh, a closed tab or a second device resumes at the right place.
 */
export function wizardStep(f: {
  pricesEntered: number
  completeCostings: number
  pricesSet: number
}): WizardStep {
  if (f.pricesEntered === 0) return 'purchase'
  if (f.completeCostings === 0) return 'dish'
  if (f.pricesSet === 0) return 'price'
  return 'done'
}

/** The step number shown to the owner: business details are step 1. */
export function stepNumber(step: WizardStep): number {
  return { purchase: 2, dish: 3, price: 4, done: 4 }[step]
}

export const SETUP_STEP_COUNT = 4
