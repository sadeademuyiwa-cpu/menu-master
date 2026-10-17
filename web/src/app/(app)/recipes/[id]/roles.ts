/**
 * Who may change what on a dish page, as the database decides it.
 *
 * These are COURTESIES for showing a form, never the check: RLS refuses
 * anyone else whatever these say. They exist so a sales member is not shown
 * an "Add an ingredient" form the database will only refuse, and so an
 * accountant, who may set prices but not change a dish, sees the money and
 * not a row of forms that fail.
 *
 * Money is decided elsewhere: canSeeCosts / canSetPrices /
 * canSeeSellingPrices in lib/pricing.ts, canAddDishPhotos in
 * lib/dish-photo.ts.
 */

const has = (roles: readonly string[], role: string | null | undefined) => roles.includes(role ?? '')

/**
 * Change the dish itself, what goes in, its hours of work and its sizes:
 * owner, manager and kitchen. The INSERT/UPDATE/DELETE policies on recipes,
 * recipe_lines, recipe_labour and recipe_variants (0015, 0028).
 */
export const DISH_EDIT_ROLES = ['owner', 'manager', 'kitchen'] as const

export function canEditDish(role: string | null | undefined): boolean {
  return has(DISH_EDIT_ROLES, role)
}

/**
 * Add a kind of paid work and its rate (labour_rates INSERT, 0015:68):
 * owner, manager and accountant. Kitchen is told to ask the owner.
 */
export const WORK_RATE_ROLES = ['owner', 'manager', 'accountant'] as const

export function canAddKindsOfWork(role: string | null | undefined): boolean {
  return has(WORK_RATE_ROLES, role)
}

/** Make a new size (serving_formats INSERT): owner and manager only. */
export const SIZE_ROLES = ['owner', 'manager'] as const

export function canMakeSizes(role: string | null | undefined): boolean {
  return has(SIZE_ROLES, role)
}
