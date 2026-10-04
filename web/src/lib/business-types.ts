/**
 * Exactly the values in the business_type enum (migrations/0001_init.sql:41).
 * Read from the schema, not assumed -- an invented value is a failed write.
 * The labels are the owner's words for them. Shared by onboarding and by
 * "Your business" in setup, so both offer the same choices.
 */
export const BUSINESS_TYPES = [
  { value: 'restaurant', label: 'Restaurant or buka', example: 'Walk-in customers, a daily menu' },
  { value: 'caterer', label: 'Catering and events', example: 'Parties, weddings, office lunches' },
  { value: 'soup_seller', label: 'Soups and stews', example: 'Egusi, efo riro, ofe nsala' },
  { value: 'small_chops', label: 'Small chops and snacks', example: 'Puff-puff, samosa, spring rolls' },
  { value: 'baker', label: 'Bakery and pastries', example: 'Bread, cakes, meat pies' },
  { value: 'meal_prep', label: 'Meal prep', example: 'Weekly meals for regular customers' },
  { value: 'cloud_kitchen', label: 'Delivery-only kitchen', example: 'Orders by WhatsApp or apps' },
  { value: 'corporate_supplier', label: 'Supplies companies', example: 'Staff canteens, bulk orders' },
  { value: 'other', label: 'Something else', example: 'Any other food business' },
] as const

export type BusinessType = (typeof BUSINESS_TYPES)[number]['value']

export function isBusinessType(v: unknown): v is BusinessType {
  return BUSINESS_TYPES.some((t) => t.value === v)
}
