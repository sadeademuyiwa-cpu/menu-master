# Menu Master NG: Final Schema and Migration Plan

This is the single, complete document for your approval. It shows every table, the legacy mapping, the migration sequence, the costing verification, the security model, your locked decisions, and what happens after. No code has been run. No database has been changed. No screen has been touched. After you approve this document, the first thing we execute is the backup and a verified rollback.

Your locked sequence: **backup, migrate, verify, test, then build Phase 1.** Your choice: **migrate first.**

---

## PART 1: THE COMPLETE SCHEMA

Every table has a UUID primary key called id, created by the database. Every business owned table carries business_id for isolation. Timestamps are timestamptz.

### 1. businesses  (required now)
* Purpose: the account, one per vendor. The tenant everything hangs off.
* Primary key: id
* Foreign keys: owner_id to auth.users
* Important fields: name, business_type, currency (default ₦), phone, logo, location, created_at, updated_at
* Relationships: one owner. Has many of every business owned table below.

### 2. business_users  (required now)
* Purpose: who can access a business, and as what role. This is what makes real staff accounts and the two doors possible.
* Primary key: id
* Foreign keys: business_id to businesses, user_id to auth.users
* Important fields: role (owner, manager, staff), status (active, invited, disabled), created_at
* Rules: unique per business and user. At migration, one owner row is created for each vendor.

### 3. business_settings  (required now)  [your "settings" table]
* Purpose: each business's defaults.
* Primary key: id
* Foreign keys: business_id to businesses (one row per business)
* Important fields: default_margin, default_markup, default_overhead, default_packaging, default_labour, default_gas, default_transport, pricing_method (default margin), measurement_defaults, updated_at
* Relationships: one per business.

### 4. subscriptions  (required now, critical)
* Purpose: the ongoing billing state, moved off the old row so nothing is lost.
* Primary key: id
* Foreign keys: business_id to businesses (one per business)
* Important fields: plan (trial, founding, monthly, yearly), status (trialing, active, past_due, cancelled), trial_start, trial_end, current_period_end, paystack_customer_code, paystack_subscription_code
* Rules: migrated from the current trial_start and subscribed values. This decides who has paid, so it is handled with the most care.

### 5. billing_records  (create now, fills going forward)
* Purpose: a record of each individual charge or invoice from Paystack, for history and audit.
* Primary key: id
* Foreign keys: business_id to businesses, subscription_id to subscriptions
* Important fields: paystack_reference, amount, currency, plan, status (success, failed, pending), paid_at, raw (the webhook data), created_at
* Note: no old records to migrate. It starts filling from the next payment.

### 6. suppliers  (create now, fills later)
* Purpose: where ingredients are bought.
* Primary key: id
* Foreign keys: business_id to businesses
* Important fields: name, phone, notes
* Relationships: an ingredient may point to a supplier.

### 7. ingredients  (required now)
* Purpose: the price book.
* Primary key: id
* Foreign keys: business_id to businesses, supplier_id to suppliers (optional)
* Important fields: name, category, base_unit, current_unit_cost, is_active, created_at, updated_at
* Rules: unique name per business, so no duplicates. current_unit_cost is always the newest price history row. Never hard deleted if used, only set inactive.

### 8. ingredient_price_history  (required now)
* Purpose: every price a vendor has ever paid, never overwritten.
* Primary key: id
* Foreign keys: ingredient_id to ingredients
* Important fields: purchase_quantity, purchase_unit, purchase_price, calculated_unit_cost, effective_date, created_at
* Rules: append only. At migration, one seed row per ingredient captures today's cost.

### 9. measurement_units  (create now, global seeds now)
* Purpose: local Nigerian units chosen by picture, with a conversion so costing stays accurate.
* Primary key: id
* Foreign keys: business_id to businesses (null means a global default)
* Important fields: name (Derica, Mudu, Congo, Cup, and so on), picture_key, base_unit, conversion_to_base, is_active
* Note: global defaults seeded now. Each business sets its own conversions when the measurement feature is built.

### 10. menu_categories  (required now)
* Purpose: your categories, reorderable and hideable.
* Primary key: id
* Foreign keys: business_id to businesses
* Important fields: name, sort_order, is_active
* Rules: your current categories migrate here. Per your decision, we remove Sides and add Beans and Swallow.

### 11. recipes  (required now)  [production and cost side]
* Purpose: each dish and what it costs to make.
* Primary key: id
* Foreign keys: business_id to businesses, category_id to menu_categories (optional)
* Important fields: name, yield_quantity (default 1), yield_unit (default portion), packaging_cost, labour_cost, gas_cost, transport_cost, other_overhead, notes, created_at, updated_at
* Relationships: has many recipe_ingredients. Feeds a menu_item.

### 12. recipe_ingredients  (required now)  [kept, already good]
* Purpose: the link between a recipe and each ingredient, with quantity.
* Primary key: id
* Foreign keys: recipe_id to recipes, ingredient_id to ingredients
* Important fields: quantity, unit, calculated_cost
* Rules: deleting a recipe removes its links. An ingredient in use cannot be hard deleted.

### 13. menu_items  (required now)  [sellable and priced side]
* Purpose: what a customer buys, with its price and profit.
* Primary key: id
* Foreign keys: business_id to businesses, recipe_id to recipes, category_id to menu_categories
* Important fields: name, selling_price, pricing_method (margin, markup, fixed), target_margin, target_markup, recommended_price, min_price, status (profitable, low_margin, loss), is_active
* Rules: cost comes from the recipe. Margin and markup are separate fields, never mixed.

### 14. customers  (required now)
* Purpose: saved customers.
* Primary key: id
* Foreign keys: business_id to businesses
* Important fields: name, phone, email, address, notes, created_at

### 15. orders  (required now)  [full orders and catering]
* Purpose: a customer or catering order, with its profit.
* Primary key: id
* Foreign keys: business_id to businesses, customer_id to customers (optional)
* Important fields: order_type (order, catering), order_date, status, payment_status, delivery_status, discount, delivery_fee, total_revenue, total_cost, total_profit, profit_margin, created_at
* Rules: profit is calculated from its items and cost lines, not typed by hand.

### 16. order_items  (required now)
* Purpose: the dishes inside an order.
* Primary key: id
* Foreign keys: order_id to orders, menu_item_id to menu_items
* Important fields: quantity, selling_price, cost, profit
* Rules: cost is captured at the time of the order, so later price changes never rewrite past orders.

### 17. order_cost_lines  (create now, fills as used)
* Purpose: extra costs on a specific order, especially catering (packaging, labour, gas, transport, other).
* Primary key: id
* Foreign keys: order_id to orders
* Important fields: type, description, amount

### 18. sales  (create now, fills when quick sales built)
* Purpose: fast over the counter sales that do not need a full order.
* Primary key: id
* Foreign keys: business_id to businesses, customer_id to customers (optional)
* Important fields: sale_date, payment_method, subtotal, discount, delivery_fee, total, total_cost, total_profit, created_at

### 19. sale_items  (create now, fills with sales)
* Purpose: the items inside a quick sale.
* Primary key: id
* Foreign keys: sale_id to sales, menu_item_id to menu_items
* Important fields: quantity, unit_price, cost, profit

### 20. payments  (create now, fills as payments recorded)
* Purpose: money received, against an order or a sale.
* Primary key: id
* Foreign keys: business_id to businesses, order_id to orders (optional), sale_id to sales (optional)
* Important fields: amount, method, status, paid_at, created_at

**Two housekeeping tables used only during migration:**
* migration_id_map: temporarily maps each old numeric id to its new UUID, so links rebuild correctly. Removed after migration.
* A future branches table is noted but not created now, since you do not need branches yet. The schema already allows adding it cleanly later.

That is the full set: the thirteen tables required now to fully replace the current app, plus the tables created now and filled as those features arrive. Nothing here has to be thrown away as you grow.

---

## PART 2: LEGACY DATA MAPPING (nothing disappears)

| Current app_state.data | New home |
|---|---|
| the row itself (one vendor) | one businesses row, owned by that vendor, plus one business_users owner row |
| settings.bizName, currency, phone | businesses |
| settings.margin, overhead | business_settings (default_margin, default_overhead) |
| the row's trial_start, subscribed | subscriptions (plan and status derived) |
| ingredients[] | ingredients, plus one seed ingredient_price_history row each |
| recipes[] (name, category, overhead, margin) | recipes (other_overhead from overhead, yield defaults to 1) plus menu_items (target_margin from margin, selling_price computed, status computed) |
| ri[] (rid, iid, qty) | recipe_ingredients, with ids remapped and calculated_cost filled |
| customers[] | customers |
| orders[] | orders plus order_items, with cost and profit computed at migration |
| id counters | discarded, replaced by UUIDs via the temporary id map |

Every current business, ingredient, recipe, category, setting, price, cost, order, and customer has a defined destination. Nothing is dropped.

---

## PART 3: MIGRATION (non destructive, your 11 steps)

1. Create a complete backup of the app_state table.
2. Record the backup timestamp and store it with the backup.
3. Create the new relational tables (additive, app_state untouched).
4. Apply all constraints and Row Level Security to the new tables.
5. Copy existing data into the new tables using the id map, seeding price history and computing order costs. The step is idempotent, so it can be safely re run.
6. Validate record counts per vendor (ingredients, recipes, recipe ingredients, customers, orders) against the bundle. Zero mismatches required.
7. Validate relationships: no orphan links, every recipe ingredient points to a real recipe and ingredient, every menu item to a real recipe.
8. Validate important financial values: unit costs, recipe costs, and selling prices match the source.
9. Run the old versus new costing comparison in Part 4.
10. Only after all validation passes, switch the application reads and writes to the new tables.
11. Keep the legacy app_state data available, read only, for rollback until the new system is proven stable (for example 60 days).

At no point is app_state modified or deleted. It stays as a frozen, clean fallback.

---

## PART 4: COSTING VERIFICATION (old must equal new)

For a representative set of recipes, including the seeded Jollof Rice, compute with both the current engine and the new schema, and require an exact match on:
* Ingredient cost (unit cost times quantity)
* Batch cost (with yield 1, equals the recipe cost)
* Portion cost (batch cost divided by yield, equals the old cost at yield 1)
* Selling price (cost divided by one minus margin, the same formula)
* Profit (selling minus cost)
* Margin (the set percentage)

Pass rule: every value matches to the naira. Any difference halts the cutover until explained.

**Ingredient price change test.** Change one ingredient's price, then confirm all five:
* The old price is preserved in price history.
* The current ingredient cost updates to the new value.
* The recipes that use that ingredient are correctly identified.
* Those recipe costs recalculate correctly.
* The affected menu items' profitability updates correctly.

---

## PART 5: SECURITY (Row Level Security)

Row Level Security is on for every table. The rule, in plain words: you can only see or change a row if it belongs to a business you actively belong to.

* A helper resolves, for the logged in user, the set of businesses they belong to (active rows in business_users).
* Every business owned table allows a row only if its business_id is in that set.
* Child tables without their own business_id (recipe_ingredients, order_items, sale_items, ingredient_price_history) are checked through their parent.
* Role controls sensitivity. Staff get only a safe view: order taking, customers, and menu names and prices, never cost, profit, recipes, or ingredients. Owners and managers get full access. This is the database enforced version of your two doors.
* Billing (subscriptions, billing_records) is readable by members but written only by the secure server side Paystack process.

**Explicit cross business test.** Create user A in Business A and user B in Business B, each with sample data. Then prove, for ingredients, recipes, menu items, orders, customers, sales, and settings:
* A's queries return zero of B's rows.
* A cannot read, update, or delete any of B's rows, even when trying directly.
* A staff user can reach only the safe view, never cost or profit.

The cutover does not proceed unless this test passes completely. A business must never touch another business's data.

---

## PART 6: MIGRATION DECISION (locked)

**Migrate first.** No Phase 1 feature is built until all of these succeed:
* Backup succeeds.
* Migration succeeds.
* Data validation succeeds (counts and relationships).
* Costing validation succeeds (old equals new).
* Security validation succeeds (cross business test).
* Rollback is confirmed working.

---

## PART 7: AFTER MIGRATION

Once the migration is validated, we build in this order:
Foundation, then Costing, then Pricing, then Sales, then Intelligence, then SaaS.

---

## WHAT EXECUTION WILL ACTUALLY INVOLVE (honest note)

So you know exactly what you are approving, here is what the execute step means in practice, once you approve this document:

1. I produce the exact runnable package: the SQL to create every table, the Row Level Security policies, the migration script, and the test queries. I can prepare all of that for you as files.
2. That package has to be run against your live Supabase, and then the app itself has to be rewired from reading one bundle to reading these tables, which is a change to every screen.

Steps 1 and 2 are real engineering on live customer data and security. My honest recommendation stands: I prepare the full package and the tests, and a developer runs and reviews the live migration and the security rules, because a mistake there is costly. You and I own the design and the decisions, which are now done, and the testing that proves it is safe.

---

Nothing has been built, changed, or migrated. This is the design for your approval. When you approve it, the first step we take is the backup and a verified rollback, and only then the migration.
