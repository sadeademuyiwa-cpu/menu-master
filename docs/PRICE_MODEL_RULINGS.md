# PRICE MODEL — OWNER RULINGS AND WHAT THEY IMPLY

**Status: RULINGS RECORDED, 27 Aug 2026. NOT IMPLEMENTED.**
`0031`–`0033` remain held. This document records the owner's commercial rulings
verbatim in substance, then states — without softening — what the existing schema
and state machine do *not* currently support, what is still undecided, and the
minimum set of decisions required before any migration is written.

Companion to `docs/FOUNDING_MEMBER_BEHAVIOUR.md` (founding status, entitlement
and the nine approved behaviours), which this supersedes on all commercial
questions.

---

## 1. The rulings

| # | Ruling |
|---|---|
| R1 | **VAT-inclusive display.** ₦3,500 means the customer pays ₦3,500 in total; ₦7,500 means ₦7,500 in total. The VAT component is modelled separately for accounting and audit. Nothing is added at checkout. Correct Nigerian VAT treatment for a SaaS subscription, and the invoice/tax records required, must be **confirmed, not guessed**, before implementation. |
| R2 | **Upgrades do not prorate.** Costing → Costing + Sales inside an already-paid period grants the upgraded features **immediately**; the higher recurring amount begins at the **next renewal**. The change and its effective billing date are recorded. |
| R3 | **Downgrades do not remove paid features early.** The downgrade is scheduled for the **end of the current paid period**. Lower price and lower entitlement both begin at the next renewal. |
| R4 | **7-day grace.** `past_due` remains entitled during grace. A temporary failure must not revoke founding pricing. Recovery inside grace continues normally. Still unpaid past the boundary → lapse the subscription and revoke the founding-price entitlement **exactly once**. Founding Member status is permanent regardless. |
| R5 | **Refunds and chargebacks are two different things.** Ordinary later refunds leave founding history intact. A **first** payment reversed before it should legitimately establish the grant is a narrowly-defined exception — designed in §5 below, **not implemented**, and never a route to casual slot reuse or a 101st legitimate founding member. |
| R6 | **Four paid price records / Paystack plans.** costing×founding ₦3,500, trading×founding ₦7,500, costing×standard TBA, trading×standard TBA. Free Trial ₦0 consumes no slot. A slot is granted only on the **first successful qualifying paid subscription**. |
| R7 | **Feature enforcement is launch-critical.** The two paid products must differ by more than a stored `level` flag. Backend/database authorisation must enforce the approved limits. A Costing customer must not reach Costing + Sales capability by manipulating the client. |
| R8 | **Transactional billing communication is launch-critical**, and auditable: activation, failed payment / grace, cancellation, trial ending, scheduled upgrade/downgrade, founding-price loss, and any renewal-price change requiring customer action. |
| R9 | **Subscription unit is the account.** Business allowances belong to the plan. Extra businesses create neither extra subscriptions nor extra founding slots. |
| R10 | **Billing interval is first-class.** Monthly, quarterly and annual, modelled separately from plan and from price tier. Nothing is hard-coded around monthly. One founding slot per account **regardless of interval**; changing interval mints no slot and loses no status. Cancelling auto-renewal never terminates already-paid entitlement — access and founding price run to the paid-through date, and lapse occurs only after that passes without a successful renewal. |
| R11 | **Upgrades prorate; downgrades do not.** A plan upgrade inside any paid period grants features immediately and charges the unused-value difference, by one interval-independent rule (§10). A downgrade is never prorated or refunded: it is scheduled for the next renewal boundary, the customer keeps the paid features until `current_period_end`, and the lower plan and price begin at the next cycle. |
| R12 | **Founding is eligibility for a tier, not a frozen amount** (D-12, confirmed). A founding member may move between monthly, quarterly and annual, and may upgrade between Costing and Costing + Sales, and remains eligible for the corresponding founding price — provided the entitlement has not already lapsed under the approved rules. No such change creates another slot, alters the founding number, or consumes another of the 100. |

R9 matches the schema exactly: `subscriptions.account_id`, `businesses.account_id`,
`ux_subscriptions_account` unique per account. Nothing to change.

R10's founding amounts, VAT-inclusive. **Corrected by the owner on 27 Aug 2026 —
these supersede the discounted figures that appeared in the first R10 draft:**

| | Monthly | Quarterly | Annual |
|---|---|---|---|
| **Costing** | ₦3,500 | ₦10,500 | ₦42,000 |
| **Costing + Sales** | ₦7,500 | ₦22,500 | ₦90,000 |

**There is no quarterly or annual discount for the Founding 100.** Quarterly and
annual are prepaid convenience options at exactly **3×** and **12×** the
applicable founding monthly price. Any earlier statement in this repository that
the founding annual price is ₦35,000 or ₦75,000, or that the annual founding
discount is 16.7%, is **withdrawn and wrong**.

The revised price model is §7; the upgrade proration specification is §10.

---

## 2. Contradictions with the schema and the state machine

These are stated as defects to close, not as objections to the rulings.

### C-1 — There is no scheduler. Nothing in Menu Master NG runs on a timer.

The only installed extension is `pgcrypto`. `SUBSCRIPTION_STATE_MACHINE.md` §1
says so plainly: *"Nothing in Menu Master NG runs on a timer today."* The
entitlement rule was deliberately written to be date-derived so that it stays
correct **without** a scheduler.

R2, R3, R4, R5 and R8 all require something to happen **at a moment in time when
no customer is present and no webhook necessarily arrives**:

| Ruling | Time-triggered action with no trigger today |
|---|---|
| R2 | switch the provider plan to the higher amount **at renewal** |
| R3 | apply the downgrade **at period end** |
| R4 | lapse and revoke **at grace expiry** — day 8, no event arrives |
| R5 | close the reversal window |
| R8 | notify **before** the next charge |

Two of these are unsafe to leave date-derived. Revocation (R4) must be stamped
**exactly once** with a `lapsed_at`, and a notification (R8) must be *sent*, not
computed. Neither is a query result.

**This is the largest single gap in the price model and it blocks R2, R3, R4, R5
and R8 alike.** It needs a decision (§6, D-1) before those rulings can be built.

### C-2 — `subscriptions` has one `plan_id`. R2 and R3 need three ideas.

R2 makes features and billing diverge on purpose: after an upgrade the customer
*has* Costing + Sales while Paystack is still charging the Costing amount. R3
makes them diverge the other way. One column cannot carry both, and it also has
to carry the pending change.

Proposed shape (additive; no column is dropped or repurposed):

```
subscriptions
  plan_id                 -- UNCHANGED MEANING: entitlement in force NOW
  billing_plan_id         -- what the provider is charging now
  scheduled_plan_id       -- pending change, NULL when none
  scheduled_effective_at  -- when it takes effect (= current_period_end)
```

- Upgrade: `plan_id` → trading immediately; `billing_plan_id` stays costing;
  `scheduled_plan_id` = trading at `current_period_end`.
- Downgrade: `plan_id` unchanged; `scheduled_plan_id` = costing at
  `current_period_end`.

R7's enforcement then reads `plan_id` and is correct in both directions with no
special case. Everything already written that reads `plan_id` keeps its meaning.

### C-3 — R2 and R3 are not free at Paystack.

A Paystack plan code encodes its amount. A subscription left alone renews at the
**old** amount forever; "the higher amount begins at the next renewal" is an
action, not a default. Executing it means cancelling the current subscription and
starting one on the other plan code at the period boundary — which needs the
customer's stored authorisation to be reusable, and under R8 condition 8 of the
founding design it may need their explicit authorisation.

There is no design for this yet, and it is the same mechanism a founding member
needs when their price lapses to standard.

### C-4 — `fn_account_is_entitled` has no time bound on `past_due`.

Installed by `0028` and now referenced by 60 write policies across 23 tables:

```
status IN ('trialing','active','past_due')
  OR (status = 'cancelled' AND current_period_end > now())
```

`past_due` is entitled **forever**. R4's 7-day grace requires a bound. The
function is replaceable in place — the signature does not change, so none of the
60 policies is touched — but the predicate itself changes, and two existing test
assertions change with it:

- `tests/018_entitlement.sql` check 3 — *"past_due can still write (dunning is a
  grace period)"*
- `tests/019_billing_lifecycle.sql` check 10 — same claim

Both must be given a `current_period_end` inside grace to keep passing, and new
checks added for grace **expiry**. That is the rule changing, not a test being
weakened, and the distinction should be recorded in the migration header.

`subscriptions` also has **no column recording when dunning began**. §3.2 of the
state machine says `current_period_end` is deliberately *not advanced* on a failed
renewal, which makes it the natural boundary:
`grace_ends_at = current_period_end + 7 days`. No new column is needed — but see
D-3 for the case where `current_period_end` is NULL.

### C-5 — There is no record of what any customer was ever charged.

`billing_events` (`0027`) records that a webhook **arrived**. It stores
`body_sha256`, a redacted payload, status and error — not an amount.
`subscriptions` has **no amount column**. `plans.monthly_price` is `0.00` for all
three plans.

R1 requires invoice and tax records to be retained. Today the system could not
produce a single invoice, or state what VAT was collected in any month. This
needs a new charge/invoice record — gross, VAT rate, VAT amount, net, currency,
period covered, provider reference — written when a charge succeeds.

### C-6 — Two sources of truth for price.

`plans.monthly_price` is `NOT NULL` and readable by `anon` (`0011`, `0018`).
`plan_prices` (R6) will hold four rows with the real amounts. Leaving both live
guarantees they will disagree. Either `plans.monthly_price` is retired from all
read paths and documented as legacy, or `plan_prices` becomes its only source.
This must be settled inside `0031`, not after.

### C-7 — Plan-limit enforcement was formally deferred; R7 reverses that.

`SUBSCRIPTION_STATE_MACHINE.md` §4 lists *"Plan-limit enforcement from
`plan_features` — Phase 2"*. R7 makes it launch-critical. Not a contradiction with
the schema, but a documented deferral being cancelled, and it should be recorded
as such rather than quietly reversed.

### C-8 — Nothing reads `plan_features`. Confirmed by search, not assumed.

`limit_value` and `feature_key` appear in `0001` (definition), `0010` (seed),
`0011`/`0018` (grants) and three test files asserting the **grant surface**. No
function, policy, trigger or view consumes them. Today a ₦3,500 account can
create five businesses and twenty users.

---

## 3. Feature entitlements as currently intended

This is what the database actually contains today, seeded by `0010`. It is the
*only* definition of the three products that exists.

| `feature_key` | `trial` | `costing` | `trading` |
|---|---|---|---|
| `level` | 1 | 1 | **2** |
| `businesses` | 1 | 1 | **3** |
| `users` | 2 | 3 | **10** |
| `recipes` | **20** | unlimited (`NULL`) | unlimited (`NULL`) |

Plan names in `plans`: `trial` = "Free Trial", `costing` = "Costing",
`trading` = "Costing + Sales". All three currently `monthly_price = 0.00`.

**None of these four limits is enforced anywhere** (C-8), and three further
things are undefined:

1. **What `level = 2` actually unlocks is written down nowhere.** No document in
   the repository names the tables or capabilities that separate Costing from
   Costing + Sales. Proposed split, drawn from the schema and needing approval:

   | | Tables |
   |---|---|
   | **Level 1 — Costing** | units, unit conversions, ingredients, suppliers, ingredient prices, business settings, recipes, recipe lines, labour rates, recipe labour, overheads, cost snapshots, serving formats, recipe variants, format packaging, channels, recipe prices |
   | **Level 2 adds — Sales/Trading** | customers, orders, order lines, sales entries, purchases, purchase lines, period closes |

   Channels and recommended pricing sit in **Level 1**: "what should I charge" is
   the costing product. Level 2 is where money actually moves.

2. **Reads are never gated** — the `0028` precedent. A downgraded customer keeps
   reading every order they ever entered; they simply cannot record new ones.
   This should stay true and be stated in the product copy.

3. **The trial's 20-recipe limit interacts with nothing.** What happens at recipe
   21 — refuse, or refuse and prompt to upgrade — is a product decision with no
   current answer.

---

## 4. The founding rules, restated under R4

No change to the nine approved behaviours. R4 supplies the missing number:

- Renewal fails → `past_due`, entitled, founding price intact.
- Recovery at any point up to `current_period_end + 7 days` → nothing is stamped,
  nothing is lost.
- Not recovered by that boundary → the subscription lapses, and
  `price_entitlement_revoked_at` / `revoke_reason = 'lapsed_unpaid'` /
  `lapsed_at` are stamped **once**. A later second lapse never re-stamps.
- `founding_members` row and `slot_number` are untouched. Permanent.

---

## 5. R5 — proposed reversal exception, FOR APPROVAL, NOT IMPLEMENTED

The problem R5 names: a first payment succeeds, the grant is minted, and the
payment is then reversed. Under permanence that burns a founding number on money
that never stayed.

### Proposed state boundary

The grant has two states, and the slot number is issued at the first:

```
founding_members
  ...
  granted_payment_reference   text not null   -- the exact payment that bought it
  grant_state                 text not null   -- 'provisional' | 'confirmed' | 'void'
  confirms_at                 timestamptz not null  -- granted_at + reversal window
  confirmed_at                timestamptz
  voided_at                   timestamptz
  void_reason                 text
  slot_number                 int unique      -- set NULL on void; NULL is not unique-constrained
```

| State | Meaning |
|---|---|
| `provisional` | `granted_at` ≤ now < `confirms_at`. The member has their number and their price. |
| `confirmed` | now ≥ `confirms_at`, or a confirming sweep ran. **Irreversible.** |
| `void` | the granting payment was reversed while provisional. |

### The exact rule

A reversal voids the grant **only** when all four hold:

1. the event is a refund or chargeback of `granted_payment_reference` — the
   **granting** payment, not any later one;
2. `grant_state = 'provisional'`;
3. the reversal is for the **full** amount granted;
4. it is the account's **first and only** successful qualifying payment — if any
   later payment succeeded, the membership stood on its own and is confirmed.

Any reversal failing any one of these leaves founding history **completely
untouched** and is handled as an ordinary refund. That is R5's "ordinary later
refunds" case, and it is the default.

### Audit behaviour

- The row is **never deleted**. `grant_state = 'void'`, `voided_at`,
  `void_reason`, and the reversal's provider reference are stamped.
- `slot_number` is set NULL and the **number returns to the pool**. The row keeps
  a permanent `voided_slot_number` copy, so "who briefly held #47" stays
  answerable.
- Allocation changes from `max(slot_number) + 1` to **lowest unused number in
  1..100 among non-void rows**. Under the advisory lock this stays race-free, and
  the `unique` + `check (between 1 and 100)` backstops still hold.
- Every void is an open item in `v_billing_reconciliation` until a human closes
  it.

### Why this cannot be abused

- The window is bounded by `confirms_at`, which is set **at grant time** and never
  extended. It cannot be reopened.
- Voiding requires a genuine provider reversal event — not an application call.
- A reversal one second after `confirms_at` does nothing.
- The cap is arithmetic: at most 100 non-void rows can exist, because allocation
  refuses when no number in 1..100 is free.
- A voided grant is not a released seat for the same account to re-take at the
  founding price: re-subscribing takes the ordinary path, and if a number is free
  they claim it as a **new** grant, recorded as such.

### The one number this needs

`confirms_at = granted_at + <reversal window>`. **I have not chosen it and will
not guess it** — it depends on Paystack's and the card schemes' chargeback
windows, which must be confirmed from Paystack's own documentation and terms
rather than from memory. Note the trade-off plainly: a long window (matching a
real chargeback window) means a founding member's status is provisional for
months; a short window (say 7 days) is honest to the customer but leaves a genuine
late chargeback holding a slot. **Neither is obviously right — see D-4.**

---

## 6. Minimum decisions still required before `0031`–`0033`

| | Decision | Blocks | Why it cannot be defaulted |
|---|---|---|---|
| **D-1** | **How time-triggered work runs.** `pg_cron` in Postgres, a Supabase scheduled Edge Function, or an external scheduler. | R2, R3, R4, R5, R8 — everything with a deadline | There is no scheduler at all today (C-1). Revocation and notification are actions, not query results. |
| **D-2** | **Standard price for each paid plan.** Two numbers. | `plan_prices`; customer 101; the anomaly's next renewal | Guessing a price is out of bounds, and customer 101 is blocked until it exists. |
| **D-3** | **Grace when `current_period_end` is NULL** on a `past_due` row. Proposed: remain entitled and raise a reconciliation item — never cut off a paying customer over missing data. | `fn_account_is_entitled` | It decides whether a real person loses access; the state machine's §3.5 precedent is to fail safe and loudly, not to guess. |
| **D-4** | **The reversal window in §5**, and whether R5's exception is approved at all. | `0032` | Requires a fact about Paystack/card-scheme chargeback windows plus a commercial judgement. |
| **D-5** | **Level 2 boundary** — approve or amend the table split in §3.1. | R7 enforcement | Nothing in the repository defines it; it is the difference between the two paid products. |
| **D-6** | **Are the four seeded limits the packaging you intend to sell?** businesses 1/1/3, users 2/3/10, recipes 20/∞/∞. | R7 enforcement | They were seeded in `0010` as scaffolding and have never been commercially confirmed. |
| **D-7** | **VAT treatment**, confirmed by a Nigerian tax adviser — is a SaaS subscription standard-rated, and what invoice/tax records must be retained? | R1, `plan_prices`, the invoice record (C-5) | **I cannot certify tax compliance and will not guess it.** See the note below. |
| **D-8** | **Four Paystack plan codes**, created and paired. | `0031` seed | Cannot be derived. |
| **D-9** | **Email provider and the R8 notification set.** | R8 | No transactional email exists; only Supabase Auth's own confirmation mail. |

### On D-7

The schema should be built so the answer is a **parameter, not a shape**. Storing
gross, the VAT rate applied, and the computed VAT and net amounts per price and
per charge means a different rate, an exemption, or a change of treatment alters
data — never the model. That much is safe to design now.

What is **not** safe for me to state is whether this subscription is standard-rated,
zero-rated or exempt, what threshold or registration obligation applies, or what
an acceptable invoice must contain. Those are questions for a Nigerian tax
adviser or FIRS directly, and the answer should be recorded in this document with
its source before `0031` is written.

### Scope note

`0031`–`0033` as previously scoped no longer covers the rulings. C-2 (plan
divergence), C-5 (charge/invoice record), R7 (limit enforcement), R8 (notification
outbox) and D-1 (scheduler) are each additional work. The realistic set is
`0031`–`0036`. That is a consequence of the rulings, not scope creep, and the
register should be corrected before implementation rather than after.

---

## 7. R10 — the revised price model, interval first-class

**Not implemented. This section replaces every earlier `plan_prices` sketch.**

The requirement is that nothing hard-codes monthly. The way to guarantee that is
not discipline — it is to make the **duration of a billing cycle a stored fact**
rather than an assumption spread across functions. One table owns it, and every
piece of period arithmetic reads that table.

### 7.1 `billing_intervals` — the cycle, as data

```
billing_intervals
  code               text primary key      -- 'monthly' | 'quarterly' | 'annual'
  name               text not null         -- customer-facing label
  months             int  not null check (months > 0)   -- 1, 3, 12
  provider_interval  text                  -- Paystack's own token for this cycle
  sort_order         int  not null
  is_active          boolean not null default true
```

Two columns carry the whole point:

- **`months`** is why nothing is hard-coded. Every period advance in the system
  becomes `current_period_end + (months || ' months')::interval`, read from this
  row. Adding a six-monthly cycle later is one INSERT and no code change. Months
  rather than days deliberately: calendar arithmetic keeps a 31 January renewal
  on the last of the month instead of drifting.
- **`provider_interval`** is why a naming mismatch is data, not a defect.
  Paystack's interval tokens are its own vocabulary and must be read from
  Paystack's documentation rather than assumed — the boundary-mapping discipline
  `SUBSCRIPTION_STATE_MACHINE.md` already applies to statuses, applied to cycles.

### 7.2 `plan_prices` — keyed on the triple

```
plan_prices
  id                  uuid primary key
  plan_id             text not null references plans(id)
  price_tier          text not null check (price_tier in ('founding','standard'))
  billing_interval    text not null references billing_intervals(code)

  gross_amount        numeric(14,2) not null check (gross_amount > 0)
  currency            text not null default 'NGN'
  vat_rate            numeric(6,4)          -- NULL until D-7 is answered
  vat_amount          numeric(14,2) generated always as (
                        round(gross_amount - gross_amount / (1 + vat_rate), 2)
                      ) stored
  net_amount          numeric(14,2) generated always as (
                        gross_amount - round(gross_amount - gross_amount / (1 + vat_rate), 2)
                      ) stored

  provider_plan_code  text
  effective_from      timestamptz not null default now()
  effective_to        timestamptz             -- NULL = current
  is_active           boolean not null default true

  unique (provider_plan_code)                        -- where not null
  unique (plan_id, price_tier, billing_interval)     -- where effective_to is null
```

Four properties, each deliberate:

1. **`gross_amount` is the source of truth**, because R1 says the customer pays
   ₦3,500 in total. VAT and net are *derived downward* from it, never added to
   it. There is no path by which a stored figure becomes a bigger charge.
2. **`vat_rate` NULL propagates to NULL**, not to zero. Until D-7 is answered,
   `vat_amount` and `net_amount` are NULL — incomplete, visibly, in exactly the
   way the governing rule requires. A zero there would be a fabricated tax
   position.
3. **`net = gross − round(vat)`**, not `gross / (1 + rate)` rounded
   independently. The two rounded figures then sum to the gross exactly, every
   time. An invoice whose parts do not add up is not an invoice.
4. **Effective-dated and append-only.** A standard price rises by inserting a row
   and closing the old one. Nothing that was charged is ever rewritten — the same
   discipline `0008` already applies to cost snapshots.

`trial` gets **no rows at all**. It is not purchasable. Twelve rows exist when
the model is complete: 2 plans × 2 tiers × 3 intervals.

### 7.3 The normalised figure, for comparison only

`months` lives in `billing_intervals`, so a per-month figure belongs in a view
rather than a stored generated column:

```
  monthly_equivalent = round(gross_amount / months, 2)
```

Under the corrected prices this is **exactly the monthly price** for every row —
quarterly is 3× and annual is 12×, with no discount. So its purpose is not to
reveal a saving; it is to normalise mixed-interval revenue into one comparable
figure for reporting. It is **never charged**.

| | Monthly | Quarterly | Annual | Monthly equivalent |
|---|---|---|---|---|
| Costing | ₦3,500 | ₦10,500 | ₦42,000 | ₦3,500 throughout |
| Costing + Sales | ₦7,500 | ₦22,500 | ₦90,000 | ₦7,500 throughout |

Two consequences worth stating, because they are not obvious:

- **The product copy must not imply a saving.** Quarterly and annual are a
  convenience — fewer payment events, less card-failure exposure — not a
  discount. Describing them as "save with annual" would be false.
- **Proration gets simpler.** With no cross-interval discount, the difference
  between plans scales linearly with the cycle: ₦4,000/month, ₦12,000/quarter,
  ₦48,000/year. §10's rule needs no discount-unwinding term.


---

## 8. What R10 changes elsewhere

### 8.1 Paystack plan mapping — `0030`'s column is now structurally wrong

`0030` added **`plans.provider_plan_code`**: one code per plan, with
`ux_plans_provider_plan_code` unique on it, and `fn_billing_apply` resolving
`data.plan.plan_code` to a single `plans` row.

Under R10 a plan has **six** codes (2 tiers × 3 intervals), so a column on
`plans` cannot hold them. The code must live on `plan_prices`, where the triple
is the key.

The migration is clean because of how `0030` was written: it deliberately seeded
**no** codes, and the deploy verification returned `0` seeded. The column is NULL
on all three rows, so dropping it and its index **loses no data** — this is a
relocation, not a data migration. It should still be verified as NULL at
migration time rather than assumed.

What changes in the ingest: resolution stops returning a `plan_id` and starts
returning **`(plan_id, price_tier, billing_interval)`**. The `unmapped_plan_code`
refusal path that `0030` built is unchanged and still correct — it simply now
guards a richer target.

**Twelve Paystack plans must be created, not four.** D-8 grows accordingly.

### 8.2 Subscription state — the date-derived rule already scales

The best news in this revision: `fn_account_is_entitled` needs **no change for
intervals at all**.

```
status IN ('trialing','active','past_due')
  OR (status = 'cancelled' AND current_period_end > now())
```

It reads a date, not a cycle. An annual subscriber who cancels in month 2 keeps
access — and founding price — for the remaining ten months, automatically,
because `current_period_end` says so. That is exactly R10's requirement that
cancelling auto-renewal never terminates paid entitlement, and it is already
true. The date-derived design chosen to survive the absence of a scheduler turns
out to survive multiple intervals too.

What `subscriptions` does need:

```
  billing_interval        text references billing_intervals(code)
  price_tier              text          -- what is actually being charged
  scheduled_interval      text          -- pending, alongside scheduled_plan_id
```

`scheduled_plan_id` / `scheduled_effective_at` from C-2 now carry an interval and
a tier as well: a pending change may move any of the three axes.

### 8.3 Upgrades and downgrades — RULED

R2 and R3 were written for one axis. There are now two, and "upgrade" is
ambiguous on the interval axis: monthly → annual costs more per charge and, in
general, could cost less per month. The owner's rulings resolve both axes.

**The plan axis (D-10, approved — proration).** A plan upgrade inside any paid
period grants Costing + Sales **immediately** and charges the unused-value
difference. The customer does not receive the remainder of a quarterly or annual
higher tier for free. One interval-independent rule, specified in **§10** — not
an annual special case. The earlier A/B/C options are closed: **B**, generalised
to every interval rather than only to multi-month ones.

**The plan axis, downward (R11).** No proration, no refund. The downgrade is
scheduled for the next renewal boundary. Paid features run to
`current_period_end`; the lower plan and price begin at the next cycle.

**The interval axis.** No feature effect either way, so nothing can be granted
early and nothing is prorated. The new interval and its amount begin at the
boundary. Money moves at the boundary; only *features* move early, and only
upward — which now applies solely to the plan axis.

This gives one sentence per axis and no undecided transition, with a single edge
left open: a **combined** plan-and-interval change in one action (see D-15).

### 8.4 Dunning — RULED: uniform, 7 days

D-11 is settled: **the same grace policy across every interval**, unless a
provider or technical reason forces otherwise. An annual subscriber does not stay
active longer merely because their invoice is larger. `grace_ends_at =
current_period_end + 7 days` is interval-independent and needs no change for
R10.

The 7 days stands as the **design assumption**, and is not implemented until the
remaining state-machine decisions (D-1, D-3) are reconciled — because the rule
cannot be enforced at all without something to act at the boundary.

One consequence that survives the ruling: an annual founder who lapses loses the
founding tier permanently and only meets the consequence a year later, at
renewal. That makes R8's notification requirement matter more here, not less.

### 8.5 Founding 100 — RULED: D-12 confirmed

Founding status protects **eligibility for the founding tier**, not one literal
amount. R10's slot requirements are satisfied **structurally by the approved
design**, not by new logic:

- **One slot per account regardless of interval** — `founding_members.account_id`
  is the primary key. A second slot is unreachable however many times the
  customer changes plan or interval.
- **Interval or product change mints nothing and loses nothing** — no code path
  touches `slot_number` on such a change, and the PK forbids a second row. The
  founding number never changes and no further place in the 100 is consumed.
- **Cancelling auto-renewal keeps the founding price to the paid-through date** —
  the `cancelled AND current_period_end > now()` clause, unchanged. Lapse occurs
  only after that date passes without a successful renewal.

Eligibility is conditional on one thing only: **the founding-price entitlement
has not already lapsed or been revoked** under the approved rules. A revoked
member changing interval gets the standard price for that interval, and keeps
their number.

Two points to record:

1. `founding_members` gains **`granted_interval`** alongside `granted_price`, so
   the grant records what was actually bought. Slot allocation is untouched.
2. Under the corrected prices, a founding member switching monthly → annual pays
   **₦42,000** — which *is* twelve times ₦3,500. The tier-not-amount rule is
   therefore invisible on the interval axis and only does work on the **plan**
   axis, where a founder upgrading pays the founding trading price rather than
   the standard one. Stated because the earlier draft justified this rule with a
   discount that no longer exists.

R5's reversal window still interacts with interval: a reversed **₦90,000** first
payment is a far larger exposure than a reversed ₦3,500 one, which argues for a
longer provisional window against wanting a short one. That sharpens D-4; it does
not change the mechanism.

### 8.6 Two smaller consequences

- **`plans.monthly_price` is now actively misleading**, not merely duplicated
  (C-6). Under R10 there is no single monthly price for a plan. It should be
  retired from every read path in `0031` and documented as legacy.
- **Checkout must ask for an interval.** The signup flow currently chooses a plan
  only. Plan × interval is a two-axis choice at checkout, and the quoted amount —
  the one the founding-race anomaly is measured against — is the interval's
  amount. A frontend change, recorded here so it is not discovered late.

---

## 9. Status of the R10 decisions

| | Decision | Outcome |
|---|---|---|
| D-10 | Plan upgrade during a prepaid period | **RULED — prorate, immediate features.** One interval-independent rule, §10. |
| D-11 | Annual grace period | **RULED — uniform 7 days**, held as a design assumption pending D-1 and D-3. |
| D-12 | Founding tier across intervals | **CONFIRMED.** §8.5. |
| D-13 | Paystack interval tokens **and whether Paystack supports our cycles at all** | **OPEN — must be verified against official Paystack documentation.** Not guessed. |
| D-2 | Standard prices | **OPEN, and deliberately so.** The schema must accept them later with no migration — §7.2's `plan_prices` does, since a standard row is an INSERT. |
| D-8 | Paystack plan codes | **twelve**, not four. Blocked behind D-13. |

---

## 10. D-10 — the proration specification

**Design only. Not implemented.**

### 10.1 The rule

One formula, for every interval. Nothing in it reads `months`, so it is
interval-independent by construction and a cycle added later needs no new code.

```
charge = floor_2dp( (G_new - G_old) * remaining_days / total_days )

  total_days     = date(P_end) - date(P_start)
  remaining_days = greatest(0, least(total_days, date(P_end) - date(T)))

  G_old = gross_amount for (current_plan, tier, interval)
  G_new = gross_amount for (target_plan,  tier, interval)   -- SAME interval
  T     = the moment of upgrade
```

**Days, not months.** A quarter is not three equal months and a year is not
twelve; 91 days, 92 days and 366-day years all fall out of date subtraction
correctly. Using `months` here would reintroduce exactly the monthly assumption
R10 removes.

**The same `tier` on both sides.** A founding member prorates on founding prices;
a standard customer on standard prices. Founding eligibility (R12) is what
selects the tier, and it does so once for both legs.

### 10.2 Rounding

- **Floor to two decimal places** — to the kobo. Never charge a fraction the
  arithmetic does not support. Rounding half-up would overcharge on roughly half
  of all upgrades by up to one kobo, and there is no reason to.
- The result is an exact kobo figure, so it converts to Paystack's integer minor
  units without a second rounding step.
- **VAT needs no separate rule.** `G_old` and `G_new` are VAT-inclusive, so the
  difference is VAT-inclusive and the charge is too. VAT and net derive downward
  from it by §7.2's formula, at the rate in force. One rounding, one place.

### 10.3 What the charge is, and is not

| | |
|---|---|
| **Is** | a one-off charge against the stored authorisation, for the unused value of the current period |
| **Is not** | a new subscription, a new period, or a change to `current_period_end` — the period boundary **does not move** |
| **Then** | the recurring plan changes to the higher plan at `P_end`, at its full price for the same interval |

So an upgrade is **two provider operations**: charge the difference now, and move
the recurring subscription at the boundary. `plan_id` (entitlement) flips
immediately; `billing_plan_id` flips at `P_end`. That is exactly what C-2's
column split was for.

### 10.4 Guards — the upgrade is refused, not approximated

| Condition | Refusal |
|---|---|
| No `plan_prices` row for (target plan, tier, **this interval**) | `no_price_for_interval` — this is where an unset D-2 bites a standard-tier customer |
| `G_new <= G_old` | `not_an_upgrade` — route to the scheduled downgrade path |
| `current_period_end` is NULL | `unknown_period_end` — see D-3; never assumed |
| `total_days <= 0` | `degenerate_period` |
| Subscription is `past_due` | `upgrade_while_past_due` — money is already owed (D-16) |
| Computed charge below the provider minimum | **not a refusal** — waive, grant the upgrade, record the calculated amount and the waiver reason (D-14) |

Every one of these refuses rather than substituting a default. A prorated charge
computed from a guessed period end would be a fabricated invoice.

### 10.5 Worked examples

Founding tier. Plan difference: **₦4,000** monthly, **₦12,000** quarterly,
**₦48,000** annual — linear, because there is no interval discount (§7.3).

**Monthly.** Period 1 Sep → 1 Oct 2026 (30 days). Upgrade on 11 Sep.

```
remaining = 1 Oct - 11 Sep = 20 days
charge    = 4,000 x 20/30 = 2,666.6666...  ->  ₦2,666.66
```

**Quarterly.** Period 1 Sep → 1 Dec 2026 (**91** days — Sep 30 + Oct 31 + Nov 30).
Upgrade on 1 Oct.

```
remaining = 1 Dec - 1 Oct = 61 days
charge    = 12,000 x 61/91 = 8,043.9560...  ->  ₦8,043.95
```

**Annual.** Period 1 Sep 2026 → 1 Sep 2027 (365 days). Upgrade on 1 Mar 2027.

```
remaining = 1 Sep 2027 - 1 Mar 2027 = 184 days
charge    = 48,000 x 184/365 = 24,197.2602...  ->  ₦24,197.26
```

At renewal on 1 Sep 2027 they pay the full **₦90,000** annual founding price.
Total across the year: ₦42,000 + ₦24,197.26 = ₦66,197.26 — the Costing year they
bought, plus the upgrade for the half of it they actually used at the higher
tier. Nothing given away, nothing charged twice.

**Two edges.**

```
upgrade on day 1 of the period   ->  4,000 x 30/30  =  ₦4,000.00  (the full difference)
upgrade on the last day, annual  ->  48,000 x 1/365 =    ₦131.50  (see D-14)
```

The first is correct and desirable: upgrading immediately costs exactly the
difference, so nobody games the boundary. The second is what D-14 is about.

---

## 11. Remaining decisions, in priority order

### Blocks implementation

| | Decision | What it blocks | Why it cannot be defaulted |
|---|---|---|---|
| **1** | **D-13 — CLOSED on verified provider facts, 27 Aug 2026.** The owner verified Paystack's documentation independently. All three cycles native; twelve Plan mappings confirmed; `annual` → **`annually`**, so `provider_interval` is mandatory. Three value-level unknowns survive (`D13` §7.3). **Prohibition recorded: never move one subscriber by mutating a shared Paystack Plan.** | **seeding only** — `0031`'s shape is confirmed safe | Plan codes are still not to be created. |
| **2** | **D-1 — DIRECTION APPROVED; implementation-ready design awaiting sign-off.** `docs/D1_SCHEDULER_DESIGN.md`. Two invariants carry it: **due-or-overdue predicates** (a missed run self-recovers, no catch-up mode) and **derive, don't decide** (jobs stamp and send; they never own entitlement). Provider commands dispatch **at request time**, not at the boundary — otherwise a scheduler outage would let the old plan renew at the old price. | **`0036`** | **V-1 verified 27 Aug 2026**: `pg_cron` 1.6.4 available, not installed; `pg_net` 0.20.4 available and deliberately not adopted. Design unchanged. |
| **3** | **D-4 — approve R5, and set the reversal window.** | **`0032`** — it decides `founding_members`' columns | The table cannot be built twice. A ₦90,000 annual first payment sharpens it. |
| **4** | **D-3 — grace when `current_period_end` is NULL.** Proposed: stay entitled, raise a reconciliation item. | the `fn_account_is_entitled` change, and §10.4's `unknown_period_end` guard | It decides whether a real person loses access over missing data. |
| **5** | **D-14 — RULED. Waive below the provider's minimum.** Where a prorated upgrade charge falls below the payment provider's permitted minimum transaction amount, **waive the charge, grant the upgrade, and write an auditable record** carrying the calculated amount and the reason for the waiver. **₦100 is not hard-coded** — the threshold reads the provider's documented minimum, and becomes a fixed figure only if Paystack's documentation establishes one or a later commercial rule sets one. Open only on the *value*: D-13 research found **no documented hard minimum**, only a ₦50 *recommendation* for a first recurring charge (U-3). | the upgrade path in `0033` | The rule is settled; the number is not. Storing it as configuration rather than a literal is what keeps it correct when the provider changes it. |
| **6** | **D-5 and D-6 — the Level 2 boundary, and whether 1/1/3 businesses, 2/3/10 users, 20/∞/∞ recipes is the packaging you intend to sell.** | the R7 enforcement migration | Nothing in the repository defines what `level = 2` unlocks. It is the difference between the two paid products. |
| **7** | **D-17 — RULED: customer-present checkout.** No reusable payment credential is stored; `BILLING_INTEGRATION_DESIGN.md` §7 stands unamended. The same checkout serves failed-payment recovery, which P-3 makes necessary anyway — one flow, two uses. Design: `D1_SCHEDULER_DESIGN.md` §7. Previously open as: Renewals, boundary plan changes and failed-payment recovery **all need no stored credential** — only the one-off prorated upgrade charge does. Owner ruling: the security boundary is not relaxed for payment convenience; if `authorization_code` retention is ever wanted, first establish exactly what Paystack permits and recommends storing, then propose the safest architecture. Proposed (not decided): the prorated charge is a **customer-present checkout**, which stores nothing and reuses the recovery flow P-3 makes necessary anyway. §10's prorated charge needs `charge_authorization`, which needs `authorization_code` — the credential `BILLING_INTEGRATION_DESIGN.md` §7 calls *"the single most important line in this document"* and `lib.ts` strips before storage. Options: **(a)** prorated upgrades go through a fresh checkout with the customer present, credential never stored; **(b)** store it in a separate service-role-only table; **(c)** keep redaction absolute and abandon server-initiated proration. | the upgrade path in `0033` | Both current positions are correct and they cannot both stand. (a) also composes with the standing rule against changing a billing amount without authorisation. |
| **8** | **D-9 — email provider and the R8 notification set.** | the R8 notification migration | No transactional email exists beyond Supabase Auth's own. `invoice.create` arrives **3 days before** each payment, which supplies the pre-charge trigger R8 needs without a scheduler. |

### Blocks launch, not the migrations

| | Decision | Note |
|---|---|---|
| **D-7** | VAT treatment, confirmed by a Nigerian tax adviser | §7.2 is NULL-safe, so the schema can be built without it — but no charge may be taken until it is answered, and it must not be guessed. |
| **D-2** | Six standard prices — 2 plans × 3 intervals | Deliberately open. A standard row is an INSERT, so no migration changes later. It blocks **customer 101**, any lapsed founder's renewal, and §10's `no_price_for_interval` guard for standard-tier upgrades. |
| **D-8** | Twelve Paystack plan codes | Seed-time, behind D-13. |

### Safely deferrable

| | Item | Why it can wait |
|---|---|---|
| **D-15** | A **combined** plan-and-interval change in one action. Proposed decomposition: prorate the plan upgrade within the *current* interval, apply the interval change at the boundary. | The combined operation can simply be refused at launch — the customer does one, then the other, and both paths are already specified. |
| **D-16** | Refusing an upgrade while `past_due` | §10.4 proposes refusing. Reasonable default; reversible. |
| **D-11** | Whether annual ever deserves a longer grace | Ruled uniform. Revisit only if payment data shows a reason. |
| — | What happens at trial recipe 21 | Product copy, not schema. `limit_value = 20` is already stored. |
| — | The `monthly_equivalent` reporting view | Reporting convenience; no other component depends on it. |

**D-13 is closed and D-1 is designed.** What now blocks implementation is a
short list of approvals rather than unknowns: the D-1 recommendation itself, then
D-4, D-3, D-5/D-6 and D-9. Two verification items (`pg_cron` availability,
Paystack idempotency keys) and two new decisions (D-18 customer-absent plan
switch, D-19 cadence) are recorded in `D1_SCHEDULER_DESIGN.md` §7.

**P-3 changes the shape of the work.** Paystack does not retry failed
subscription charges, so the 7-day grace is our recovery window and R8's
notification *is* the dunning system rather than a courtesy alongside it. That
raises D-9's priority: with no provider retry and no email, a failed card lapses
an account in silence.
