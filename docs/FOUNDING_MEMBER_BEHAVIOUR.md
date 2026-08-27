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

## 5. Commercial inputs — superseded

The owner ruled on VAT, proration, downgrades, dunning, reversals, plan records,
feature enforcement, notifications and the subscription unit on 27 Aug 2026.
Those rulings, the contradictions they expose in the existing schema and state
machine, the intended feature entitlements, and the minimum decisions still
required now live in **`docs/PRICE_MODEL_RULINGS.md`**, which is authoritative on
all commercial questions.

Two of those rulings touch this document directly:

- **R4 (7-day grace)** supplies the number the lapse rule was missing. Recovery
  at any point up to `current_period_end + 7 days` stamps nothing. Past it, the
  entitlement is revoked exactly once and the founding **status** is untouched.
- **R5 / D-4 (reversal exception)** is **APPROVED**, 7-day window held as
  configuration. It changes the storage model in §1 of this document: one row per
  account cannot record that #47 was held twice, so `founding_members` becomes an
  **append-only allocation ledger** with current membership derived from it.
  **Capacity is reclaimable; identity is not.** See `PRICE_MODEL_RULINGS.md` §5
  for the model, the four automatic-void conditions, and the manual path for a
  reversal arriving outside the window.

  The nine behaviours above are otherwise unchanged. A **voided** allocation
  (the payment never stood) releases capacity; a **revoked** entitlement (a real
  payment that later lapsed) never does, and permanently blocks a second
  allocation for that account.

`0031`-`0033` remain held.
