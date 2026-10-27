/**
 * The plain-text receipt an owner sends a customer, and the WhatsApp link
 * that carries it.
 *
 * Kept free of React and Next so it is tested directly. Every figure passed
 * in comes from the confirmed sale in the database (v_sale_lines); nothing is
 * calculated here except adding up lines the database already priced.
 */

export type ReceiptLine = {
  name: string
  qty: number
  unitPrice: number
  /** qty x unitPrice, before any discount. */
  gross: number
}

export type Receipt = {
  businessName: string
  date: string
  reference: string | null
  customerName: string | null
  lines: ReceiptLine[]
  /** Every discount on the sale, line and whole-sale, added together. */
  discount: number
  /** What the customer pays. */
  total: number
  /**
   * What the customer has paid so far (orders.amount_paid), when the sale is
   * part paid. A deposit on a cake order is the common case: the customer
   * needs to see what they paid and what is still to pay. Null or absent
   * when the sale is paid in full or not paid at all; nothing is printed then.
   */
  paid?: number | null
}

/*
  A receipt is a record of what was paid, so it keeps every kobo: ₦850 for
  whole naira, ₦218.75 when there are kobo, judged to the kobo first so a
  float such as 0.1 + 0.2 reads ₦0.30. Up to ₦100 this is the same as
  money() in lib/format (decision 4: no .00). From ₦100 up money() drops the
  kobo on the app's summary figures; a receipt never does, or the lines would
  not add up to the total the customer pays.
  Anything that shows a customer's figures -- the receipt card on a sale,
  the per-head quote -- formats with receiptMoney, so the screen and the text
  sent agree to the kobo.
  Kept here rather than imported because node --test cannot resolve
  '@/lib/format'. tests/receipt-and-dates.test.mts holds the two to each other.
*/
const nairaWhole = new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 0,
})
const nairaKobo = new Intl.NumberFormat('en-NG', {
  style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
export function receiptMoney(n: number): string {
  const kobo = Math.round(n * 100)
  const naira = kobo / 100 + 0 // + 0 turns -0 into 0
  return kobo % 100 === 0 ? nairaWhole.format(naira) : nairaKobo.format(naira)
}
const fmt = receiptMoney
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('en-NG'))

/**
 * A sale date the way it is written on paper: "2 Oct 2026". Never "Today": a
 * receipt sits in a WhatsApp chat for months, and "Today" would change
 * meaning tomorrow. Takes the database's YYYY-MM-DD; anything else is
 * returned as it came, so a date is never invented.
 */
export function receiptDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))))
}

/** The item lines, shared by the receipt and the quote so both read alike. */
function itemLines(lines: ReceiptLine[]): string[] {
  return lines.flatMap((l) => [`${qtyText(l.qty)} × ${l.name}`, `   ${fmt(l.unitPrice)} each = ${fmt(l.gross)}`])
}

/** WhatsApp formatting: *bold*. One line per item, totals last. */
export function buildReceipt(r: Receipt): string {
  const rule = '────────────'
  const out = [`*${r.businessName}*`, `Receipt · ${r.date}`]
  if (r.reference) out.push(`Ref: ${r.reference}`)
  if (r.customerName) out.push(`For: ${r.customerName}`)
  out.push(rule, ...itemLines(r.lines), rule)
  if (r.discount > 0) out.push(`Discount: −${fmt(r.discount)}`)
  out.push(`*Total: ${fmt(r.total)}*`)
  // Only a real part payment: a figure between nothing and the whole total.
  if (typeof r.paid === 'number' && Number.isFinite(r.paid) && r.paid > 0 && r.paid < r.total) {
    out.push(`Paid so far: ${fmt(r.paid)}`, `*Still to pay: ${fmt(r.total - r.paid)}*`)
  }
  out.push('', 'Thank you for your order.')
  return out.join('\n')
}

export type Quote = Omit<Receipt, 'reference' | 'paid'> & {
  /** How long the prices hold, in days. */
  validDays: number
}

/**
 * A quote: the same lines as a receipt, said before the sale. Caterers and
 * bakers price per event; the draft order is the quote, and confirming it
 * later is the sale. Prices are the owner's own; nothing is suggested here.
 */
export function buildQuote(q: Quote): string {
  const rule = '────────────'
  const out = [`*${q.businessName}*`, `Quote · ${q.date}`]
  if (q.customerName) out.push(`For: ${q.customerName}`)
  out.push(rule, ...itemLines(q.lines), rule)
  if (q.discount > 0) out.push(`Discount: −${fmt(q.discount)}`)
  out.push(`*Total: ${fmt(q.total)}*`)
  out.push('', `Prices hold for ${q.validDays} day${q.validDays === 1 ? '' : 's'}. Reply to confirm.`)
  return out.join('\n')
}

/**
 * A Nigerian phone number in the international form wa.me expects: digits
 * only, country code first. "0803 123 4567" -> "2348031234567". Returns null
 * when the number cannot be a phone number, so the caller opens WhatsApp
 * without a recipient instead of messaging a stranger.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  // "+234 0803…": the 0 kept after the country code would make 14 digits.
  if (d.startsWith('2340')) d = '234' + d.slice(4)
  if (d.startsWith('0')) d = '234' + d.slice(1)
  else if (d.length === 10 && /^[789]/.test(d)) d = '234' + d   // 803... without the leading 0
  return d.length >= 11 && d.length <= 15 ? d : null
}

export function whatsappLink(phone: string | null | undefined, text: string): string {
  const to = whatsappNumber(phone)
  return `https://wa.me/${to ?? ''}?text=${encodeURIComponent(text)}`
}
