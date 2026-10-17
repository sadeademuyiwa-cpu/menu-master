import { NOT_ENTERED } from '@/lib/format'
import { receiptMoney } from '@/lib/receipt'

/**
 * A price as it is typed, saved and charged: ₦1,450 when it is whole naira,
 * ₦1,450.50 when it has kobo. money() rounds anything from ₦100 up to whole
 * naira, which is right for an estimate ("you keep about ₦213") but wrong for
 * a price: "Save ₦1,451" would post 1450.50, and the receipt the customer gets
 * says ₦1,450.50. This is the receipt's own rule (receiptMoney), so the price
 * form, the fix and the receipt read the same. Costs, what she keeps and
 * margins stay on money().
 */
export function charged(value: number | null | undefined, absent: string = NOT_ENTERED): string {
  return value === null || value === undefined || !Number.isFinite(value) ? absent : receiptMoney(value)
}
