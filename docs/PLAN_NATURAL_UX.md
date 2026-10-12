# Plan: make Menu Master feel natural

**Date:** 11 October 2026. **Status:** proposed, nothing built.
**Problem as stated by the owner:** the app is confusing, sections cannot be edited or deleted, and it does not feel natural to use.

This document has four parts: what comparable apps do and who uses them (research), what Menu Master does today (audit, from the code, nothing run), what that means (analysis), and the plan itself, in build order.

---

## 1. Research

### 1.1 How recipe-costing apps work

Every costing tool studied (meez, MarketMan, Apicbase, Craftybase, KitchenCost, Back Office, Recipe Cost Calculator) uses the same model Menu Master already has:

1. **An ingredient library**, each item with a cost per unit.
2. **Recipes built from the library** by quantity; the cost rolls up per batch and per portion.
3. **A price change flows to every recipe** that uses the ingredient. The better tools take prices from purchase invoices rather than hand entry; Menu Master already does this through Purchases.
4. **Yield and waste** adjust the cost (peeling, trimming, cooking loss).
5. **Labour and overhead** are added as separate lines, then a margin or markup gives the price.

So the model is right. The differences are in how much the user has to type, and how easily a mistake can be fixed.

**Where users of these tools complain** (Capterra, G2, Software Advice reviews):
- **Set-up effort.** The most common complaint, across MarginEdge, meez and Craftybase: entering recipes and unit conversions "takes a lot of time", "conversions are very time consuming", "conversion and yield modifiers aren't intuitive".
- **Interface.** "Don't like the user interface"; sharing and uploading "could be easier".
- **Rigid structures.** ChefTec only works when recipe data is kept clean; partial data produces costing gaps. (Menu Master's "incomplete, never zero" rule is the right response to this, but it must be *easy* to complete the data.)

**Features the better tools have that owners value:**
- **Sub-recipes** (meez): a stew made once and used in several dishes. One click to insert.
- **Scaling** (meez): change the batch size, or one ingredient, and the whole recipe recalculates. Menu Master has batch size and portions, but they cannot be edited after creation.
- **Simple overhead** (Craftybase): either a fixed overhead charge per unit, a per-hour rate, or a percentage of materials. The owner picks one; the tool does not ask for an allocation basis.
- **Labour as hours × rate** per recipe, shown as its own line (Craftybase).
- **Composite items and production** (Loyverse): selling a dish deducts its ingredients, or stock is produced in advance. This is the stock link Menu Master lacks; it is the future, not this plan.

### 1.2 Who uses this in Nigeria and how

No dedicated costing app for Nigerian food businesses turned up in searches; the alternatives owners actually use are a notebook, Excel, WhatsApp price lists, and generic POS or bookkeeping apps (Bumpa, MyTreda, Loyverse, Zoho). That is the opening.

What the Nigerian pricing guides and vendor blogs say about the market:
- **Prices change weekly.** Bakers reprice monthly because market prices move weekly. A fixed price list goes stale fast, so "latest purchase sets the cost" is exactly right, and the app must make recording a purchase quick.
- **Labour is the undercharged part.** A baking-business guide's whole argument is that bakers price ingredients only and forget their own time. Menu Master should make labour a normal, visible part of the cost, not something behind "Full costing view".
- **Caterers price per head and quote per event**, with a rule of thumb of food cost × 2.5 to 3. Quotes should separate food, small chops, drinks, serving staff, equipment, transport. Menu Master prices per portion and has no per-event quote or per-order extras.
- **Hidden costs**: crockery, chafing dishes, delivery, serving staff. These are per-order costs, not per-recipe.

### 1.3 Use cases Menu Master must feel natural for

| Who | How they work | What they need from the app |
|---|---|---|
| **Buka / rice seller** | Cooks a pot each morning, sells by the plate until it finishes | Cost per plate from today's market prices; "what should I charge"; a quick daily sales total |
| **Caterer** | Quotes per head for an event, buys for that event, pays serving staff and transport | Cost per head across a menu; one-off extras on an order; a quote they can send on WhatsApp |
| **Baker** | Takes cake orders by size; labour and decoration dominate; prices change monthly | Labour hours per cake; sizes (6", 8", tiers); edit a recipe when a design changes |
| **Small-chops / snacks** | Sells by the pack; packs of 10, 20, 50 | Sizes with packaging costs; per-pack price |
| **Drinks (zobo, smoothies, tiger nut)** | Batch of litres into bottles | Batch to bottle conversion; bottle and label as packaging |
| **Cloud kitchen / delivery** | Sells through Chowdeck and Glovo at a commission | Channel commission in the margin (designed, not built) |

A common thread: every one of them makes mistakes while typing and needs to fix them in place. None of them thinks in "reverse the purchase and re-enter every line".

---

## 2. Audit: what the app does today

Read from the code on 11 October 2026 (`web/src/app/(app)/…`, `migrations/`). Nothing was run.

### 2.1 Edit and delete, per record

| Record | Create | Edit | Delete / hide |
|---|---|---|---|
| Ingredient | yes | **no** (name, type, unit, yield % all locked) | **no** |
| Ingredient price | yes (via purchase) | no; cancel the whole purchase | via `fn_reverse_purchase` |
| Unit conversion | yes | **no**, and the dropdown hides used units, so a wrong one is permanent | **no** |
| Recipe (dish) | yes | name and batch only, only in Setup guide, only the first dish | **no**; test dishes stay in every list and in the sale picker |
| Recipe portion size, yield unit, cooking yield | at creation | **no** (the page even says "set how much one portion is, above" and there is no field) | – |
| Recipe lines | add | quantity only; unit cannot change | **hard delete** |
| Labour lines | add | **no** | **hard delete** |
| Serving format (size) | yes | **no** | **no** (shows "hidden" but nothing can hide it) |
| Format packaging | add | **no** | hard delete |
| Size attached to a dish | yes | – | **hard delete**, which blanks the size on past sales and prices |
| Purchase (draft) | yes | lines add/remove only; no date/supplier/reference edit | discard |
| Purchase (posted) | – | cancel whole purchase, then **re-enter every line** | leaves an extra "Cancelled · 0 items" row dated today |
| Sale (draft) | yes | lines add/remove only; no quantity/price/customer/date edit | discard |
| Sale (confirmed) | – | payment only | void; reissue creates an **empty** replacement to retype |
| Customer | yes | yes | **no** |
| Supplier | yes | **no** | hide; **no unhide** |
| Kind of work (labour rate) | yes | **no**; changing a wage = hide, re-add, then redo every recipe | hide; no unhide |
| Running cost (overhead) | yes | **no** | hide; no unhide |
| Business name / type | onboarding | only in Setup guide step 1 | – |
| Locations | auto, hidden | **no UI** | – |
| Members | invite | role | remove (permanent) |
| Selling price | append | cannot clear | – |
| Target margin, rounding, costing window | defaults (40 %, ₦50, 90 days) | **no UI** | – |
| Units (mudu, congo, derica, paint bucket) | schema allows | **no UI** | – |

Pattern: **create is everywhere, edit almost nowhere, and "Remove" is usually a permanent delete.** The database's "never rewrite history" rule was applied to the UI as "never let the user change anything", which is a different thing.

### 2.2 Confusing spots

- **Dates as `2026-10-11`** on purchases, sales, price history, customer history, reports. The `en-NG` format is used only on account and billing screens.
- **Codes shown raw**: reversal purchases labelled "(reversal)", reissued sales "-R2", a raw ID in reports, "g — gram", refusals that just swap underscores for spaces, "not available on this database yet (migration 0056)".
- **Jargon**: Full costing view, costing window, Margin (share of the price), Markup, Gross profit, Coverage, Revenue without cost, Voided, default channel, inputs priced, Sub-recipe, Needs measure, base unit.
- **Contradictions**: Settings collects gas and electricity as running costs; the recipe page says "Gas, electricity and water are not tracked yet". Running costs are missing from the "Where the batch cost goes" bar.
- **One thing, five names**: format / size / Selling sizes / How you sell it / Sizes you sell; per serving / per portion.
- **Settings "How you price"** shows target margin and rounding as read-only. The Home shortcut "Costs & targets" leads there, where targets cannot be changed.
- **Overhead form** asks "How much do you produce in a month? Measured in?" then per bill "Spread across how much? Of what?" This is an accountant's allocation basis. Craftybase asks one question.
- **Labour is hidden** behind "Full costing view", the opposite of what the baker guides say owners get wrong.
- **Setup guide is the only editor** for the dish name and business name, and it reads like a one-time wizard.
- **Home has no money.** The dashboard lists tasks but never says what was sold or kept this week.
- **Header shows the email address**, not the business, and wraps on a 360 px phone.
- **Visuals**: one icon in the whole app, underlined "Update / Remove" text links, grey outline badges, bottom-bar navigation stretched across a desktop screen.
- **Lists**: purchases capped at 50, sales at 40, no search or paging; voided sales only under Reports.
- Bug: the ingredient page's price history and "Latest price" include cancelled purchases (`ingredients/[id]/page.tsx:162-193`).

---

## 3. Analysis

1. **The costing engine is a strength; the editing layer is missing.** Competitors' users complain about set-up effort even *with* edit-in-place. Menu Master has the same set-up effort and no way to fix typing mistakes. That alone makes it feel hostile: one wrong conversion or batch size and the owner has to start over.

2. **"Immutable history" has been confused with "immutable records".** The database is right to keep posted purchases, confirmed sales and cost snapshots unchanged. But a dish's name, portion size, a draft's lines, a supplier's phone number and a wage rate are *current facts*, not history. They should edit in place, with the change logged. The rule should be:
   - **Draft**: edit anything, delete freely.
   - **Current fact** (names, sizes, rates, thresholds, conversions): edit in place; keep an audit row; old snapshots keep the old value.
   - **Posted / confirmed** (purchases, sales): never edit; offer **"Correct this"** which does cancel + re-create *pre-filled* in one step, as the Setup guide already does for the first purchase.
   - **Anything with history**: archive (hide), never hard delete, and always allow un-hide.

3. **The owner's mental model is "my kitchen", not "cost accounting".** Jargon, ISO dates, allocation bases and "costing window" come from the design documents, not from how a buka owner talks. The fix is wording plus hiding the precise controls behind a simple default, not removing the precision.

4. **Labour and overhead are back to front.** Research says labour is what owners forget, so it should be a normal line in "what goes into one pot". Overhead should default to one simple question ("Add how much on top of each plate for rent, gas and light?" as ₦ or %) with the per-bill allocation as an optional precise mode.

5. **Home must show money.** Every competitor's home shows a number. The owner who has recorded sales should see "This week: sold ₦X, kept ₦Y" before any task list.

6. **The look is costing trust.** A paid app that is about to be advertised needs icons, colour-coded statuses, buttons instead of underlined links, and a desktop layout. My Stock's visual system (see the comparison of 11 Oct) is a ready reference for this.

7. **Caterers and bakers need per-order extras and quotes.** Serving staff, delivery, crockery and transport are per-event costs. Today a sale can only hold dishes and a discount. Adding "extras" lines (with a cost and a price) and a shareable quote covers the caterer and baker use cases without touching the costing engine.

---

## 4. The plan

Ordered so that each phase is shippable on its own and the most painful problems go first. Every database change follows the existing rule: `migrations/proposed/`, a rollback, an acceptance suite in `tests/`, PRE_DEPLOY / POST_VERIFY in `deploy/runbook/`.

### Phase 0: quick wins, no database change (1 to 2 days)

**Built 11 Oct 2026** (typecheck clean, unit 132/132, production build passing; browser journey not re-run). Done: `formatDay`/`formatMoment` on every list and header; business name in the header; `saleLabel` and `purchaseReference` hide the `-R2` and `(reversal)` markers; the wording list below; the running-costs footnotes follow the overhead switch; cancelled purchases no longer count as "Latest price"; "Costs & targets" renamed "Wages & running costs". Not done here: the running-costs share in the batch bar (overhead is per portion, the bar is per batch; revisit in Phase 2 with the simple overhead mode).

- One `formatDate()` helper (`web/src/lib/dates.ts` exists) used everywhere: "11 Oct 2026", "Today", "Yesterday". Remove every raw ISO date and database timestamp listed in §2.2.
- Header: business name on the left, a profile circle on the right (menu: Account, Settings, Sign out). Email address goes to Account.
- Remove developer text ("migration 0056"), raw IDs, "(reversal)" and "-R2" labels. Show "Cancelled" and "Replacement of #123" instead.
- Wording pass (one list, applied everywhere):
  - Full costing view → "See every cost"
  - Costing window → "Prices from the last 90 days"
  - Margin (share of the price) → "Profit on each plate" (keep the % in brackets)
  - Markup → remove from default view; keep under "See every cost"
  - Gross profit → "Money kept"; Revenue → "Money in"; Coverage → "Sales with a known cost"
  - Voided → "Cancelled"; Sub-recipe → "Made from another dish"; Needs measure → "Needs a measure"; base unit → "measured in"
  - Serving format / size / Selling sizes → one word: **"Size"** everywhere. Per serving → "per plate" (per portion where the dish is not plated).
- Fix the contradiction: the recipe footnote about gas, electricity and water reflects the overhead switch. Add running costs to the "Where the batch cost goes" bar when switched on.
- Fix the bug: ingredient price history and "Latest price" must skip reversed purchases.
- "Costs & targets" shortcut must lead somewhere targets can be changed (see Phase 2) or be renamed until then.

### Phase 1: edit and delete everywhere (1 to 2 weeks)

**Built 11 Oct 2026, awaiting the production gate for 0060.** What shipped
differs from the sketch below in one way that made it smaller: the audit of
row policies showed that almost every edit the app lacked was already
*permitted* by RLS (0015/0028) and only lacked a screen. So `0060` adds just
what a client cannot do safely alone: `fn_correct_purchase` (one transaction),
`fn_reissue_order` that copies the lines, `fn_recompute_business_recipes`
(after a wage or bill changes), `customers.deleted_at`,
`purchases.replaced_by`, and a trigger locking an ingredient's base unit once
something is measured in it. Everything else is screens: edit-in-place on the
dish (name, group, batch, unit, portion, cooking loss), recipe lines (unit as
well as quantity), labour hours, ingredient (name, kind, yield, measure while
free), local measures (edit and remove), sizes (name, capacity, hide/show),
packaging quantities, suppliers (edit, hide/show), customers (put away/bring
back), wages and bills (edit, hide/show, recompute), target margin / rounding
/ price window, business name and type; draft purchases and sales edit their
header and lines; a recorded purchase has "Correct this purchase"; a
cancelled sale's replacement carries its items; dishes and ingredients are
put away and brought back; purchases, sales and recipes lists have search and
"show older"; the reversal bookkeeping twin is no longer listed. Verification:
`tests/046` 25/25, full suite 44 suites, `web/e2e/journey-edit.mjs` 39/39, and the
existing journeys (see the commit). Not done: account-level units UI (the
Nigerian measures already exist in `units` from 0003, so nothing was needed).

**Database (one proposed migration, `0060_edit_and_archive.sql`):**
- `archived_at` on `recipes`, `serving_formats`, `ingredients`, `customers` (suppliers, labour_rates and overhead_items already have `is_active`). Every list filters archived rows; an "Archived" toggle shows them with "Restore".
- `fn_update_recipe(id, name, batch_yield_qty, yield_unit, portion_qty, portion_unit, cooking_yield_pct, category)`: updates current facts, writes an audit row, then takes exactly one new cost snapshot (same rule as the Setup guide's F3).
- `fn_update_recipe_line(id, qty, unit)` and `fn_update_labour_line(id, hours, rate_id)`: edit in place, one snapshot after.
- `fn_update_ingredient(id, name, kind, base_unit, purchase_yield_pct)`: base unit changes only while no purchase or recipe line uses it; otherwise refuse with a plain reason.
- `fn_replace_conversion(ingredient, unit, factor)`: upsert, audit the old factor.
- `fn_update_serving_format`, `fn_update_packaging_line`, `fn_update_supplier`, `fn_update_labour_rate`, `fn_update_overhead_item`, `fn_update_business(name, type)`, `fn_set_pricing_settings(target_margin, rounding, wavg_window_days)`.
- `fn_restore_*` (or a shared `fn_set_active(table, id, bool)`) for every hideable record.
- `fn_update_draft_purchase(header, lines)` and `fn_update_draft_order(header, lines)`: full edit of drafts, including quantity, price, date, supplier, customer.
- `fn_correct_purchase(original_id, new_header, new_lines)`: one transaction that posts the corrected purchase, reverses the original, keeps it as "Cancelled, replaced by #N", and does **not** create the empty reversal row. Same shape as the Setup guide's step-2 revisit, generalised.
- `fn_reissue_order` to copy the lines into the replacement and keep the original date, and to refuse a second replacement.
- A deletion guard for recipe variants: refuse removal once the size has a confirmed sale; offer archive instead.
- Units: `fn_add_unit(name, kind, factor_to_base)` for account units, seeded with a Nigerian starter list the owner can edit: mudu, derica, congo, paint bucket, bag (50 kg), half bag, crate (30 eggs), basket, bunch, wrap, piece.

**Web:**
- Every detail page gets an **Edit** button that opens the same form used to create, pre-filled. Every list row gets "…" with Edit / Hide / Restore.
- Recipe page: "What goes into one pot" becomes an editable table (quantity, unit, remove) with labour rows in the same table, not behind "See every cost".
- Purchases and sales detail: "Correct this" on posted/confirmed records, opening the pre-filled form.
- Settings: editable target margin, rounding, price window; Edit on kinds of work and running costs; Restore on hidden items.
- Setup guide stays, but is no longer the only editor of anything.
- Lists: search box and "Show more" on purchases, sales, ingredients, recipes; Cancelled sales visible in the Sales list with a filter.

**Tests:** a new SQL suite `tests/043_edit_and_archive.sql` (edit then snapshot count = 1, archive hides and restore returns, correction keeps history, variant guard), and `web/e2e/journey-edit.mjs` (rename a dish, fix a quantity, fix a conversion, correct a purchase, hide and restore a size).

### Phase 2: make it feel natural (1 week)

**Built 12 Oct 2026.** Less than sketched, because the code was already past
the screenshots this plan was judged from: the five tabs already had icons,
badges were already coloured, and the action tiles already carried icons.
What was actually missing and is now in: the money card on Home ("Sold this
week", "You kept this week", against last week, from `v_sales_summary`); a
raised "+" on phones opening a sheet with the four things an owner records
(hidden on the screens that are one of them); a left sidebar from 1024px with
the five destinations, Settings and Account; a distinct red for "selling below
cost" (amber stays "look"); "Update / Remove / Hide" as small bordered pills
instead of grey text, with a one-line confirm on the irreversible ones
(remove a line, discard a draft, cancel a sale or purchase); "Time it takes"
(labour) on the simple recipe view, not only behind "See every cost"; the
running-costs screen reduced to the switch, "how much you make in a month",
and bills with a name and a cost, with the spread-across-something-else
option folded away. Not done: a percentage or per-plate overhead shortcut
(the engine allocates by output; a shortcut would be a second engine), and
"Why?" folds on the recipe page beyond what SectionHeading already does.

- **Home money card**: "This week · Sold ₦X · Kept ₦Y · N sales", with last week in small text. Uses the existing `v_sales_reporting`/dashboard views. Below it the task list as today, then quick actions.
- **Navigation**: icons on the five tabs; a raised centre **+** on phones opening "Record a sale / Record a purchase / New dish / New ingredient". A left sidebar from 1000 px up; the bottom bar only on phones.
- **Statuses in colour**: Costed green, Ready to sell green, Price needed amber, Low margin amber, Below cost red, Incomplete grey. One `Status` component.
- **Buttons, not links**: Update / Remove / Hide become buttons; destructive ones ask once.
- **Labour on the recipe**: "Time it takes: 2 h of Cooking at ₦1,500/h" as one row the owner can add from the recipe page; the kinds of work list is managed from Settings but also addable inline.
- **Overhead, simple mode** (Settings → "Running costs"): "Add to every plate: [₦ ___] or [___ %] of its cost. Why? Rent, gas, light and airtime." The existing per-bill allocation moves under "Work it out from my bills" and fills the same number. The recipe page shows "Running costs ₦X per plate" as a normal line.
- **Explanations folded**: each long paragraph becomes a one-line sentence plus "Why?" that expands.
- **Phone header** fits at 360 px; business name truncates with an ellipsis.

### Phase 3: use-case flows (1 to 2 weeks)

**Built 12 Oct 2026, awaiting the production gates for 0061 and 0062 (after 0060).**
Two migrations. `0062_sub_recipe_lines` fixes a latent fault the new
sub-recipe screen exposed: `v_recipe_line_costs` (0034) called the purchase-
evidence function with a null ingredient for a sub-recipe line and raised, so
the whole ingredient list vanished for any dish made from another dish; the
view is rebuilt (same 22 columns), and such a line now shows its cost from the
other dish's batch. `0061_extras_cost`: `order_lines.extra_unit_cost`, frozen into
`unit_cost_at_sale` by `fn_confirm_order` for non-dish lines only, copied by
`fn_reissue_order`, and `v_sale_lines` reading a costed extra as `costed`.
Policies and function count unchanged. Screens: "What one costs you" on a
not-on-the-menu item (order screen and draft page); "Send as a quote" on any
draft sale, with the same WhatsApp and copy buttons as the receipt;
`/quote`, the per-head calculator (guests × what each gets → food cost per
guest, price at your list, price to keep your margin, WhatsApp text) linked
from Sales and More; "Add a dish you make" on the recipe page (sub-recipes,
which the engine already costed); "Scale the batch" under Edit this dish
(every quantity and hour of work scales, one snapshot). Not done: a quote as
its own record with a validity date (the draft is the quote; it converts by
confirming), and prefilling the order screen from the per-head calculator.

- **Extras on a sale**: lines that are not dishes, with a cost and a price (serving staff, delivery, crockery, drinks bought in). They count in money in and money kept; they never touch recipe costs. Replaces the current "Something not on your menu" note with a real line.
- **Quote**: a sale saved as a quote (status before draft) with a shareable WhatsApp text and link, converting to a sale on confirmation. Covers caterers and bakers. Uses the existing WhatsApp receipt code path.
- **Per-head view for a menu**: pick several dishes and a head count; see cost per head and suggested price per head with the owner's margin. Read-only calculator over existing data.
- **Made from another dish** (sub-recipe) in the UI: add a dish as an ingredient of another at a quantity; the engine already supports it (the "Sub-recipe" term exists); it needs the picker and wording.
- **Scaling**: change batch size on the recipe page and watch quantities scale, saved as the new recipe (Phase 1's `fn_update_recipe` makes this safe).

### Phase 4: verify and ship

- Update `web/e2e/journey.mjs` for the new header, nav and home card; run the 360/390 audit; regenerate `web/e2e/shots/`.
- Rehearse `0060` on a repository-built replica; PRE_DEPLOY / POST_VERIFY; owner applies with psql as before.
- Update `STATUS.md` and `docs/LAUNCH_CHECKLIST.md`.
- Ask three real users (one buka, one caterer, one baker) to do five tasks each: fix a wrong quantity, rename a dish, correct a purchase, change a wage, find what they kept this week. Note where they stall. That is the acceptance test for "feels natural".

### What this plan does not do

- No stock on hand, no deduction of ingredients on sale (the My Stock comparison covers that; it is a separate decision).
- No tax, no channel commission, no closed periods (E1, E3, E4 stay as designed).
- No new languages.

---

## 5. Sources

Research: [FoodCore guide to recipe costing software](https://foodcore.io/blog/best-recipe-costing-software-small-food-businesses) · [Craftybase recipe costing](https://craftybase.com/recipe-costing-software) and [overhead guidance](https://craftybase.com/blog/how-to-calculate-overhead-costs-handmade-business) · [meez scaling help](https://intercom.help/getmeez/en/articles/4699925-scaling-recipes) and [meez reviews on Capterra](https://www.capterra.com/p/246573/meez/reviews/?page=2) · [MarginEdge reviews on Capterra](https://www.capterra.com/p/187718/MarginEdge/reviews/) and [Software Advice](https://www.softwareadvice.com/retail/marginedge-profile/reviews/) · [Loyverse composite items](https://help.loyverse.com/help/how-create-composite-item) and [production](https://help.loyverse.com/help/how-work-production) · [Nigerian catering pricing formula](https://naijasabi.com.ng/how-to-start-catering-business-nigeria-2026-cost-equipment-clients/) · [Lagos catering costs 2026](https://wakawork.com/blog/catering-cost-lagos) · [Cake prices in Nigeria](https://www.yefepere.com/blog/cake-prices-in-nigeria-updated-2025-guide/) · [Baking business labour pricing](https://bakingbusinessschoolblog.wordpress.com/2017/07/03/how-i-made-n100000-for-one-cake-order/) · [Inventory apps in Nigeria](https://blog.microepay.com/posts/best-inventory-management-apps-nigeria) · [MyTreda comparison](https://mytreda.com/blog/best-inventory-management-software-nigeria).

Audit: code read on 11 Oct 2026 by a search agent; file and line references are in §2 and in the agent's report kept with this session.
