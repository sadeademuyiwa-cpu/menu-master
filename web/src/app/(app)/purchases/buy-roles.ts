/**
 * Who may do what on the buying screens, as the database decides it.
 *
 * These only choose which buttons and forms a page draws. Row-level security
 * is still the authority (migrations/0015_write_side_role_enforcement.sql),
 * and would refuse the write if these were wrong. Kept free of React and the
 * '@/' alias so they can be tested directly.
 *
 * Costs are a separate rule: canSeeCosts in '@/lib/pricing' (fn_can_see_costs,
 * 0004). Every figure of money on these screens is read only when it is true.
 */

/** purchases and purchase_lines: INSERT and UPDATE (0015), and fn_post_purchase. */
export const PURCHASE_ROLES = ['owner', 'manager', 'accountant'] as const

/** ingredients: INSERT and UPDATE (0015). Putting an item away is an update. */
export const ITEM_ROLES = ['owner', 'manager', 'kitchen'] as const

/** ingredient_unit_conversions: INSERT and UPDATE (0015). "How much is one paint?" */
export const MEASURE_ROLES = ['owner', 'manager', 'kitchen'] as const

/** ingredient_unit_conversions: DELETE (0015). */
export const MEASURE_REMOVE_ROLES = ['owner', 'manager'] as const

/** suppliers: INSERT and UPDATE (0015). Hiding one is an update. */
export const SUPPLIER_ROLES = ['owner', 'manager', 'accountant'] as const

/**
 * What an UPDATE or DELETE that changed no row says. Row-level security
 * refuses those quietly, with no error and zero rows (a lapsed subscription
 * does it to every role), so the screens ask for the changed rows back and
 * say this rather than "Saved." The row may also have gone or moved on in
 * another tab; this does not guess which.
 */
export const NOT_CHANGED =
  'Nothing was changed. It may have been changed already, or your subscription ' +
  'or your role on this account does not allow it at the moment.'

const has = (roles: readonly string[], role: string | null | undefined) => roles.includes(role ?? '')

/** Record, correct, cancel or finish a purchase. Not kitchen and not sales. */
export function canRecordPurchases(role: string | null | undefined): boolean {
  return has(PURCHASE_ROLES, role)
}

/** Add, rename or put away an item. */
export function canEditItems(role: string | null | undefined): boolean {
  return has(ITEM_ROLES, role)
}

/** Say how much one paint, bag or derica of an item holds, or correct it. */
export function canAddMeasures(role: string | null | undefined): boolean {
  return has(MEASURE_ROLES, role)
}

export function canRemoveMeasures(role: string | null | undefined): boolean {
  return has(MEASURE_REMOVE_ROLES, role)
}

export function canEditSuppliers(role: string | null | undefined): boolean {
  return has(SUPPLIER_ROLES, role)
}
