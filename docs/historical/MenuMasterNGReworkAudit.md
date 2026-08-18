# Menu Master NG: Rework Audit and Build Plan

This is the audit you asked for. I inspected your current live file and compared it to your master specification. No code was changed. This document is what we build from.

Quick summary in one line: you have a solid, working foundation with the core cost, price and margin engine already in it, and your specification turns it into a full food business profitability system. That is a real step up, and it is doable, but it is a phased build, not one night of work. Below is exactly what we have, what changes, what is missing, the data architecture I recommend, and the order to build it.

---

## A. WHAT WE HAVE

Your current app is a single web page (about 824 lines) living at menumasterng.com, with all data saved to one record per vendor in Supabase.

**Working today:**

1. Accounts and login: sign up, email confirmation, staying logged in. Working and live.
2. Paywall: 14 day free trial, then the subscribe screen with your three Paystack plans (Founding ₦3,500, Monthly ₦5,000, Yearly ₦50,000). Working and live.
3. First login welcome: the popup with your privacy promise and the two guide links. Working and live.
4. Ingredients: each has a name, a category, a unit, a cost per unit, and a last updated date.
5. Recipes: each has a name, a category, an overhead, and a margin. Recipes are linked to ingredients with quantities.
6. Costing engine: it adds up ingredient costs plus overhead, then works out a selling price from your margin, and shows a margin health signal. This is the heart of your product and it already works.
7. Categories: you added these yourself. Current list: Rice dishes, Soups, Proteins, Stews, Sides, Drinks, Specials.
8. Customers, Take order, Orders, and a basic Dashboard (total revenue, orders, average margin).
9. Settings: business name, tagline, currency, phone, default overhead, default margin.
10. Saving: everything saves to your own private account and loads on any device.

**The foundation is genuinely good.** The ingredient to recipe to cost to price to margin chain already exists. We are building on solid ground, not starting from zero.

---

## B. WHAT NEEDS TO CHANGE

These are the parts that exist but do not yet match your specification.

1. **Categories.** Remove "Sides". Add "Beans" and "Swallow". Move to your fuller Nigerian list (see the plan). You can already add and edit categories, so this is a light change.

2. **Ingredient costing method.** Right now you type the cost per unit directly. Your spec wants you to enter what you actually paid (for example, 10 kg of tomatoes for ₦25,000) and have the app work out the cost per kg for you. This is more natural and more accurate. It is a change to how ingredients are entered.

3. **Recipe costs.** Right now a recipe is ingredient cost plus one flat overhead. Your spec wants packaging, labour, gas, and transport as their own separate lines, plus batch size and cost per portion. This is the biggest costing upgrade.

4. **Pricing.** Right now it only uses margin. Your spec also wants markup, cost plus, and a "type in my current price and tell me if it is healthy" check. We extend the pricing engine.

5. **Dashboard.** The current one is basic. Your spec wants a proper money dashboard: today's sales, cost, profit and margin, best and worst dishes, weekly and monthly figures, and warnings. This is a full redesign.

6. **Settings.** Extend to include logo, business type, location, costing defaults, measurement setup, and staff roles.

7. **Category codes.** Small technical tidy: ingredients use one set of category names and recipes use another. We standardise them.

---

## C. WHAT IS MISSING

These are in your specification but not in the app yet. This is the bulk of the rework.

1. **Ingredient price history:** keep old prices, show the change, and show "this ingredient is used in X recipes" so you see what a price rise affects.
2. **Batch and portion costing:** cost a pot, a tray, 50 plates, then get the cost per single plate.
3. **Full menu item profitability profile:** cost breakdown, current price, recommended price, minimum price, profit per plate, margin, and a clear green, orange, or red status.
4. **Price Check:** a dedicated screen. Enter a dish, its cost, and your price, and it gives a verdict and a recommended price range.
5. **Cost Calculator:** a standalone "what will this order cost me" tool.
6. **Catering order costing:** cost a full event (for example, 100 guests across several dishes) end to end.
7. **Orders with profit:** every order shows revenue, cost, profit, and payment and delivery status.
8. **Quick sales recording:** record a sale fast, feeding the dashboard.
9. **Reports:** sales, profit, menu profitability, best and worst sellers, low margin, loss making, ingredient cost, and price change impact.
10. **Profitability matrix:** the Star, Workhorse, Opportunity, Problem view.
11. **Smart warnings:** loss alerts, low margin alerts, price change alerts, and "not costed in 30 days" reminders. The "Where am I losing money?" section.
12. **Measurement guide for everyone:** enter quantities in local units chosen by picture (derica, mudu, congo, paint rubber, cup, spoons, and so on), with a one time setup that keeps costing accurate. This is your low literacy pain point, and it is missing.
13. **Staff roles (your two doors):** owner, manager, and staff, where customer care can take orders but never see recipes, costs, or profit.
14. **Onboarding wizard:** a guided first run that walks a new user from business details to their first profit number, so they feel the value in minutes.
15. **Multi business and branches:** the architecture is currently one account equals one business. Your spec wants room for more later.

---

## D. RECOMMENDED DATA ARCHITECTURE

This is the most important decision, so I am giving you the honest version.

**How your data is stored today:** everything for one vendor sits in a single bundle in one place. It is simple and it works, but a single bundle gets heavy and hard to report on as features grow.

**What your specification describes** is a proper database with many connected tables (ingredients, price history, suppliers, recipes, recipe ingredients, categories, menu items, prices, packaging, labour, overheads, orders, order items, customers, sales, payments, settings, businesses, and staff roles). That is the correct long term shape for a real software product you sell to thousands of people.

**The honest trade off:** moving from the single bundle to the full multi table database is a large job that really benefits from a developer, and it changes the whole engine of the app. Doing it now would slow down the features that actually make you money and risk the app that is live and taking payments.

**My recommendation: build in the smart middle.** We keep your current storage but reshape it to mirror the proper database design, adding the new pieces (price history, packaging, labour, orders with profit, sales, staff role) in the same clean structure. This gives you almost all of the power and the full new experience quickly and safely, and it means that when the time comes to move to the full multi table database, the shapes already match, so the move is clean rather than a rebuild.

In plain words: build it the right shape now, even inside the simpler storage, so nothing has to be thrown away later.

**The target shape we design toward (for when you grow):**

* Business, and staff members with roles (owner, manager, staff)
* Ingredients, with a price history and optional supplier
* Recipes, and the ingredients inside each recipe
* Categories
* Menu items, with cost breakdown, price, and profit
* Packaging, labour, and overhead as their own cost pieces
* Orders and the items inside each order
* Customers
* Sales and payments
* Settings

Every part tied to the business, so one vendor never sees another's data. This is already how your privacy works, and we keep it.

---

## E. IMPLEMENTATION PLAN (the order I recommend)

Your app is live and taking payments. We do not break it. We build each phase, test it, then move on. This order follows your specification but sequences it for the fastest visible value with the least risk.

**Phase 1: Foundation and the parts you can see (start here)**
1. Reorganise categories: add Beans and Swallow, remove Sides, set the full Nigerian list.
2. Upgrade ingredient entry: enter what you paid and the quantity, app calculates cost per unit, and keep old prices as history.
3. Add the measurement guide: local units by picture, with a one time setup so costing stays right.
4. Redesign the dashboard into the clear money view: today's sales, cost, profit, margin, and simple warnings.

**Phase 2: The full costing engine**
5. Add packaging, labour, gas, and transport as separate recipe costs.
6. Add batch size and cost per portion.
7. Build the standalone Cost Calculator.

**Phase 3: Pricing power**
8. Add markup and cost plus alongside margin.
9. Add recommended price and minimum profitable price.
10. Build the Price Check screen with its verdict and status colours.

**Phase 4: Sales and orders that show profit**
11. Upgrade orders to show revenue, cost, profit, and status.
12. Add quick sales recording.
13. Add catering order costing.

**Phase 5: Intelligence**
14. Reports (sales, profit, menu profitability, best and worst, low margin, loss making).
15. The profitability matrix (Star, Workhorse, Opportunity, Problem).
16. The full warnings system and "Where am I losing money?".

**Phase 6: Growth (this is where a developer likely joins)**
17. Staff roles and the two doors (owner back office, customer care front).
18. Multiple branches, subscription tiers by feature, and advanced analytics.
19. Move to the full multi table database if and when scale needs it.

---

## One honest note from me

Your specification is excellent, and it is ambitious. It describes a professional software product that a team would normally build over months. That is not a criticism, it is a compliment to your vision. The way we win is to build it in the phases above, so that after each phase you have something better and sellable, not a half finished giant. Phases 1 to 5 can be built into your current app step by step. Phase 6, the staff logins, branches, and the full database, is where bringing in a developer will be worth it, and by then you will have paying customers to justify it.

My strong recommendation: we start with Phase 1. It gives you the biggest visible jump, the new categories, the natural ingredient costing, the measurement guide, and the clear money dashboard, with the least risk to your live app.

When you wake, just tell me "start Phase 1," and we build it one careful step at a time, then deploy and test before moving on.
