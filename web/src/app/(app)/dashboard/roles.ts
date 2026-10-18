/**
 * What each role may RECORD, for showing only the buttons a person can use:
 * Home's "Record a sale" and "Record a purchase", and the phone's "+".
 *
 * The write matrix is migrations/0015_write_side_role_enforcement.sql, as the
 * database holds it today:
 *   orders, order_lines, sales_entries   owner, manager, sales (and a plan with Sales)
 *   purchases, purchase_lines            owner, manager, accountant
 *   recipes, ingredients                 owner, manager, kitchen
 * Kitchen cannot record a purchase and accountant cannot record a sale. A
 * button for either would land them on a form the database will refuse.
 *
 * A COURTESY, never an authorization: RLS refuses a write whatever this says.
 * Kept free of React and Next so it can be tested directly.
 */

type Role = string | null | undefined

const has = (roles: readonly string[], role: Role) => roles.includes(role ?? '')

export const SALE_ROLES = ['owner', 'manager', 'sales'] as const
export const PURCHASE_ROLES = ['owner', 'manager', 'accountant'] as const
export const DISH_ROLES = ['owner', 'manager', 'kitchen'] as const

/**
 * Record a sale. `salesPlan` is hasSalesEntitlement(): false on a
 * Costing-only plan; null when it could not be read, which is treated as
 * "do not claim either way", as everywhere else.
 */
export function canRecordSales(role: Role, salesPlan: boolean | null): boolean {
  return has(SALE_ROLES, role) && salesPlan !== false
}

/**
 * Record money received on a sale that was already confirmed. Deliberately
 * NOT tied to the plan or the trial: fn_record_order_payment (0066) lets
 * owner, manager and sales settle a confirmed, not-cancelled sale whatever
 * either says, because a balance paid later is for work already done (D2).
 * Kitchen sees no money and accountant does not take it.
 */
export function canRecordPayments(role: Role): boolean {
  return has(SALE_ROLES, role)
}

export function canRecordPurchases(role: Role): boolean {
  return has(PURCHASE_ROLES, role)
}

/** A new dish, or a new item on the ingredient list: the same three roles. */
export function canAddDishes(role: Role): boolean {
  return has(DISH_ROLES, role)
}

/** The guided setup and its checklist: the owner's and manager's job (lib/setup-gate.ts). */
export function runsSetup(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

export type QuickAction = {
  href: string
  icon: 'sales' | 'purchases' | 'recipes' | 'ingredients'
  label: string
  meta: string
}

/**
 * The phone's "+", for this role. "Add an item" opens the add form itself
 * (?add=1), not the top of a list of 180 starter items.
 */
export function quickActions(role: Role, salesPlan: boolean | null): QuickAction[] {
  const out: QuickAction[] = []
  if (canRecordSales(role, salesPlan)) {
    out.push({ href: '/sales/new', icon: 'sales', label: 'Record a sale', meta: 'What you sold' })
  }
  if (canRecordPurchases(role)) {
    out.push({ href: '/purchases/new', icon: 'purchases', label: 'Record a purchase', meta: 'What you paid' })
  }
  if (canAddDishes(role)) {
    out.push({ href: '/recipes/new', icon: 'recipes', label: 'New dish', meta: 'Cost what you make' })
    out.push({ href: '/ingredients?add=1', icon: 'ingredients', label: 'Add an item', meta: 'An ingredient or packaging' })
  }
  return out
}
