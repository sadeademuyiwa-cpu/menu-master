# Screen-by-screen specification

One entry per screen in `screens/` (HTML) and `renders/` (PNG). Each
entry says who it is for, what it must achieve, the one primary action,
every state, and what differs from the build that is live on 12 Oct 2026
(`web/src/app`). "Keep" means the live screen already does it.

Legend for states: **E** empty · **L** loading · **OK** normal · **W** warning · **X** error · **🔒** locked by plan · **R** role-limited.

---

## 00 · Landing (`/`)  — 390 + 1280
**For:** a food business owner arriving from an ad or a WhatsApp link, on a phone, on data.
**Must:** say what it does in one line, show a real-looking result, and get them to Sign up.
**Primary:** Start your free trial (sticky on phones).
**Layout:** header (lockup, Pricing, Log in, Start free) → hero with phone mock → "Sound familiar?" three pains → how it works (3 steps, forest numerals with gold digits) → six features (two tagged Costing + Sales) → two plans with founding badge → footer.
**States:** OK only. Prices come from the plans table; if none, the pricing section hides.
**Change from live:** brand lockup replaces the "MM" tile; Plus Jakarta Sans headlines; gold replaces generic accent on the founding badge and step numerals; phone mock shows the dish trio in the app's own component.

## 01 · Sign up (`/signup`)
**For:** first visit. **Primary:** Create my account. Google first (one tap on Android).
**States:** OK · X (email taken → "Log in instead?" link; weak password inline) · L (busy button).
**Change:** headline "Start your 14 days free", trust line under it; legal line in 12.5 px.

## 02 · Log in (`/login`)
**Primary:** Log in. **States:** OK · X (shown in mock: wrong password notice at the top, red field) · "check your email" after reset.
**Change:** subtitle names the businesses this login opens ("Ada Kitchen and 1 other").

## 03 · Onboarding (`/onboarding`)
**For:** a new owner, once. **Must:** take under a minute. **Primary:** Continue.
**Fields:** business name (required), kind (four tiles, changes examples only), place (time zone), WhatsApp (optional, goes on receipts).
**States:** OK · X (name empty) · R (an invitee never sees this; they land in the business).
**Change:** kind as tiles not a dropdown; the hint "This only changes the examples we show you. It never changes a cost."

## 04 · Guided setup: your first dish (`/start`)
**For:** owner or manager until one dish is costed and priced. **Primary:** See my cost.
**Layout:** dish name, pot makes N plates, selling price (optional), purchase lines as bought (item · how much · unit · paid), add line, info notice about unknown units, Back / See my cost.
**States:** OK · W (unknown unit badge) · X (a line with no amount) · after submit: cost per plate hero + suggested price (only if complete) + "Set this price" / "Go to Home".
**Change:** the unit field accepts free text and shows a badge instead of refusing; the price field is optional at this step.

## 05 · Home (`/dashboard`) — 390 + 1280
**For:** every signed-in person, every day. **Must:** answer "how is my business doing and what needs me?" in one scroll.
**Primary:** none on the page itself; quick actions and the "+" FAB. Desktop header carries New sale.
**Sections, in order:** This week (sold, kept, vs last week; Costing + Sales only) → Needs your attention (ranked rows with diagnosis badges) → Quick actions (4 tiles) → Ready to sell (top rows).
**States:** OK · E (see 06) · 🔒 (This week hidden on Costing) · R (Sales role: no costs, so "Kept" and attention rows hide; sees today's sales instead).
**Change:** "Kept" stat in green; attention rows carry the fix in the meta line; date in the subtitle.

## 06 · Home, first day
**For:** a new business with fewer than four core steps done. **Primary:** the next undone step.
**Layout:** progress + 4 steps (done/next/later) → "Make it more accurate" tiles → empty "your week" → gold trial notice.
**Change:** replaces the live "Quick actions"-first layout for new accounts; trial days in gold.

## 07 · Recipes (`/recipes`)
**For:** everyone except Sales role. **Primary:** New dish (sticky). **Layout:** search, tabs with counts (All / Needs attention / Ready), rows with one badge and the plate price.
**States:** OK · E ("No dishes yet. Cost the dish you cook most." → New dish) · R.
**Change:** tabs with counts; meta line carries cost · keep · margin in one phrase.

## 08 · Dish (`/recipes/[id]`) — 390 + 1280
**For:** owner, manager, kitchen. The most important screen in the app.
**Must:** show cost → price → keep in the same three positions every time; let the owner try a price; show what goes in with the proof (bought X for ₦Y on date).
**Primary:** Save ₦N as the price (inside Try a price). Secondary: Add ingredient, Sizes, Edit.
**States:** OK · W (below target: amber hero + notice naming the price that reaches the target) · X (see 10) · "no price set" (hero shows "set a price" instead of keep).
**Desktop:** two columns, hero + try on the left, lines + sizes on the right.
**Change:** hero trio with eyebrow labels and captions; "Try a price" is a card with live "you keep"; line meta shows the purchase that set the price; the pot total row sits in the list in surface-2.

## 09 · New dish (`/recipes/new`)
**Primary:** Save and add ingredients. **Fields:** name, batch makes (amount + unit), sold by (segmented), one portion is, time it takes (optional), "used inside other dishes" check.
**States:** OK · X (name or batch missing). **Change:** segmented "sold by"; the evaporation hint.

## 10 · Dish, cost incomplete
**For:** the state the governing rule produces. **Must:** show no number, name each gap, offer a one-tap fix for each.
**Layout:** hero "Not known yet" → "What's missing" rows (icon, diagnosis, Record / Tell us buttons) → lines with "—" for unknowns → hint with the known subtotal and why the total is hidden.
**Change:** the missing items are their own list at the top; the known subtotal is stated in words, never as a total.

## 11 · Purchases (`/purchases`)
**Primary:** New purchase (sticky). **Layout:** two stats (month total, prices going stale), tabs (Recent / By item / By supplier), rows grouped by day with what changed ("Changed jollof from ₦1,790 to ₦1,840").
**States:** OK · E · R (Sales role never sees this page).
**Change:** grouped by day; the effect of a purchase on a dish in the meta line.

## 12 · New purchase (`/purchases/new`) — 390 + 1280
**Primary:** Save purchase. **Layout:** when / where → lines (item, how much, unit, paid, conversion badge) → receipt photo (optional) → summary (desktop right column) → info notice stating the consequence.
**States:** OK · W (new unit) · X (no lines) · L.
**Change:** conversion badge per line; consequence notice; receipt photo.

## 13 · Ingredients (`/ingredients`)
**Primary:** Add an ingredient. **Layout:** search, tabs (All / No price / Stale), rows with price state badge, price per base unit, where it came from, how many dishes use it.
**States:** OK · E. **Change:** tabs with counts; the purchase that set the price in the meta.

## 14 · Ingredient (`/ingredients/[id]`)
**Primary:** Record a purchase. **Layout:** current price hero with its method (average of last N in M days) → usable % and usage stats → buy-vs-use conversions (owner-entered, never guessed) → price history → trend notice.
**Change:** the method sentence under the price; conversions as a list the owner can add to.

## 15 · Sales (`/sales`) — Costing + Sales
**Primary:** New sale; secondary "Enter the day's total instead" (daily-totals mode).
**Layout:** today stats + pace bar, segmented period, rows with payment badge and "kept".
**States:** OK · E · 🔒 (see 29) · R (Sales role sees no "kept").
**Change:** pace bar against a typical day; cancelled rows struck through with "Reissued as".

## 16 · New sale (`/sales/new`) — 390 + 1280
**Primary:** Confirm sale · ₦total; secondary Confirm and send receipt.
**Layout:** search, menu tiles with steppers on selected, summary card (lines, discount, total with "you keep about"), customer (optional), paid by (segmented).
**States:** OK · X (nothing selected: button disabled with "Add a dish") · dishes with no price are shown but not addable.
**Change:** tiles with steppers; "you keep about" under the total; combined confirm-and-send.

## 17 · Sale (`/sales/[id]`)
**Primary:** Send on WhatsApp. **Layout:** header with paid badge, lines, total, cost at time of sale (frozen), kept; receipt preview; WhatsApp / Copy; "Made a mistake?" card with Cancel and reissue (danger).
**States:** OK · cancelled (banner, no actions) · unpaid (Record payment button first).
**Change:** receipt preview matches the WhatsApp text exactly; the frozen-cost sentence.

## 18 · Customers (`/customers`) — Costing + Sales
**Primary:** Add a customer. **Layout:** search, stats (count, owing), rows with initials tile, top-5 gold badge, owes badge, year total.
**States:** OK · E · 🔒.

## 19 · Customer (`/customers/[id]`)
**Primary:** WhatsApp / Call pair. **Layout:** owes notice with Record payment, four stats (spent, kept, usual order, comes), orders, notes.

## 20 · Price per head (`/quote`)
**Primary:** depends on state: when complete "Share quote on WhatsApp"; when a dish is incomplete, "Cost it" / "Remove it".
**Layout:** guests + target, find a dish, per-guest amounts, summary (cost per head, extras, charge per head, total for N), notice.
**States:** OK · W/X (incomplete dish → no price; shown in mock).
**Change:** refuses to quote with a hole; says so in one sentence.

## 21 · Sizes (`/formats`)
**Primary:** Add a size. **Layout:** info notice (a size never changes a recipe), rows with packaging and which dishes use it, retired rows dimmed.
**States:** OK · E · W (packaging with no price).

## 22 · Prices (`/pricing`)
**Primary:** none (links to each dish). **Layout:** segmented filter, table: size, cost, price, keep badge; notice with suggested prices and the rounding rule.
**States:** OK · unknown cost / no price cells as words.
**Change:** a table (the only place on phones), because owners compare down a column here.

## 23 · Reports (`/reports`) — 390 + 1280, Costing + Sales
**Primary:** Export CSV (link). **Layout:** period segmented, four stats incl. coverage ("94% of sales had a known cost"), sold-vs-kept bars for the week, by dish, by day, cancelled.
**States:** OK · E · 🔒.
**Change:** coverage stated as a caption; kept as the sort order by dish.

## 24 · Wages & running costs (`/settings`)
**Primary:** Save per card. **Layout:** business, paid work (hourly rates), monthly bills (make per month, measured in, bills with per-plate share, total per plate), target (margin, rounding, purchase window).
**States:** OK · W (bills entered but "make per month" blank → "dishes are incomplete until you fill this").
**Change:** per-plate share shown beside each bill; the "never as if the work were free" hint kept verbatim from live.

## 25 · People (`/settings/people`)
**Primary:** Send invitation. **Layout:** members with role badges and what the role can see, invited rows with Resend, invite form with role segmented and a one-line explanation of the chosen role.
**States:** OK · R (only owner/manager) · X (invalid email, already a member).

## 26 · Choose your plan (`/subscribe`)
**Primary:** Choose Costing + Sales (highlighted card). **Layout:** gold trial notice, two plan cards (founding badge, struck standard price), Paystack lock line, FAQ rows.
**States:** trial · lapsed ("Your trial ended on…; nothing was deleted") · active ("You're on … renews …; Change plan / Cancel").

## 27 · Account (`/account`)
**Layout:** identity, businesses (switch, add), plan row, password, appearance, help on WhatsApp, Log out, legal links.

## 28 · More (`/more`)
**Layout:** three groups of tiles (Selling, Buying, Your business) + WhatsApp help button; Administration group for the platform owner.
**Change:** grouped tiles with hints; help button at the end.

## 29 · Sales, locked (Costing plan)
**Primary:** See Costing + Sales · ₦price. **Layout:** gold lock panel, then "What you would get" rows.
**Rule:** the nav item stays; the page explains; nothing is a dead end.

## 30 · Administration (`/admin`) — 1280 only
**For:** the platform owner. **Layout:** four stats (signups, paying, founder slots, alerts), five tiles, latest signups with the furthest step reached, "Needs you" rows (webhook retries, failed renewals).
**States:** OK · R (anyone else gets 404).

## 31 · Feedback states
Reference sheet for D1/D2 in `docs/PLAN_LAUNCH_PLUS_IMPLEMENTATION.md`: busy button, three toast kinds, skeleton, confirm sheet, empty state, missing-number words, offline notice.

---

## Acceptance checks for any new screen

1. One primary button, green, reachable with a thumb.
2. Empty, loading, error and locked states exist.
3. No ₦0 where the database has NULL.
4. Every badge has words; every number has a caption.
5. Renders at 360 px with no horizontal scroll (the e2e route walk already asserts this).
6. Back link to the parent destination; the right nav item is lit.
7. Copy is sentence case, second person, no exclamation marks.
