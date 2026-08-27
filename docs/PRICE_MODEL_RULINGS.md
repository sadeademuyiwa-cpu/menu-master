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

R9 matches the schema exactly: `subscriptions.account_id`, `businesses.account_id`,
`ux_subscriptions_account` unique per account. Nothing to change.

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
