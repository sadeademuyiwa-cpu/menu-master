/**
 * Whether a notice is a refusal or a confirmation, from its wording.
 *
 * Notices ride on the URL (see withNotice) as plain sentences, so the toast
 * that shows them has only the words to go on. Every page used to keep its
 * own regex for this; the union of them lives here so a refusal is coloured
 * the same wherever it appears. Kept free of React so it can be tested.
 */
const REFUSAL = new RegExp([
  'could not', 'couldn’t', 'cannot', 'can’t', 'must be', 'do not', 'does not', 'not allow', 'already',
  'give ', 'needs', 'how many', 'not know', 'expired', 'more than zero', 'greater than zero', 'refused',
  // An edit that changed nothing (lib/data/write-notice.ts).
  'nothing was changed',
  // 0066's trial gate (MMENT), whose sentences say neither of the above.
  'nothing new can be saved', 'did not go through',
  // fn_record_order_payment's own refusals (MMPAY, 0066).
  'no payment can be', 'once it is confirmed', 'say whether', 'too large to record', 'could not be found',
].join('|'), 'i')

export type NoticeTone = 'warn' | 'info'

/**
 * `also`: a page's own refusal words on top of the shared ones, for the
 * few sentences only that page says ("Tell us why you are cancelling...").
 */
export function noticeTone(notice: string, also?: RegExp): NoticeTone {
  return REFUSAL.test(notice) || (also?.test(notice) ?? false) ? 'warn' : 'info'
}

/** How long a toast stays, in ms. A refusal is read; a confirmation is glanced at. */
export function noticeDuration(tone: NoticeTone): number {
  return tone === 'warn' ? 10000 : 5000
}
