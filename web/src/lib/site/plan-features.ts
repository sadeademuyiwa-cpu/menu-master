import { billingSelfServe, planFaq } from './billing-words'

/**
 * What each plan includes, in the owner's words. One list, so the landing
 * page and /subscribe can never promise different things.
 */
export const COSTING_FEATURES = [
  'What every dish really costs, from what you paid',
  'Prices update every dish when you record a purchase',
  'Suggested selling price and your profit per plate',
  'Sizes, packaging, labour and monthly bills',
]

export const TRADING_FEATURES = [
  'Everything in Costing',
  'Take orders and record sales in a few taps',
  'WhatsApp receipts for your customers',
  'Customers, payments and what each one is worth',
  'Daily takings, profit and reports',
]

/**
 * The plans FAQ, as the landing page and /subscribe show it. Its billing
 * answers follow the web's safety switch (BILLING_SELF_SERVE, read on the
 * server): self-serve wording when it is "on", "message us" otherwise. The
 * words, both ways, are in billing-words.ts and tested there
 * (tests/public-promises.test.mts). Server components only.
 */
export const PLAN_FAQ: [string, string][] = planFaq(billingSelfServe())
