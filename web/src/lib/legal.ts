/**
 * The fixed facts the legal pages state about Menu Master NG.
 *
 * The business's own details -- legal name, RC number, address, support
 * email -- are NOT here: the owner enters them in Admin -> Website (0057,
 * site_settings 'company'), and until they do, the pages use neutral words
 * rather than a placeholder. Nothing here is guessed.
 */
export const LEGAL = {
  productName: 'Menu Master NG',
  website: 'menumasterng.com',
  governingLaw: 'the Federal Republic of Nigeria',
  /** When the terms and refund policy last changed. Update on every edit. */
  lastUpdated: '10 September 2026',
  /** Days a customer has to report a billing error and receive a refund. */
  billingDisputeDays: 14,
} as const
