/**
 * Reading an amount out of a submitted form.
 *
 * Kept free of React and Next imports so every branch is testable directly.
 *
 * WHY THIS EXISTS
 *   On 2026-09-02 a live sale was recorded at zero naira. The owner had
 *   entered 2,000. The action read the field with
 *
 *     const price = Number(formData.get('unit_price'))
 *     if (!Number.isFinite(price) || price < 0) { reject }
 *
 *   and Number('') is 0, which is finite and not negative -- so a blank field
 *   sailed through the guard and was stored as a free item. An <input
 *   type="number"> submits an empty string whenever its contents are not a
 *   valid number, so "2,000" with a separator produces exactly that blank.
 *
 *   qty escaped only by accident: its guard is `qty <= 0`, which happens to
 *   reject the empty case too.
 *
 * THE RULE
 *   Absence is not zero. A field the business says is REQUIRED must be
 *   entered, even if zero is a legal value for it. A field the business says
 *   is OPTIONAL may be left blank, and blank deliberately means zero.
 */

/**
 * A required amount. Blank, whitespace-only, missing or unparseable returns
 * null, which the caller must reject -- it must never be coerced to 0.
 *
 * Zero itself IS accepted when it was actually typed: a genuinely free item is
 * a real thing, and this cannot tell the caller it is not.
 */
export function requiredAmount(form: FormData, field: string): number | null {
  const raw = form.get(field)
  if (typeof raw !== 'string') return null      // missing, or a file input
  const trimmed = raw.trim()
  if (trimmed === '') return null               // blank or whitespace only
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null // NaN, Infinity, negative
  return n
}

/**
 * An optional amount, where leaving the field blank deliberately means zero --
 * a discount not given, a payment not yet made.
 *
 * Unlike requiredAmount, blank is a legitimate answer here and returns 0. A
 * value that was typed but is not a usable number still returns null, so a
 * caller can tell "nothing entered" from "nonsense entered".
 */
export function optionalAmount(form: FormData, field: string): number | null {
  const raw = form.get(field)
  if (typeof raw !== 'string' || raw.trim() === '') return 0
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n < 0) return null
  return n
}
