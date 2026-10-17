/**
 * What each role can do, in the app's own words: Dishes, not recipes.
 *
 * lib/people/format.ts still carries the older hints ("Recipes and
 * purchases"), and one of them was wrong: kitchen has never been able to
 * record a purchase (purchases INSERT is owner, manager and accountant, 0015).
 * These follow the database as it is after 0063 and 0064: kitchen adds dish
 * photos, and sales sees what a dish sells for but never what it costs. Until
 * the shared hints are brought into line, this page reads these.
 */
export const ROLE_HINTS: Record<string, string> = {
  owner: 'Everything, including billing and who is on the account.',
  manager: 'Dishes, costs, prices, purchases and sales. Cannot invite people or pay.',
  accountant: 'Costs, prices, purchases and reports. Cannot change dishes or record sales.',
  kitchen: 'Dishes, ingredients and dish photos. Sees no costs or prices.',
  sales: 'Sales and customers, with selling prices. Never sees costs.',
}

export function roleHint(role: string): string {
  return ROLE_HINTS[role] ?? ''
}
