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
}

const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })
const fmt = (n: number) => naira.format(n)
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('en-NG'))

/** WhatsApp formatting: *bold*. One line per item, totals last. */
export function buildReceipt(r: Receipt): string {
  const rule = '────────────'
  const out = [`*${r.businessName}*`, `Receipt · ${r.date}`]
  if (r.reference) out.push(`Ref: ${r.reference}`)
  if (r.customerName) out.push(`For: ${r.customerName}`)
  out.push(rule)
  for (const l of r.lines) {
    out.push(`${qtyText(l.qty)} × ${l.name}`)
    out.push(`   ${fmt(l.unitPrice)} each = ${fmt(l.gross)}`)
  }
  out.push(rule)
  if (r.discount > 0) out.push(`Discount: −${fmt(r.discount)}`)
  out.push(`*Total: ${fmt(r.total)}*`)
  out.push('', 'Thank you for your order!')
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
  if (d.startsWith('0')) d = '234' + d.slice(1)
  else if (d.length === 10 && /^[789]/.test(d)) d = '234' + d   // 803... without the leading 0
  return d.length >= 11 && d.length <= 15 ? d : null
}

export function whatsappLink(phone: string | null | undefined, text: string): string {
  const to = whatsappNumber(phone)
  return `https://wa.me/${to ?? ''}?text=${encodeURIComponent(text)}`
}
