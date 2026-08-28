# RECIPE COSTING EXPERIENCE — PHASE R1 SPRINT REPORT

Branch `claude/menu-master-ng-migrations-3faerm`
Verified against real PostgREST 12.2.3 → real PostgreSQL 17.6, RLS enabled,
migrations 0001–0033. Production was not touched.

> **Amended after pre-deployment verification.** Two things changed since the
> first issue of this report. (1) The owner has since confirmed that **0031 and
> 0032 are deployed to production** — this report's original verdict said they
> were not. (2) Pre-deployment verification of 0033 found a provenance defect in
> its purchase-evidence columns, described in **D** and **F**. The corrected
> logic is what this report now specifies; the superseded behaviour is recorded
> in D only as history, never as the specification.

---

## A. BUILD SUMMARY

The individual recipe page was rebuilt from a data form into a costing
workspace. It now answers, above the fold and without scrolling, the three
questions a food business owner opens the page for:

1. What does one portion cost me?
2. What am I charging for it?
3. What do I keep?

Everything below that explains those three numbers from figures the owner
entered themselves. Nothing is estimated, benchmarked or averaged.

What was built:

- **Hero row** — cost per portion, selling price, profit per portion, each with
  a sub-line saying what it is measured over ("for 500 g", "not set yet").
- **Verdict** — Loss / Low / Fair / Healthy, measured against the business's own
  `default_target_margin`, never a hard-coded benchmark. A negative margin is
  always Loss. With no target set, the verdict says so instead of inventing one.
- **Per-line costing** — each ingredient shows what it contributes to the batch,
  the resolved quantity, the unit cost, and the purchases it was derived from
  ("You bought 8000 g for ₦9,000.00 on 2026-08-28 · uses 4000 g of it", or
  "Averaged across 2 purchases: 2,000 g for ₦4,000.00" when the engine's
  weighted-average window covers more than one purchase).
- **Named blockers** — "Palm Oil has no purchase price", "tell us how much one
  paint of Garri weighs", each with an inline link to the screen that fixes it.
- **Progressive disclosure** — `?view=pro` adds batch ingredient/packaging/labour
  costs, batch cost, cost per yield unit, overhead per portion, a cost
  composition bar, and yield/portioning.
- **Mobile-first** — verified at 360 px, 390 px and tablet.

---

## B. BEFORE → AFTER

| | Before | After |
|---|---|---|
| First thing on screen | recipe name and an ingredient form | cost per portion, price, profit |
| Cost when incomplete | a partial figure or nothing, unexplained | named blocker with a link to the fix |
| Unknown money | risk of reading as ₦0.00 | `not entered` / `no cost yet` |
| Per-ingredient cost | not shown at all | shown, with the purchases it came from |
| Margin | a bare percentage | percentage + plain-language verdict vs the owner's own target |
| Batch detail | mixed in with everything else | behind "Full costing view" |
| Below-cost selling | silent | "Loss. You are selling this for less than it costs you to make. To reach your target you would need ₦950.00 a portion." |

Measured first-run timings from the browser journey: onboarded 4.2 s, first
ingredient 5.8 s, first priced ingredient 9.5 s, first recipe 10.7 s,
**first cost 12.0 s, first margin 13.0 s** — 15 user steps from empty account
to a costed, priced recipe.

---

## C. SCREENS AND ROUTES CHANGED

| Route | Change |
|---|---|
| `/recipes/[id]` | rewritten (the sprint) |
| `/recipes/[id]?view=pro` | new — full costing view |
| `web/src/components/ui.tsx` | added `HeroStat`, `CostBar`, `Disclosure` |
| `web/src/lib/format/index.ts` | added `marginVerdict()` |

No other screen was redesigned. CRM, POS, orders, pricing and reports were not
touched.

---

## D. DATABASE CHANGES

**One migration was authored: `0033_recipe_line_costs.sql` (+ rollback).**
It is **proposed only. It has NOT been deployed to production and is not
authorised for deployment.** It has been applied and verified on the local
replica only.

- Creates one read-only `security_invoker` view, `v_recipe_line_costs`.
- Creates **no** table, column, policy, function or trigger.
- Adds **no costing rule.** It composes the two functions the engine already
  uses — `fn_resolve_qty_to_base` × `fn_ingredient_usable_unit_cost` — and
  exposes the per-line intermediate that `fn__recipe_cost_core` already computes
  and then discards into a total. The alternative was to do that multiplication
  in TypeScript, which would have been a second implementation of the same
  arithmetic that would drift the first time either changed.
- Exposes **purchase evidence that reconstructs the cost it sits beside.**
  `fn_ingredient_unit_cost` (0007) computes a **weighted average** over
  `business_settings.wavg_window_days` — default **90 days** — as
  `sum(amount) / sum(qty_base)`, and falls back to the single latest price only
  when that window is empty. The view's `purchase_qty_base`, `purchase_amount`,
  `purchase_date` and `purchase_count` therefore mirror that selection exactly:
  the same window, the same `reversed_at is null` filter, the same
  `effective_date <= current_date` cut, and the same latest-price fallback.
  `purchase_count` tells the page whether to say "you bought" or "averaged
  across N purchases".
- Preflight refuses unless the database is at the 0001–0032 baseline (116
  policies) and the engine is present; self-check asserts `security_invoker=on`
  and that policy count is unchanged.
- The view is **not updatable, insertable or deletable** — it cannot be a write
  path even for `service_role`. `authenticated` is granted `SELECT` only;
  `anon` is granted nothing.

### Two defects in this migration were found and fixed before deployment

Both were found during pre-deployment verification, while 0033 was still
undeployed. Neither ever reached production.

**1. Purchase provenance did not reconcile with the engine.** The evidence
columns originally returned the **most recent purchase**, and filtered neither
`reversed_at` nor `effective_date <= current_date`. Because the engine charges a
weighted average over a 90-day window, the displayed receipt was not the basis
of the cost whenever an ingredient had been bought more than once in a quarter —
the ordinary case for a food business. Proven on the replica: two purchases of
1,000 g at ₦1,000 and 1,000 g at ₦3,000 give an engine cost of **₦2.00/g**,
while the evidence shown implied **₦3.00/g**. The recipe page would have printed
"You bought 1,000 g for ₦3,000.00" beside a line cost derived from ₦2.00/g — a
division the owner cannot reproduce, on the very number they price their menu
from. The sprint's own tests missed it because every fixture had exactly one
purchase.

*Why the corrected approach reconciles:* the evidence is now the aggregate the
function itself sums, so `purchase_amount / purchase_qty_base`, after
`purchase_yield_pct`, reproduces `unit_cost` by construction rather than by
coincidence. `tests/023` checks 22–25 pin the two together — including the
reversed-purchase case and an invariant asserting the reconstruction holds for
**every** costed line in the database — so they cannot drift apart silently
again.

**2. The baseline assertion ran after the DDL.** It originally sat beside the
`security_invoker` self-check at the end of the file. Under Supabase's SQL
editor the whole file is one transaction, so a refusal rolled back; under plain
`psql` autocommit it did not, and a refused migration still left the view
behind. The assertion now runs in the preflight, before anything is created.
Verified: on a 105-policy database the migration refuses and creates nothing,
and inside an explicit transaction the refusal aborts the transaction whole.

Migrations 0001–0016 were not modified. **0031 and 0032 are unchanged and are
already deployed to production by the owner** — they are not part of this
deployment and must not be re-run.

---

## E. COSTING AUTHORITY — WHERE EACH NUMBER COMES FROM

| Number on screen | Authority |
|---|---|
| Cost per portion, batch cost, ingredient/packaging/labour cost, cost per yield unit, overhead per portion, is_complete | `v_recipe_cost_current` → `cost_snapshots`, written by `fn_compute_recipe_cost_snapshot` / `fn__recipe_cost_core` (0007, 0008) |
| Selling price, profit, margin %, recommended price, target margin | `v_price_check` (0008) |
| Per-line cost, resolved base quantity, unit cost, per-line problem | `v_recipe_line_costs` (0033), composing `fn_resolve_qty_to_base` and `fn_ingredient_usable_unit_cost` (0007) |
| Purchase evidence (qty, amount, date, count) | `v_recipe_line_costs` (0033), selecting the same rows `fn_ingredient_unit_cost` sums over `wavg_window_days` — asserted by `tests/023` check 25 to reconstruct `unit_cost` for every costed line |
| Blocker list | `v_costing_blockers` |
| Target margin fallback | `business_settings.default_target_margin` |

**No money is calculated in the frontend.** Every currency figure and every
percentage above is read from PostgreSQL.

Three non-money derivations are done in the page and are declared here rather
than claimed away:

1. `effectiveYield = batch_yield × cooking_yield_pct / 100` — displayed as
   "After cooking loss".
2. `portions = floor(effectiveYield / portion_qty)` — displayed as "Portions per
   batch".
3. Cost-bar percentages — each component's share of the PostgreSQL-supplied
   `batch_cost`.

These are quantities and proportions, not prices, and none feeds a cost or a
margin. They are listed under I as P2.

---

## F. TEST RESULTS

**SQL suites — 242 checks, 0 failures**, against a database carrying 0001–0033:

| Suite | Result |
|---|---|
| 001 correctness and isolation | 26 / 0 |
| 002 attack and regression | 54 / 0 |
| 004 gate 1 closure | 23 / 0 |
| 005 role write matrix | 51 / 0 |
| 018 entitlement | 15 / 0 |
| 021 costing MVP journey | 22 / 0 |
| 022 entitlement final | 26 / 0 |
| **023 recipe costing experience (new)** | **25 / 0** |

`tests/023` covers the ten required cases, plus four checks (22–25) pinning
purchase evidence to the engine. Its worked example was reconciled by
hand against PostgreSQL: 50 kg for ₦85,000 → ₦1.70/g → 4.5 kg = 4,500 g →
₦7,650 a batch → ₦1.70 per g → a 500 g portion costs ₦850 → sold at ₦1,500 the
profit is ₦650 and the margin 43.33%.

**Browser journey — 46 checks, 0 failures**, driven in real Chromium against
real PostgREST → real PostgreSQL with RLS. Nothing is a fixture; every policy,
trigger, generated column and costing function is the one that ships. It covers
signup, onboarding, an ingredient, a refused purchase in an unknown unit, a
conversion, a purchase, a recipe, the first cost, the first margin, both
blockers, removal, quantity edit and recompute, a below-cost recipe, the pro
view, refresh persistence, direct URL, validation, logout/login, cross-tenant
isolation, and three viewports.

Also asserted: no NaN/undefined/null in the rendered page, no browser console
errors, no failed network requests.

### Correctness defects found and fixed while verifying

1. **"2 of 3 items are ready."** The incomplete-cost headline cited a required
   input the owner cannot see: for a dish, `fn_compute_recipe_cost_snapshot`
   counts **portion size** as a required input (0007:373–383), so two visible
   ingredients read as "2 of 3" with no findable third item. The headline now
   counts the blocker list rendered directly beneath it, so every number on
   screen is accounted for by something on screen.
2. **A recipe-level figure leaking into an incomplete state.** Confirmed not to
   occur: while incomplete, no cost per portion, profit or margin is shown. The
   per-line cost of an ingredient the owner *did* price is still shown
   (₦2,250.00 for the rice line) — that is true, derived from their own
   purchase, and hiding it would hide what they already know. The test now
   distinguishes the two rather than forbidding both.
3. **Purchase evidence that contradicted the cost beside it** — the provenance
   defect described in full under D. Engine ₦2.00/g, evidence implying ₦3.00/g.
   This is the most serious thing found in the sprint: it would not have
   corrupted any data, but it would have shown a customer a derivation of their
   own cost that does not come out, which is the fastest way to lose their trust
   in every other number on the page.
4. **The 0033 preflight ordering defect** described under D.

The first two were found by reading the rendered page; the third was found only
by reading `fn_ingredient_unit_cost` line by line during pre-deployment
verification. It is worth recording why the test suite did not catch it: every
fixture in `tests/023` and in the browser journey recorded exactly **one**
purchase per ingredient, and with one purchase the weighted average and the
latest price are the same number. The tests agreed with the code because both
were built from the same unexamined assumption. `tests/023` now includes a
two-purchase fixture for exactly this reason.

### Harness defects found and fixed

These made the board green or red for the wrong reasons and are worth recording:

- Assertions compared literal text against `innerText`, which returns text
  **after** CSS `text-transform`. A heading styled `uppercase` read back as
  "COST PER PORTION" and four checks failed on copy that was present. Case is
  now folded; amounts and percentages are still compared exactly.
- The journey slept a fixed 400 ms after signup and then navigated to a
  protected route. The auth cookie is written by a server action; the sleep
  raced it. It now polls the protected route until it actually renders.
- `mustNot` reported "unexpectedly present" with no location. It now reports the
  surrounding line, which is what identified finding 2 above as a per-line cost
  rather than a recipe total.

---

## G. MOBILE RESULTS

| Viewport | Cost + margin above the fold | Horizontal overflow | Fixed nav occlusion |
|---|---|---|---|
| 360 × 780 | pass | 0 px | none |
| 390 × 844 | pass | 0 px | none |
| 820 × 1180 (tablet) | pass | 0 px | none |

The `rc-mobile-costed.png` capture *appears* to show the bottom nav cutting
through an ingredient card. That is an artifact of `fullPage` screenshots, which
render a `position: fixed` element at its viewport offset mid-page. Rather than
assert this away from the CSS class, the journey now scrolls to the true bottom
of the page and measures whether any button, input, link or select intersects
the nav's bounding box. At all three widths: none does.

---

## H. SCREENSHOTS

In `web/e2e/shots/`, all captured in the verified run:

| File | Shows |
|---|---|
| `rc-desktop-costed.png` | fully costed recipe, ₦281.25 per portion above the fold, unset values reading `not entered` |
| `rc-mobile-costed.png` | the same value moment at 390 px |
| `rc-desktop-missing-price.png` | missing-price blocker naming Palm Oil, `no cost yet`, no margin shown |
| `rc-desktop-missing-conversion.png` | **recipe-level** missing-conversion blocker: "tell us how much one paint of Garri weighs" |
| `rc-desktop-below-cost.png` | −₦62.50 profit, −12.50%, Loss, and the price needed to reach target |
| `rc-desktop-pro.png` | full costing view: batch breakdown, cost bar, yield, purchase evidence |

Note: the pro-view captures predate the provenance fix, so their evidence line
reads "You bought 8000 g for ₦9,000.00". That wording is still correct for the
single-purchase case they show; a multi-purchase line now reads "Averaged across
N purchases".
| `rc-mobile-pro.png` | full costing view at 390 px |
| `rc-ingredient-unknown-unit.png` | ingredient-page refusal of a purchase in an unconvertible unit |

The file previously named `rc-desktop-missing-conversion.png` showed the
*ingredient* page refusing an unknown purchase unit — a real blocker, but not
the recipe-level one the sprint asked for. It has been renamed to what it
actually shows, and the recipe-level case is now genuinely captured.

---

## I. REMAINING LIMITATIONS

### P0 — none.

Nothing found in this sprint blocks a costing customer from getting a correct,
explained cost per portion and margin.

### P1

1. **`0033` is not deployed.** The recipe page depends on `v_recipe_line_costs`
   for per-line costs and purchase evidence. Until 0033 is deployed, the
   redesigned page cannot ship. It is authored, rehearsed, corrected and
   verified, and a deployment pack exists. 0031 and 0032 are already live in
   production, so the 116-policy baseline 0033 requires is satisfied.
2. **No primary/secondary ingredient classification exists.** The schema has no
   column for it. Rather than invent one, lines are grouped by `item_kind`
   (ingredient vs packaging) and ordered by cost contribution, so the biggest
   driver is first. No data was fabricated to create this grouping.
3. **Purchase evidence duplicates the engine's row selection, not its
   arithmetic.** To show a customer the purchases behind their cost, the view
   must select the same rows `fn_ingredient_unit_cost` sums — the same 90-day
   window, `reversed_at` filter and as-of cut. The division itself is still the
   engine's; the view never computes a unit cost. If that window logic ever
   changes in 0007, the view must change with it. `tests/023` check 25 is the
   guard: it fails the moment the evidence stops reconstructing `unit_cost` for
   any costed line.
4. **Same-transaction snapshot ties.** `now()` is transaction-start, so two
   snapshots written in one transaction tie on `computed_at` and
   `v_recipe_cost_current`'s "latest" is ambiguous. The same shape affects
   `v_price_check`'s price selection (`effective_from` and `created_at` both
   tie). The page is safe because it recomputes exactly once per action, but the
   underlying ambiguity is unresolved and is a latent trap for any future code
   that recomputes twice in one transaction.

### P2

5. Portions-per-batch and after-cooking-loss quantities, and the cost-bar
   percentages, are derived in the page (section E). They are quantities and
   proportions, not money, and none feeds a cost or margin.
6. Packaging and labour show `₦0.00` with the sub-label "none recorded" when the
   owner has recorded none. This is existing engine behaviour (0007 treats
   absent lines as zero contribution and still marks the recipe complete), not
   something introduced here. The label discloses it, but a recipe with real
   unrecorded packaging will under-state its cost.
7. Gas, electricity and water are not tracked. `overhead_items` carries only a
   name and a monthly cost, and `overhead_enabled` defaults to false. The page
   says so explicitly rather than implying the cost is complete.
8. The ingredient dropdown defaults to the first of roughly 180 starter items.
9. No recipe image, prep notes or allergen fields exist in the schema; the
   header shows category, yield and portions, which is what is real.
10. Print view was not built. It was listed as preparation only.

---

## J. VERDICT — GO / CONDITIONAL GO / NO-GO

### CONDITIONAL GO for 7 September.

The Recipe Costing Experience itself is ready. An owner can go from an empty
account to a costed, priced recipe with a plain-language verdict in 15 steps and
about 13 seconds, on a phone, and every number on the screen can be traced to
something they entered. The two failure states a Nigerian food business will hit
constantly — an ingredient with no price, and a recipe measured in paints or
derica — refuse honestly, name the item, and link to the fix. Cross-tenant
isolation holds under a real browser against real RLS.

**The single condition is deployment of `0033`.** The page reads
`v_recipe_line_costs` for per-line costs and purchase evidence. Without it the
per-line detail is empty, which removes exactly the explanation that makes the
cost trustworthy. 0033 is read-only, creates no table, column, policy or
function, adds no costing rule, and refuses to apply unless the database is at
the 0001–0032 baseline.

I am not treating your 0031/0032 authorisation as covering 0033. It is a
different migration, written after that authorisation, and it needs its own
decision.

Three things I want on the record before you decide:

- **0031 and 0032 are deployed to production**, confirmed by the owner's own
  verification output: 69 gated write policies, 0 gated reads, 116 total
  policies, 7-day payment-failure grace, boundary constraint present,
  `fn_my_entitlement_status` present, cost tables split into 12 per-verb
  policies. That satisfies the 116-policy baseline 0033 requires. This session
  has no production connection and has verified none of it directly; it is
  owner-supplied evidence, treated as authoritative.
- **0033 has not been deployed anywhere but the local replica.** The provenance
  defect under D was caught before deployment, so no customer ever saw a cost
  whose evidence contradicted it.
- Production has **zero subscription rows** (your D-3 result). Nobody currently
  loses access on any of this, and nobody currently gains it either.

The verdict is unchanged by the amendment: **CONDITIONAL GO**, condition being
the deployment of the corrected 0033.
