/**
 * Whether a notice is a refusal or a confirmation, from its wording.
 *
 * Notices ride on the URL (see withNotice) as plain sentences, so the toast
 * that shows them has only the words to go on. Every page used to keep its
 * own regex for this; the union of them lives here so a refusal is coloured
 * the same wherever it appears. Kept free of React so it can be tested.
 */
const REFUSAL = /could not|couldn’t|cannot|can’t|must be|do not|does not|not allow|already|give |needs|how many|not know|expired|more than zero|greater than zero|refused/i

export type NoticeTone = 'warn' | 'info'

export function noticeTone(notice: string): NoticeTone {
  return REFUSAL.test(notice) ? 'warn' : 'info'
}

/** How long a toast stays, in ms. A refusal is read; a confirmation is glanced at. */
export function noticeDuration(tone: NoticeTone): number {
  return tone === 'warn' ? 10000 : 5000
}
