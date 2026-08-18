# Menu Master NG: Architecture Validation Checkpoint

You asked for a final architecture check before any building. Here it is, from your real file. No code was written. No database was changed. No screen was changed. This is only the truth about your data, so you can approve the foundation before we build on it.

---

## 1. THE CURRENT DATA MODEL

Menu Master NG uses **one** place to store data: a single Supabase table called **app_state**, holding **one row per vendor**. Inside that row, one field called **data** holds a bundle (JSON) that contains all the vendor's collections. There is also a copy kept on the device (localStorage) for speed.

So there are no separate tables yet. There is one row, and inside it, several collections. Here they are, each treated as if it were a table.

**app_state (the container row)**
* Purpose: holds everything for one vendor.
* Important fields: vendor_id (which vendor), data (the whole bundle below), updated_at, trial_start, subscribed, welcomed.
* Relationships: one row belongs to one logged in vendor.
* Depended on by: the entire app, the paywall (trial_start, subscribed), and the welcome popup (welcomed).

**settings (object inside data)**
* Purpose: business defaults.
* Important fields: overhead, margin, bizName, bizTag, currency, phone.
* Depended on by: every recipe cost that does not set its own overhead or margin.

**ingredients (list)**
* Purpose: the price book.
* Important fields: id, name, category, unit, cpu (cost per unit), updated (date).
* Relationships: referenced by recipe ingredients through the ingredient id.
* Depended on by: all recipe costing.

**recipes (list)**
* Purpose: each dish.
* Important fields: id, name, category, overhead, margin.
* Relationships: linked to ingredients through the recipe ingredients list. Referenced by orders.
* Depended on by: costing, take order, orders, dashboard.

**ri, recipe ingredients (list)**
* Purpose: the link between a recipe and each ingredient it uses, with quantity. This is a proper join, and it is good design.
* Important fields: id, rid (which recipe), iid (which ingredient), qty.
* Depended on by: the cost engine.

**customers (list)**
* Purpose: saved customers.
* Important fields: id, name, phone, and basic details.
* Depended on by: take order and orders.

**orders (list)**
* Purpose: recorded orders.
* Important fields: id, items (each with a recipe id and quantity), customer, date.
* Depended on by: the dashboard revenue and best sellers.

**counters (nig, nrec, nri, nord, ncust)**
* Purpose: the next id number for each list, so new records get unique ids.

**Plain summary:** you have one storage box per vendor, and inside it, clean lists for ingredients, recipes, recipe ingredients, customers, and orders, plus settings. The link between recipes and ingredients is already done properly.

---

## 2. MAPPING: CURRENT TO REQUIRED

| Current | Becomes in the new product |
|---|---|
| Ingredients | Ingredient, plus a Price History, plus optional Supplier |
| Recipes | Recipe, plus Yield and batch size, plus separate cost lines (packaging, labour, gas, transport) |
| Recipe ingredients (ri) | Keep as is. Already correct. |
| recipe.category (text) | A proper Categories list you can add, rename, reorder, hide |
| Costing (done inside the code) | A Cost Engine that also handles batch, portion, markup, and the extra cost lines |
| recipe.margin and price | Menu Item Pricing: current price, recommended price, minimum price, margin and markup |
| Orders | Orders, plus Order Items, plus Order Profit (cost and profit per order) |
| (nothing yet) | Sales and Payments |
| Customers | Keep, extend with more fields |
| Settings | Settings, plus Costing Settings, plus Measurement Settings |
| (nothing yet) | Staff and Roles (your two doors) |
| One row per account | Business and Membership, so one person can later run more than one business or branch |

**What stays unchanged:** the recipe to ingredient link (ri), the core margin formula, customers, and the overall idea of one private store per vendor. Good news: the spine is reusable.

---

## 3. FUTURE REQUIREMENTS CHECK

| Requirement | Verdict | Note |
|---|---|---|
| Ingredient price history | EXTEND | Add a small history list to each ingredient. Easy and safe. |
| Recipe yields | EXTEND | Add yield and portions to a recipe. |
| Cost per portion | EXTEND | Batch cost divided by portions. Needs yields first. |
| Packaging costs | EXTEND | Add as its own cost line on the recipe. |
| Labour costs | EXTEND | Same. |
| Gas and fuel costs | EXTEND | Same. |
| Overheads | READY | Exists. We will make it more structured. |
| Multiple selling prices | EXTEND | One price today. Add price options where needed. |
| Recommended selling prices | EXTEND | We compute it from cost, margin, and markup. |
| Profit margins | READY | Already works, and the maths is correct. |
| Orders | EXTEND | Exists but thin. Add cost and profit. |
| Order profitability | EXTEND | Today orders show revenue only, not cost or profit. We add it. |
| Sales | NEW | Needs a new collection. |
| Customers | READY | Exists. We extend the fields. |
| Staff roles (two doors) | NEW and RISK | See the risk note below. This is the one that needs care. |
| Multiple businesses | NEW and RISK | Today one account equals one business. |
| Multiple branches | NEW and RISK | Same root as above. |
| Subscription plans | READY | Trial and subscribed already exist. We add feature tiers later. |
| Historical reports | EXTEND and RISK | The bundle can hold history, but heavy reporting over a lot of data is where a real database eventually earns its place. |

---

## 4. DATABASE DECISION

You gave three options. My recommendation is **Option B, partially restructure**. Not A, not C. Here is the honest reasoning, based on data integrity and the six phase roadmap, not convenience.

**Why not Option A (keep as is and just pile on):** if we keep stacking new features onto the current bundle without reshaping it, the data gets tangled, and the risky items (staff roles, multiple businesses, big reports) will hit walls later. That protects nobody.

**Why not Option C (full database migration now):** moving everything into many separate server side tables, with all the security rules that go with it, is a large and delicate job that genuinely benefits from a developer, and doing it now would stall the features that make you money and put your live, paying app at risk. It is the right destination, but the wrong time.

**Why Option B (partially restructure) is right:** we reshape the bundle now so its inside mirrors the proper database design, clean separate collections with clear links and stable ids, a version number so changes are controlled, and the new pieces (price history, cost lines, orders with profit, sales) added in that same clean shape. We keep using your current storage for speed and safety, but we build it the right shape. Then, when you reach growth (staff, branches, big analytics), moving to the full database is a clean lift, not a rebuild, because the shapes already match.

In one line: **restructure the shape now, migrate the engine later, throw nothing away.**

---

## 5. DATA SAFETY

Because this is a live app with real accounts, we treat data as sacred.

* **What already exists:** each vendor's ingredients, recipes, recipe links, customers, orders, and settings, plus their login and their billing flags (trial_start, subscribed). The billing flags matter most, they decide who has paid.
* **What must not be lost:** all of the above, especially the billing flags and anyone's real recipes and prices.
* **Is a migration required:** yes, but a gentle one. When we reshape the bundle, the app will read the old shape and write the new shape, keeping the old fields until the new shape is proven. No server rebuild.
* **Backup:** yes, and it is not optional. Before any change, we export a full copy of the app_state table from Supabase. That is your safety net.
* **Rollback:** two layers. First, Vercel keeps every past version of the app, so we can put the previous working version back in one click. Second, the migration is written to be non destructive and version tagged, so it never runs twice and never deletes the old data. If anything looks wrong, we roll back the app and the data is untouched.

**Rule for every phase:** back up first, deploy to test, verify, and only then move on. Never skip the backup.

---

## 6. CALCULATION ENGINE AUDIT

I read the exact formulas in your file. Here is precisely how it calculates today, and whether it is correct.

* **Ingredient cost** = cost per unit times quantity. Correct.
* **Recipe cost** = the sum of all its ingredient costs, plus overhead. Correct as far as it goes. It does not yet include packaging, labour, gas, or transport. Those are missing, not wrong.
* **Batch cost** = not modelled separately today. The recipe cost is treated as the cost of one serving, because the saved quantities represent one plate. So batch and portion are currently the same thing.
* **Portion cost** = same as recipe cost today, because of the point above. When we add yields, we must divide batch cost by portions, and be careful not to double count.
* **Selling price** = cost divided by (1 minus margin). This is the correct **profit margin** method. Example: cost 600 at 40 percent gives 1000. Profit 400. Margin 400 divided by 1000 is 40 percent. Correct. It rounds up to the nearest naira.
* **Profit** = selling price minus total cost. It is calculated, but it is not always shown to you as a clear naira figure. We will surface it plainly.
* **Margin** = the percentage you set. Shown. Correct.

**On markup versus margin, which you rightly flagged:** your app today uses **margin** only, and it does it correctly. It does not use markup at all. They are different:
* Margin method: price = cost divided by (1 minus margin). A 40 percent margin on a 600 cost gives 1000.
* Markup method: price = cost times (1 plus markup). A 40 percent markup on a 600 cost gives 840, which is only a 28.6 percent margin.

When we add markup as an option, we will keep the two clearly separate and labelled, so they are never confused. Your instinct here is correct and important.

**Small issues found (worth fixing during the rework):**
1. A margin of exactly 0 percent cannot be set today. Because of how the code reads the value, entering 0 quietly falls back to the default margin. Minor, but real. We fix it.
2. The one serving assumption: if a user enters quantities for a whole pot thinking it is one plate, the per plate cost will be wrong. Yields will fix this, and we will make it obvious on screen.
3. Rounding up to the whole naira slightly raises the true margin above the target. Harmless, but worth knowing.

**Verdict:** the core maths is sound and the margin formula is correct. There are no dangerous errors. The gaps are missing cost lines and the batch and portion split, which are additions, not repairs.

---

## 7. FINAL REPORT

**CURRENT ARCHITECTURE**
One Supabase row per vendor holding a clean bundle of settings, ingredients, recipes, recipe to ingredient links, customers, and orders, with a copy on the device. Auth, the trial paywall, Paystack, and the welcome popup are live and working.

**WHAT IS GOOD (preserve)**
The recipe to ingredient link, the correct margin formula, the private one store per vendor model, the working auth and billing, and the categories you already added. This is a real foundation.

**WHAT MUST CHANGE**
Reshape the bundle into clean, clearly linked, version tagged collections. Fix the 0 percent margin quirk. Make overhead structured. Standardise the category naming between ingredients and recipes.

**WHAT MUST BE ADDED**
Ingredient price history, recipe yields and cost per portion, packaging, labour, gas and transport cost lines, markup alongside margin, recommended and minimum prices, order cost and profit, sales, reports, the profitability matrix, smart warnings, the picture based measurement guide, and later staff roles and multi business.

**RISKS**
1. Staff roles, the two doors. Today each login gets its own separate store, so a separate staff login cannot naturally see the owner's orders. The safe answer for now is to make the two doors a locked front of house mode inside the owner's own account, protected by a PIN, rather than a separate staff account. True separate staff accounts belong in the growth phase, with the full database and proper security rules. This keeps you safe and unblocked.
2. Multiple businesses and branches, and heavy historical reports, are the real reasons the full database will eventually be needed. Option B is chosen precisely so that day is a clean lift, not a rebuild.
3. Any data change touches live, paying users, so the backup and rollback rules in section 5 are mandatory, every phase.

**RECOMMENDED ARCHITECTURE**
Option B. Restructure the shape now to mirror the proper database, keep the current storage for speed and safety, add all new pieces in that clean shape, and migrate to the full database only at the growth phase, likely with a developer.

**IMPLEMENTATION ORDER (safest)**
1. Back up the data. Confirm rollback works.
2. Reshape the bundle to the clean shape, with version tagging and a gentle, non destructive migration. Verify nothing is lost.
3. Phase 1 features: categories (add Beans and Swallow, remove Sides), ingredient entry by amount paid with price history, the measurement guide, and the clear money dashboard.
4. Then Phases 2 to 5 as agreed: full costing, pricing, sales and orders with profit, then intelligence.
5. Phase 6 growth: staff accounts, branches, feature tiers, and the move to the full database.

---

This is the checkpoint. I have not written any feature code, changed any data, or touched any screen. Once you approve this architecture, we start with the backup and the safe reshape, then Phase 1, one careful step at a time.
