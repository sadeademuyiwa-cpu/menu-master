/**
 * An owner's own phone number: the one they give in onboarding or More ->
 * Account so Menu Master can WhatsApp or call them (0068). Strictly a
 * Nigerian mobile, in one form, 234XXXXXXXXXX -- the twin of the database's
 * fn_normalise_ng_phone, which has the last word.
 *
 * Customers' numbers on receipts (lib/receipt.ts) and the website's own
 * WhatsApp number (lib/site/settings.ts) are looser on purpose: a customer
 * may be abroad. This is only for the owner's contact.
 *
 * No imports, so node --test runs it as it is.
 */

const NG_MOBILE = /^234(70|80|81|90|91)\d{8}$/

/**
 * 0803 123 4567, 803…, 234…, +234…, +234 (0) 803…, 00234… -> 2348031234567.
 * Anything that is not a Nigerian mobile -> null.
 */
export function normaliseNgMobile(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let s = input.replace(/\D/g, '')
  if (s.startsWith('00')) s = s.slice(2)
  if (s.startsWith('2340')) s = '234' + s.slice(4)
  if (s.startsWith('0') && s.length === 11) s = '234' + s.slice(1)
  if (s.length === 10 && /^(70|80|81|90|91)/.test(s)) s = '234' + s
  return NG_MOBILE.test(s) ? s : null
}

/** 2348031234567 -> "+234 803 123 4567", as people read a number. */
export function formatNgMobile(e164: string | null | undefined): string {
  if (!e164 || !NG_MOBILE.test(e164)) return e164 ?? ''
  return `+234 ${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`
}

/** 2348031234567 -> "0803 123 4567", the way it was typed, for a form's box. */
export function localNgMobile(e164: string | null | undefined): string {
  if (!e164 || !NG_MOBILE.test(e164)) return ''
  return `0${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`
}

/** A click-to-chat link with the message already written. */
export function waLink(e164: string, text?: string): string {
  return `https://wa.me/${e164}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

/** The words shown beside the number, recorded with each consent (0068 contact_wording). */
export const CONTACT_WORDING_VERSION = 'contact-2026-10-25'
