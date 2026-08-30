# MENU MASTER NG — SYSTEM RECONCILIATION

Single source of truth for what exists, what is live, and what is connected.
Every claim is labelled **PROVEN** (direct evidence, cited) or **UNVERIFIED**
(cannot be established from this session's access). Prose from earlier reports
is not treated as evidence where direct evidence contradicts it.

Audit environment: PostgreSQL 17.6 replica built from `migrations/0001–0033`.
Egress from this session is blocked; no Supabase CLI, no Vercel CLI, no
credentials of any kind are present.

---

## 0. ACCESS BOUNDARY (why some items stay UNVERIFIED)

| Target | Result |
|---|---|
| `api.vercel.com` | HTTP `000` — blocked |
| `mgbrrrjxbufstsjrdoug.supabase.co` | HTTP `000` — blocked |
| `menumasterng.com` | HTTP `000` — blocked; `WebFetch` → `EGRESS_BLOCKED` |
| `supabase` CLI | not installed |
| `vercel` CLI | not installed |
| Supabase/Vercel/Paystack env vars | **none present** |

Consequence: I can fully audit the repository and the schema, and I can reason
from artefacts the owner has observed. **I cannot query the live database,
read Vercel configuration, or load the live site.** Those items are marked
UNVERIFIED and are listed as blockers, not guessed at.

---

## 1. FRONTEND

**PROVEN — the live UI is not in this repository.** The live Ingredients screen
shows *Ingredient name · Category · Unit · Cost per unit · Date updated* with
Edit/Delete. Searching every ref in this repo's history for those strings
(`git log --all -S`) returns **no source file** — only descriptive prose in
`docs/historical/`. The repo's ingredient page instead exposes *Record a
purchase* and *Local measurements*.

**PROVEN — the live data is embedded in the page document.** DevTools search
for `Long grain rice` matched exactly one line, in `(index)` — the HTML
document itself — reading:

    name: 'Long grain rice', category: 'tubers_grains', unit: 'kg', cost: 1600

That is a hard-coded JavaScript object literal, not a database row.

**PROVEN — the live source is not on GitHub within reach.** GitHub code search
for `"tubers_grains" "Long grain rice"` across all of GitHub returns
**0 results**; the same query scoped to `sadeademuyiwa-cpu/menu-master` returns
**0 results**. `list_repos` shows the account has access to exactly **one**
repository: `sadeademuyiwa-cpu/menu-master`.

**PROVEN — Vercel Production has no environment variables** (owner-observed:
Project tab "No Environment Variables Added", Shared tab none linked).
Therefore the live app cannot be reading Supabase configuration from Vercel,
and its credentials must be inline in its own bundle. It also means **no
environment-variable change can repoint the live app** — and `NEXT_PUBLIC_*`
values are baked at build time regardless, so a rebuild and redeploy is
required for any repointing.

**INFERRED (high confidence), UNVERIFIED** — taken together (no Git repo in
reach, no env vars, no source on GitHub), the live deployment is most
consistent with a **manual / Vercel Drop / CLI deployment, or a deployment from
a private repository under a different account**. The distinction matters
because it determines whether the live code can be recovered and version
controlled at all.

| Item | Status |
|---|---|
| Framework | UNVERIFIED |
| Production source files | UNVERIFIED — not in this repo, not on GitHub in reach |
| Deployment mechanism | UNVERIFIED — Git connection not established; no env vars |
| Production domain | PROVEN — `menumasterng.com` |
| Vercel project / Git repo / branch / commit | UNVERIFIED |

### The repository frontend (`web/`)

Next.js 15 App Router, React 19, Server Components and Server Actions.
Routes: `dashboard`, `ingredients`, `ingredients/[id]`, `recipes`,
`recipes/[id]`, `pricing`, `reports`, `account`, `onboarding`, `login`,
`signup`, `verify-email`.

**PROVEN — it has never been deployed.** `web/.env.local` sets
`NEXT_PUBLIC_SUPABASE_URL` to `http://127.0.0.1:54321`, the local test gateway.
**No production Supabase URL exists anywhere in the repository**, in any file
type, at any commit.

---

## 2. BACKEND

**PROVEN — one project contacted by the live app:** ref `mgbrrrjxbufstsjrdoug`
(owner-observed in DevTools Network).

**PROVEN — that project has no `app_state`.** The live app requests
`/rest/v1/app_state` and receives **404**. PostgREST returns 404 when a table
is absent from the exposed schema. So the legacy JSON store either never
existed there or is gone.

**PROVEN — the 0033 project has no `app_state` either** (owner ran the
`information_schema` lookup: no rows) and holds **7 `auth.users`**.

**UNVERIFIED and decisive:** whether `mgbrrrjxbufstsjrdoug` *is* the project
where 0031–0033 were deployed. The owner has not yet confirmed the ref of the
migration project. If they are the same project, then the live app, its 7
users, and the normalised schema are all in one place — the simplest possible
cutover, and no auth migration is needed at all.

### Normalised schema — what 0001–0033 actually provides

- **41 tables**, **14 views**, **60 `fn_*` functions**, **34 application triggers**
- **RLS enabled on all 41 tables.** `billing_events` carries 0 policies, i.e.
  deny-all to `authenticated` — secure by default, reachable only through
  definer functions.
- **41 SECURITY DEFINER functions** — every one requires the §36 review before
  release; not yet performed.

---

## 3. DATA

**PROVEN** in the 0033 project: `ingredients` 0 rows, `ingredient_prices` 0
rows, `subscriptions` 0 rows (earlier D-3 result), `auth.users` **7**.

Because onboarding calls `fn_create_account_and_business` — which creates an
account, a business *and* a subscription — zero subscriptions proves **none of
those 7 users has ever onboarded**. They are authentication identities with no
application data behind them.

**PROVEN — the visible ingredients are not customer data.** They are hard-coded
in the page bundle (§1). `Rice Test`, created by the owner, is not hard-coded;
where it persists is **UNVERIFIED** — it survived a reload, so some persistence
path exists that we have not yet identified. It is not localStorage: the only
keys present are `last-purchase-url`, `ongoing-checkout-events` (Paystack SDK)
and `sb-…-auth-token` (Supabase session).

**No legacy `app_state` data has been located anywhere.** It is not in the 0033
project and it 404s in the live project.

---

## 4. LEGACY

`docs/historical/` describes an earlier architecture: a single Supabase table
`app_state`, one row per vendor, all collections inside a JSON `data` field,
mirrored to localStorage, with the paywall reading `trial_start` / `subscribed`
from that row.

**That design is historical, and the deployed build does not implement it** —
its `app_state` request 404s while it renders hard-coded data. Whether any
`app_state` data ever existed in production is **UNVERIFIED**. Nothing is to be
deleted on the strength of this section.

`docs/historical/MenuMasterNGFinalSchemaandMigrationPlan.md` contains an
11-step non-destructive migration plan whose *principles* are sound and worth
keeping. **Its table mapping is unusable**: every destination it names was
never built.

| Plan target | Reality |
|---|---|
| `business_users` | never built → `memberships` |
| `ingredient_price_history` | never built → `ingredient_prices` |
| `measurement_units` | never built → `units` |
| `menu_items` | never built → `serving_formats` |
| `recipe_ingredients` | never built → `recipe_lines` |
| `billing_records` | never built → `billing_events` |

---

## 5. THE CORE FINDING — 29 of 41 tables have no user interface

**PROVEN** by intersecting every `.from('…')` call in `web/src` against the
table list.

**Has a screen (12):** `ingredients`, `ingredient_prices`,
`ingredient_unit_conversions`, `units`, `recipes`, `recipe_lines`,
`recipe_prices`, `businesses`, `business_settings`, `memberships`, `plans`,
`subscriptions`.

**Backend-only — built, constrained, RLS'd, tested, and unreachable by any user
(29):** `accounts`, `billing_config`, `billing_events`, `catalog_categories`,
`catalog_ingredients`, `channels`, `cost_snapshots`, `costing_method_changes`,
`customers`, `ingredient_categories`, `labour_rates`, `locations`,
`onboarding_requests`, `order_lines`, `orders`, `overhead_items`,
`period_closes`, `plan_features`, `profiles`, `purchase_lines`, `purchases`,
`recipe_labour`, `recipe_variants`, `sales_entries`, `serving_format_changes`,
`serving_format_packaging`, `serving_formats`, `subscription_changes`,
`suppliers`.

That includes **the entire purchase ledger** (`purchases`, `purchase_lines`,
`fn_post_purchase`, `fn_reverse_purchase`), **the whole serving-format and
packaging model**, **labour and overhead**, and **all of customers/orders/sales**.

---

## 6. MEASUREMENT ARCHITECTURE — already correct, entirely unexposed

**PROVEN.** `units` carries an `account_id`, so businesses can define their own
units. The shipped global catalogue already includes a `container` kind:

> bag, basket, bottle, bowl, bunch, bundle, carton, cob, congo, crate,
> cup_local, derica, drum, finger, gallon, head, heap, jerrican, keg, kongo,
> mudu, pack, paint, piece, portion, roll, rubber, sachet, sack, tin, tiya,
> tuber, wrap

**Every container unit has `factor_to_base = NULL`** — no universal conversion
is assumed for a paint, derica, mudu, bag or bunch. `fn_resolve_qty_to_base`
resolves: same unit → same-kind metric factor → **per-ingredient, per-account
`ingredient_unit_conversions`** → otherwise **NULL**, which surfaces as a
blocker rather than a guess.

The §10 requirement — ingredient-specific conversions, "1 paint of rice ≠ 1
paint of beans", refuse rather than guess — **is already implemented in
PostgreSQL and enforced.** The gap is purely that no shipped UI lets a user
record a conversion.

---

## 7. CONFIRMED DEFECTS

**D-1 · P1 · Manual estimates contaminate purchase-derived averages.**
`fn_ingredient_unit_cost` computes `sum(amount)/sum(qty_base)` filtered only by
`ingredient_id`, `account_id`, `reversed_at`, `effective_date`. **It never
filters on `source`**, although the column records
`purchase | manual | benchmark_accepted`. A manual rate stored as
`qty_base = 1` therefore perturbs a real weighted average. Proven on the
replica. Fixing it is a behaviour change to deployed costing and needs its own
migration, tests, and owner authorisation (§44).

**D-2 · P2 · No supplier, labour, overhead or packaging entry path.** The
schema models all four; no screen reaches any of them.

**D-3 · P1 · The purchase ledger is bypassed.** The repo's ingredient page
writes `ingredient_prices` directly with `source='manual'` rather than going
through `fn_post_purchase`. Only that function sets `source='purchase'` and
`purchase_line_id`, and only rows it creates can be reversed by
`fn_reverse_purchase`. Prices written directly are **unreversible by design**.

**D-4 · P0-if-live · Two entitlement systems.** The legacy paywall reads
`app_state.subscribed`; 0031/0032 govern `subscriptions`, which has **zero
rows**. The entitlement work I verified currently protects nobody. Both must
never be authoritative at once (§23).

---

## 8. ROOT CAUSE

The backend was designed and built to completion against a documented target
schema, while the deployed product remained a separate, earlier front end that
was never migrated onto it. Three things let that persist unnoticed:

1. **The two halves never shared configuration.** The repo frontend has only
   ever pointed at `localhost`. Nothing in the repository has ever referenced a
   production Supabase project, so no build could have connected them.
2. **Verification ran end-to-end against the repo's own stack.** My browser
   journey (46/46) drove the repo frontend against a local PostgREST and
   PostgreSQL. Every check was true of that code. **None of it was evidence
   about production**, and I reported it without establishing that link. That
   is the single largest error in this project's audit trail, and it is mine.
3. **The migration plan of record targeted a schema that was never built**, so
   the cutover it described could not have been executed even if attempted.

The result is a complete, verified backend with no product on top of it, and a
live product with no backend beneath it.

---

## 9. CANONICAL ARCHITECTURE (going forward)

PostgreSQL/Supabase is the source of truth. The normalised 0001–0033 schema is
the backend. `User → Account → Business → Location`, isolated by `account_id`
under RLS. The repository's Next.js app in `web/` is the canonical frontend and
is extended — **not replaced** — to expose the 29 unreachable tables. No third
architecture is introduced. No financial arithmetic is duplicated in the
browser. `app_state` is not revived.

---

## 10. STATUS SUMMARY

| | |
|---|---|
| **Live** | A frontend serving hard-coded data, source unknown, no env vars, `app_state` 404 |
| **Connected** | Nothing. No deployed code reads the normalised schema |
| **Broken** | The live app's server persistence; two competing entitlement paths |
| **Dormant** | 41 tables, 14 views, 60 functions, 0033's `v_recipe_line_costs`, and a verified costing engine — all correct, none reachable by a customer |
| **Reusable** | Effectively all of the backend, and the `web/` frontend as the base to extend |
