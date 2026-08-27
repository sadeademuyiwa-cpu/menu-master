# FOUNDING 100 — PROPOSED BEHAVIOUR, FOR APPROVAL

**Status: BEHAVIOUR APPROVED by the owner, 27 Aug 2026. Option A ruled for the
final-slot checkout race. STILL NOT IMPLEMENTED — implementation of `0031`-`0033`
is held until the remaining commercial inputs in section 5 are settled.**

Supersedes the single `revoked_at` in the first draft. The owner's distinction
between permanent status and conditional entitlement is the correct model and is
adopted throughout.

---

## 1. Two concepts, deliberately separate

| | **Founding-member status** | **Founding-price entitlement** |
|---|---|---|
| Nature | permanent historical fact | conditional commercial right |
| Granted | at first successful payment | with the slot |
| Lost | **never** | on lapse |
| Reassigned | **never** — slot 47 belongs to that account for all time | n/a |
| Deleted | **never** | never deleted, only stamped revoked |
| Stored | `slot_number`, `granted_at` | `price_entitlement_revoked_at`, `revoke_reason`, `lapsed_at` |

A customer who cancels and returns is **still Founding Member #47**. They simply
pay the standard price. Their record is never removed, and the revocation is
stamped with when and why.

```
founding_members
  account_id                    primary key   -- one per account, forever
  slot_number                   int unique, check between 1 and 100
  granted_at                    timestamptz
  granted_plan_id, granted_price, currency    -- what was actually granted
  price_entitlement_revoked_at  timestamptz   -- NULL while entitled
  revoke_reason                 text
  lapsed_at                     timestamptz   -- when the gap actually began
```

Slots are **permanent and never reused**: allocation is `max(slot_number) + 1`,
so a revoked slot leaves a permanent hole in the sequence rather than returning
to the pool. The pool only shrinks. That is what makes "the first 100 in the
history of Menu Master NG" true rather than approximately true.

---

## 2. The nine cases

### Customer 1
Signs up → `trialing`, **no slot** (the cap counts *paying* businesses).
First `charge.success` → claims **slot 1**. Record written: `granted_plan_id`,
`granted_price` ₦3,500, `granted_at`. Subscription `active`. Founding price
applies.

### Customer 100
Identical, claims **slot 100**. The pool is now exhausted permanently.

### Attempted customer 101
`fn_claim_founding_slot` finds no slot: `max(slot_number) = 100`, and the check
constraint refuses 101 regardless. **No founding record is created.**

They are subscribed at the **standard** price.

⚠️ **And today there is no standard price**, so their payment resolves no price
row and lands in `failed_permanent` with reason `no_standard_price`, visible in
`v_billing_reconciliation`. That is deliberate: the alternatives are charging a
guessed amount or silently granting a 101st founding entitlement, and both are
worse than a loud stop. It blocks that customer until a standard price exists.

### Cancellation
`subscription.not_renew` → status `cancelled`, `current_period_end` **preserved**.

- Founding **status**: unchanged, permanent.
- Founding **price entitlement**: **retained until the period actually ends**.
  They paid for that period and keep what they paid for.
- Nothing is deleted. Nothing is stamped yet — no lapse has occurred.

### Resubscription after cancellation
On the transition back into an entitled state, the system asks: *was this account
entitled immediately before this event?*

- **No** → a lapse occurred. `price_entitlement_revoked_at` is stamped,
  `revoke_reason = 'lapsed_and_resubscribed'`, `lapsed_at` records when the gap
  began. They keep **Founding Member #47** and pay the **standard** price.
- **Yes** → no lapse (see cancellation-then-changed-mind below). Nothing changes.

Revocation is **one-way**. A second cancellation does not re-stamp; the first
revocation stands.

### Upgrade, Costing → Costing + Sales
Slot unchanged. Entitlement unchanged. Price becomes the **founding price of the
new plan, ₦7,500**. Founding is a *tier*, not a frozen amount: a founding member
pays the founding price of whatever plan they are on. Recorded in
`subscription_changes` with `price_tier_applied = 'founding'` and
`amount_applied = 7500`.

### Downgrade, Costing + Sales → Costing
Symmetric. Price becomes **₦3,500**. No slot is minted, released or altered —
`account_id` is the primary key, so a second entitlement is structurally
impossible however many times they switch.

### Failed payment / grace period
`invoice.payment_failed` → `past_due`.

- `past_due` **is entitled** — `0028` already treats dunning as a grace period,
  and a failed card must not cost someone their founding price the same
  afternoon.
- Recovery (`charge.success` → `active`): no lapse, **no revocation**.
- No recovery, and `current_period_end` passes: that is the lapse. Entitlement
  ends by date; the stamp is applied when we next act on the account, or by
  `fn_revoke_lapsed_founding_prices()` run on demand.

### Simultaneous attempts to claim slot 100
Two payments arrive at the same instant with 99 slots taken.

1. **`pg_advisory_xact_lock`** on a fixed key serialises the two allocations, so
   they cannot both read `max = 99`.
2. The first commits slot 100. The second, now seeing `max = 100`, is refused.
3. **`unique (slot_number)`** and `check (between 1 and 100)` are the backstop —
   they hold even if a future caller bypasses the function entirely.

The loser is **not** a founding member and takes the standard-price path above.
Neither a duplicate slot nor a 101st entitlement is reachable.

---

## 3. The final-slot checkout race — RULED: Option A

The cap is enforced **at grant time**, when the payment confirms. But the
customer chose a plan *earlier*, at checkout — and a Paystack plan encodes its
amount, so by then they have been quoted either the founding or the standard
price. If the last slot fills between quote and payment, a customer pays ₦3,500
and is not entitled to it.

**Owner ruling, 27 Aug 2026 — Option A, with these conditions binding:**

| # | Condition |
|---|---|
| 1 | **Honour the amount already paid** for that billing period. |
| 2 | **Give normal access** to the plan they paid for. No degraded service. |
| 3 | **Do NOT create Founding Member #101.** No row in `founding_members`. |
| 4 | **Do NOT grant permanent founding-price entitlement.** |
| 5 | **Record the price-grant anomaly** for audit and reconciliation. |
| 6 | **The next renewal uses the applicable standard price.** |
| 7 | **The case must be identifiable** so the customer can be told the standard renewal price *before* the next charge. |
| 8 | **Never silently change the next billing amount** without the notification/authorisation the billing flow requires. |

Conditions 3 and 4 are structural — no `founding_members` row means no slot and
no entitlement, and the cap holds without a special case. Conditions 5 and 7 are
why the anomaly needs its own durable, queryable record rather than a log line:

```
price_grant_anomalies
  id, account_id, subscription_id
  occurred_at
  quoted_price_tier      -- 'founding'
  quoted_amount          -- what they were charged
  applied_price_tier     -- 'standard'
  next_renewal_amount    -- NULL until the standard price exists
  customer_notified_at   -- NULL until condition 7 is satisfied
  resolved_at, resolution_note
```

`next_renewal_amount` and `customer_notified_at` start NULL and stay NULL until
they are true. Condition 8 means the renewal **must not** proceed on the old
amount silently *or* on the new amount silently: an unnotified anomaly is an open
item in `v_billing_reconciliation`, not something the system quietly resolves.

Condition 6 also has a dependency the schema cannot supply: **there is no
standard price yet**, so `next_renewal_amount` cannot be populated and no
notification can be sent. Section 5 records that and the rest of the open inputs.

Option C was rejected on the owner's permanence ruling — a reserved slot that
never pays would burn a founding number forever. Option B was rejected because it
refuses money already legitimately paid.

## 4. What is auditable afterwards

- **Who is Founding Member #N**, permanently, and when they were granted.
- **What price was actually granted**, per grant and per change.
- **Whether the price entitlement is live**, and if not, when and why it was
  revoked and when the gap began.
- **Every status and plan change** with the amount applied, in
  `subscription_changes`.
- **Every anomaly** — cap races, unpriced customers — in
  `v_billing_reconciliation`.

Nothing is deleted at any point.

---

## 5. Commercial inputs still outstanding before `0031`-`0033`

Settled by the owner, 27 Aug 2026:

- Founding Costing **₦3,500/month**; Founding Costing + Sales **₦7,500/month**;
  Free Trial **₦0**, 14 days.
- Slots permanent, capped at exactly 100, never reused.
- Status and price entitlement remain structurally separate.

Still required, and each one blocks part of the price model:

| # | Open input | Blocks |
|---|---|---|
| 1 | **Standard post-Founding-100 price**, per plan | `plan_prices` standard rows; customer 101; anomaly condition 6 |
| 2 | **VAT treatment of the subscription itself** — is ₦3,500 inclusive or exclusive of 7.5% VAT? D5 ruled on *menu item* tax, not on our own invoice | what `plan_prices.monthly_price` means, and the Paystack plan amount |
| 3 | **Mid-period plan change money handling** — charge the difference now, or apply the new amount at next renewal; and does a downgrade drop features immediately or at period end | `subscription_changes.amount_applied` semantics in `0033` |
| 4 | **Dunning outer bound** — days in `past_due` before `cancelled`. `SUBSCRIPTION_STATE_MACHINE.md` §1 already flags this as a commercial decision left open | `fn_revoke_lapsed_founding_prices()` — it is the exact moment entitlement lapses |
| 5 | **Refund / chargeback against a permanent slot** — a first payment that succeeds and is later reversed currently mints an irreversible founding slot | whether permanence carries a single named exception |
| 6 | **Paystack plan codes**, per plan per tier (4 codes: costing/trading × founding/standard) | `plan_prices.provider_plan_code`; `0031` cannot be seeded without them |

Not blocking these three migrations, but unresolved and due before 1 September:

- **`plan_features` limits are enforced nowhere.** `costing` = 1 business /
  3 users, `trading` = 3 businesses / 10 users, `trial` = 1 / 2 / 20 recipes are
  stored, readable, and read by no code path — the same defect class as C4.
  Needs both a commercial confirmation of the packaging and an enforcement
  migration.
- **No transactional email exists.** Anomaly condition 7, renewal receipts,
  dunning notices and trial-ending warnings all need one.
- **How the renewal amount actually changes at Paystack** — plan codes encode the
  amount, so moving a customer from founding to standard is a cancel-and-
  re-authorise, not an amount edit.
- **Commission on gross vs net** — `PRICING_ECONOMICS_DESIGN.md` assumes gross
  (Option A) and the alternative was never ruled on. Costing engine, not billing.
