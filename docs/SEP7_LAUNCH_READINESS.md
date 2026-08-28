# SEPTEMBER 7 — LAUNCH READINESS REPORT

**28 Aug 2026. Production untouched: no migration applied to it, no billing
activated, no Paystack plan created, no customer communication sent, no
production account modified.**

---

## The environment this was proved against

The gap in the previous report was PostgREST — the one link between the browser
and the database that no test exercised. It is now exercised for real.

| Layer | What ran |
|---|---|
| Database | **PostgreSQL 17.6**, production's version, migrations `0001`–`0032`, **RLS enabled** |
| API | **PostgREST 12.2.3** — the real thing, with a `db-pre-request` hook publishing `request.jwt.claim.sub` exactly as the hosted platform does |
| Tokens | **real HS256 JWTs**, signed with the secret PostgREST verifies, carrying `sub` and `role=authenticated` |
| Auth issuer | a local GoTrue stand-in that writes real `auth.users` rows. **The only simulated component**, and not the one under test |
| App | `next build` production output, served by `next start` |
| Browser | Chromium via Playwright, 1280×900 and 390×844 |

**Nothing about the data plane is a fixture.** Every policy, trigger, generated
column, view and costing function is the one that ships.

---

## Results

| Area | Verdict |
|---|---|
| **REAL BROWSER JOURNEY** | **PASS** — 33/33 |
| **COSTING ENGINE INTEGRATION** | **PASS** |
| **PERSISTENCE** | **PASS** |
| **MOBILE** | **PASS** |
| **AUTHENTICATION** | **PASS** |
| **ENTITLEMENT / TRIAL** | **PASS** |
| **RLS / TENANT ISOLATION** | **PASS** |
| **CUSTOMER UX** | **PASS** |
| **LAUNCH COPY** | **PASS** |
| **AUTOMATED TEST SUITE** | **PASS** — 217/217 |

### Automated suites

```
001_correctness_and_isolation   26/26      018_entitlement            15/15
002_gate1_attack_and_regression 54/54      021_costing_mvp_journey    22/22
004_gate1_closure               23/23      022_entitlement_final      26/26
005_role_write_matrix           51/51
                                                 TOTAL  217 pass, 0 fail
```

`tsc --noEmit` clean. `next build` exit 0, 15 routes.

### The browser journey, step by step

Every line below asserts the value a customer reads, not a status code.

```
signup completes and lands inside the app                            PASS
onboarding reaches the dashboard                                     PASS
the new ingredient appears in the list                               PASS
the ingredient page opens                                            PASS
a purchase in an unknown local unit is REFUSED, in plain words       PASS
no cost is invented for the refused purchase                         PASS
the local measurement is saved                                       PASS
the purchase records and Postgres derives the unit cost (₦1.13/g)    PASS
the recipe is created and opens                                      PASS
THE FIRST VALUE MOMENT: ₦2,250.00 a batch, ₦281.25 a portion         PASS
margin and profit appear from v_price_check (43.75%, ₦218.75)        PASS
an unpriced ingredient blocks the cost AND names the item            PASS
no cost or margin is shown while incomplete                          PASS
removing the unpriced line restores the cost                         PASS
editing the quantity recomputes (₦4,500.00, ₦562.50)                 PASS
the stale cost is gone                                               PASS
the margin follows the cost and turns negative (-12.50%)             PASS
the stale margin is gone                                             PASS
the recomputed cost survives a refresh                               PASS
the recipe opens from a direct URL                                   PASS
a zero quantity is refused with a readable message                   PASS
the account page reports the live trial FROM THE DATABASE            PASS
a logged-out visitor is sent to the login page                       PASS
after logging back in the same authoritative figures return          PASS
account B cannot read account A's recipe                             PASS
account B cannot read account A's ingredient or its prices           PASS
account B's recipe list contains none of account A's work            PASS
mobile shows the cost, the portion cost and the margin               PASS
no horizontal overflow at 390px                                      PASS
mobile ingredient list renders                                       PASS
no NaN, undefined or null leaked into the page                       PASS
no browser console errors                                            PASS
no failed network requests                                           PASS
```

Screenshots: `web/e2e/shots/real-*.png`.

---

## Launch simulation — a fresh account, knowing nothing

Every run of `e2e/journey.mjs` creates a brand-new customer. Steps are UI
interactions; times are from the first page load.

| Milestone | Steps | Time |
|---|---|---|
| signup | 2 | — |
| onboarded | 4 | 3.4 s |
| first ingredient | 6 | 4.1 s |
| **first priced ingredient** (incl. the refused attempt and the conversion) | 10 | 7.6 s |
| first recipe | 12 | 8.1 s |
| **first valid recipe cost** | **13** | **9.4 s** |
| first margin | 14 | 10.4 s |
| persistence · mobile · entitlement · isolation | all verified | — |

**Can an ordinary food-business owner sign up and discover the true cost of a
recipe without developer assistance? Yes — in thirteen steps.** Machine timings
are not human timings, but the step count is real, and one of those thirteen is
the system refusing to guess a paint of rice and being told the answer.

---

## Workstream outcomes

**1 — Real browser journey.** Above. All eight required scenarios covered.

**2 — Entitlement coherence.** `0032` authored, applied to the disposable
database, proven by suite `022` (26/26): the full D-26 truth table, the strict
boundary (equality is **not** entitled), the owner's final Case 11 ruling, and
grace read from `billing_config` rather than a literal. The UI now calls
**`fn_my_entitlement_status()`**, which derives from `fn_account_is_entitled`,
so the client cannot drift from the rule the policies enforce.

**V-7 is closed.** `ingredient_prices`, `cost_snapshots` and `recipe_prices`
carried `0004` blanket `for all` policies that `0028`'s name-pattern selection
could never match. `0032` splits each into named per-verb policies — the SELECT
predicate copied character for character. Suite `022` proves an expired trial
**cannot** write an ingredient, an ingredient price or a recipe price, and
**can still read** every price and snapshot it entered. **No RLS was weakened:
the gate reached three tables it had never covered, and the count of gated write
policies went from 60 to 69 while gated read policies stayed at 0.**

**3 — `0031` / `0032` / D-3.** Both authored, applied and tested on the
disposable database. **Neither is applied to production.** One thing changed
for the better: `0032`'s own preflight counts NULL boundaries and **raises
rather than repairing**, so it cannot damage anomalous data. The owner-run D-3
query is now a courtesy that tells you the answer in advance, not the safety
mechanism. See "What still needs you".

**4 — Customer UX.** Three defects the browser found and fixtures could not, all
fixed: a duplicate ingredient name **failed in silence**; a recipe sold below
cost showed a bare negative margin with no explanation; the dashboard said
"Blocking conversions". Blockers now read *"tell us how much one paint weighs"*
and *"no purchase price recorded"* against the named item, with the fix one
click away. No customer-facing string mentions snapshots, RPCs, RLS or units of
the database.

**5 — Launch copy.** Audited. No trial-duration claim, no price, no feature
promise anywhere in the signup or landing copy. `/account` states plainly that
**paid plans are not open and no payment details are held**. The recipe page
says the figure covers **ingredients only**. **No numerical trial limit is
claimed anywhere**, because `0040` is not deployed — the rule survives.

**6 — Security and tenancy.** Two real accounts in two browser contexts. Account
B could read none of A's recipes, ingredients, prices or costings, and its own
list contained none of A's work. In SQL, exercised as `authenticated` with a
forged `sub` rather than as superuser: cross-tenant reads return 0 rows and
writes are refused.

**7 — Launch QA.** 217/217 automated. Mobile and desktop, navigation, both former
404s gone, refresh, direct URL, empty states, validation, currency, no
NaN/null/undefined, no console errors, no failed requests, 0 px overflow at
390 px.

---

## Defects

### P0 — none open

### P1

| | |
|---|---|
| **P1-1** | **`0031` and `0032` are not in production.** Everything about entitlement is proven on a disposable copy. Until they are applied, trials do not expire and V-7 stays open in production. |
| **P1-2** | **The ingredient dropdown defaults to the first of ~180 starter items** (alphabetically, "Acha"). A hurried customer could add the wrong ingredient. A search or a "your items first" ordering is a small change and a real one. |
| **P1-3** | **`v_recipe_cost_current` remains ambiguous under a `computed_at` tie** (suite 021 check 20). Production cannot reach it while one action performs one recompute; the code holds that rule deliberately, and nothing enforces it structurally. |

### P2

Recipe edits are full round trips with no optimistic UI · no sub-recipe screen ·
ingredients cannot be edited or deactivated · labour and overheads excluded
(stated on the page) · `/dashboard` and `/reports` still read trading views that
cannot yet hold data · the auth issuer was local, so email delivery and password
verification are unexercised.

---

## Rollback

- **Frontend** — additive. Reverting `bab9f54` and `66724fd` restores the
  previous app; no existing route was rewritten.
- **`0031`** — `migrations/proposed/0031_rollback.sql` drops a new table with no
  dependants.
- **`0032`** — `migrations/proposed/0032_rollback.sql` restores the `0028`
  entitlement definition **verbatim** and the `0004` blanket policies, and drops
  the constraint, the config table and both new functions. The function
  signature never changes, so the 60 original policies are untouched in either
  direction.
- **Database** — nothing to roll back in production. Nothing was applied there.

---

## What still needs you

1. **Run the D-3 classification query** (`D24_PRE_LAUNCH_ACCOUNTS.md` §5). It
   tells you whether any production subscription has a NULL boundary, and gives
   the D-24 classification. `0032` refuses safely either way, but you should
   know the answer before deploying, not from an error message.
2. **Authorise `0031` and `0032` for production.** Both are reversible and
   verified; neither has been applied.
3. Nothing else is blocked.

---

## Recommendation: **CONDITIONAL GO — SEPTEMBER 7**

**Why not NO-GO.** The condition that made the last report conditional has been
met and is not being restated: the complete customer journey now runs in a real
browser against real PostgREST, real PostgreSQL and real RLS, and it passes
33/33 with the values asserted rather than the status codes. A new customer
reaches a true, defensible recipe cost in thirteen steps. Tenant isolation holds
against a second real account. 217 automated checks pass.

**Why not GO.** One thing separates them, and it is not a defect: **`0031` and
`0032` have never been applied to production.** Until they are, the advertised
14-day trial does not end — `trialing` is still matched on status alone — and
V-7 remains open, so a lapsed account could still write prices. Both are
authored, reversible and proven; neither is deployed, and I was not authorised
to deploy them.

**This becomes an unconditional GO when `0031` and `0032` are applied to
production and their self-checks report the expected counts** (`0031`: one
policy, SELECT-only for `authenticated`; `0032`: 69 gated write policies, 0
gated reads, grace 7 days, boundary constraint present). That is a single
authorised deployment window, not further engineering.

P1-2 and P1-3 do not block. Neither can produce a wrong cost: P1-2 is a
selection convenience and P1-3 is unreachable while the code holds one recompute
per action.
