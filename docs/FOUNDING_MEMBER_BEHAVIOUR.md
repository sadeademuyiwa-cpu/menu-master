# FOUNDING 100 — PROPOSED BEHAVIOUR, FOR APPROVAL

**Status: DESIGN ONLY. Nothing implemented. Approve the behaviour below before
any migration is written.**

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

## 3. One consequence that needs a decision at checkout

The cap is enforced **at grant time**, when the payment confirms. But the
customer chose a plan *earlier*, at checkout — and a Paystack plan encodes its
amount, so by then they have been quoted either the founding or the standard
price.

If the last slot fills between quote and payment, a customer **pays ₦3,500 and
is not entitled to it**. Three ways to handle that, and it needs your ruling:

| | Handling |
|---|---|
| **A** | Honour the amount for the period they paid, mark it `price_grant_anomaly`, queue for a human. No 101st founding entitlement; no denial of paid service. |
| **B** | Refuse and reconcile: `failed_permanent`, refund manually. |
| **C** | Reserve the slot at checkout with an expiry. Closes the race, but a reservation that never pays wastes a permanent slot — which Option A slots cannot afford. |

**Recommendation: A.** The window is small, the amount is bounded, and it is the
only option that neither breaks the cap nor takes money for nothing. C is
disqualified by permanence: an abandoned checkout would burn a founding number
forever.

---

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
