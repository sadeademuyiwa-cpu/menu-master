# FOUNDING 100 — DESIGN REVIEW

**Status: REVIEW ONLY. No migration written, no production data touched.**

Reviewed against the live schema, not from memory. Everything already verified
in the billing and webhook work is preserved: `0027`–`0030`, the Edge Function,
and all thirteen test suites stand unchanged.

---

## 1. Verdict against the nine requirements

| | Requirement | Current schema | |
|---|---|---|---|
| 1 | Global first-100 cap across both paid plans | nothing exists | ❌ |
| 2 | ₦3,500 Costing founding price | `plans.monthly_price` holds **one** price; all three plans are **₦0.00** | ❌ |
| 3 | ₦7,500 Costing + Sales founding price | same | ❌ |
| 4 | Preserve founding while continuously subscribed | **no history exists** — `subscriptions.status` is overwritten in place | ❌ |
| 5 | Lose entitlement after cancel then resubscribe | same root cause: a lapse leaves no trace | ❌ |
| 6 | Upgrade/downgrade without creating a 101st entitlement | solvable, by keying the entitlement on the **account** | ⚠️ |
| 7 | Concurrency between customers 100 and 101 | nothing | ❌ |
| 8 | Auditable price actually granted | `subscriptions` has **no amount column** | ❌ |
| 9 | Paystack code not the source of truth | `0030` is correct — but its **placement** is now wrong | ⚠️ |

**Three migrations are required.** None of them alters anything already verified.

### The sharpest finding: #4 and #5 are currently unanswerable

`subscriptions` holds one row per account, and every status change overwrites
it. There is no record that an account was ever `cancelled`, or when. So
"continuously active since the grant" cannot be computed from the data that
exists — not with better queries, not with application logic. **It has to be
recorded as it happens or it is gone.**

### The finding that changes `0030`'s placement: #9

A Paystack plan **encodes an amount**. Founding Costing at ₦3,500 and standard
Costing at some later price are two different amounts, so they are two different
Paystack plans with two different `PLN_` codes — for the *same* `plans.id`.

`0030` put `provider_plan_code` on `plans`, one column, one code per plan. It
cannot hold both. **The code belongs on the price row, not the plan row.**

`0030`'s resolver logic is right and survives: our `plans.id` stays the source of
truth and the external code stays a lookup key. Only the table it looks in moves.

---

## 2. Proposed data model

```
plans                          (unchanged; monthly_price retained, deprecated)
  id · name · currency · is_active · is_self_serve_trial
    │
    └── plan_prices                                        ◀ NEW
          plan_id · price_tier · monthly_price · currency
          provider_plan_code · is_active · effective_from
          unique (plan_id, price_tier) where is_active
          unique (provider_plan_code) where not null

founding_members                                           ◀ NEW
  account_id      primary key      -- ONE per account: requirement 6, structurally
  slot_number     int unique       -- check between 1 and 100: the cap IS a constraint
  granted_at · granted_plan_id · granted_price · currency
  revoked_at · revoke_reason

subscription_changes                                       ◀ NEW, append-only
  account_id · changed_at · from_status · to_status
  from_plan_id · to_plan_id · price_tier_applied · amount_applied
  provider_ref · changed_by
```

### Why each table earns its place

**`plan_prices`** holds two price points per plan without inventing the second
one. The founding rows exist now; the standard rows simply **do not exist yet** —
which is the "do not invent the standard price" instruction expressed as
structure rather than as a note. It is also where the Paystack code belongs.

**`founding_members`** makes the cap a **database constraint, not application
logic**: `slot_number` unique, with `check (slot_number between 1 and 100)`.
Customer 101 gets a constraint violation, not a race. This is the same principle
as Gate 1's composite foreign keys — make the wrong thing impossible rather than
merely checked. Keying on `account_id` means an upgrade or downgrade cannot mint
a second entitlement, because there is only ever one row per account.

**`subscription_changes`** is what makes requirements 4 and 5 answerable at all.
It follows the pattern this codebase already uses twice —
`costing_method_changes` and `serving_format_changes`.

### Concurrency, requirement 7 — two independent layers

1. `pg_advisory_xact_lock` on a fixed key around slot allocation, so concurrent
   grants serialise rather than both reading `max(slot_number) = 99`.
2. `unique (slot_number)` plus the range check as the **backstop**, which holds
   even if a future caller bypasses the allocation function entirely.

The lock gives correctness under contention. The constraint gives correctness
unconditionally. Neither alone is enough: a lock can be forgotten, and a
constraint alone turns a race into a failed insert for a customer who paid.

---

## 3. Billing rules

| Event | Rule |
|---|---|
| Trial signup | **No slot.** The cap counts *paying* businesses. |
| First successful payment | Claim the next slot, if any remain. Record `granted_plan_id`, `granted_price`, `slot_number`. |
| Upgrade Costing → Costing + Sales | Slot unchanged. Price becomes the **founding** price of the new plan, ₦7,500. |
| Downgrade | Slot unchanged. Price becomes ₦3,500. |
| Renewal | No change. |
| `past_due` | **Founding status retained.** A failed card is dunning, not a lapse — consistent with `0028`, which keeps `past_due` entitled. |
| `cancelled`, period not yet ended | **Retained.** They paid for that period. |
| `cancelled`, period ended | The lapse point. Entitlement ends. |
| Resubscribe after a lapse | Founding status **not** restored; they pay the then-current standard price. |

Founding is a **price tier, not a frozen amount**: a founding member pays the
founding price *of whatever plan they are on*. That reading follows directly from
your two figures being per-plan. If you meant the amount to freeze at whatever
they first paid, say so — it changes `founding_members` from storing a tier to
storing an amount, and changes what an upgrade costs.

---

## 4. Edge cases, and how the model handles them

| | Case | Handling |
|---|---|---|
| 1 | Two customers race for slot 100 | Advisory lock serialises; unique constraint is the backstop. One gets 100, the other gets standard pricing. |
| 2 | A founding member upgrades then downgrades repeatedly | One row per account. No new slot is ever minted. |
| 3 | A founding member's card fails, then recovers | `past_due` is entitled, so continuity is unbroken. |
| 4 | A founding member cancels on day 3 of a paid month | Retained until `current_period_end`. |
| 5 | They resubscribe two months later | `subscription_changes` shows the lapse. Slot revoked. |
| 6 | An account is deleted | `founding_members` cascades. **See the open decision below.** |
| 7 | Slot 100 is taken and customer 101 pays | They need the **standard price, which does not exist yet.** See §5. |
| 8 | Paystack sends a founding code after the cap fills | Resolves to the founding price row; the *cap* is enforced at grant time, not at code lookup. |
| 9 | The same account pays twice concurrently | `founding_members` PK on `account_id` refuses the second grant. |

---

## 5. ⚠️ A launch risk this design exposes but cannot solve

**Customer 101 cannot be priced.** The founding cap is 100; the standard price is
deliberately undecided. If you sign a 101st paying business before deciding it,
there is no price row for them to buy — and inventing one is exactly what you
told me not to do.

The model degrades honestly rather than silently: with no standard row, a 101st
payment resolves no price and lands in `failed_permanent` with a named reason,
visible in `v_billing_reconciliation`. It will not quietly charge the wrong
amount. But it *will* block that customer until you set a standard price.

That is a commercial decision with a deadline attached, not a schema problem.

---

## 6. Migrations required — three, none disturbing verified work

| | Contents |
|---|---|
| `0031` | `plan_prices`; migrate `provider_plan_code` from `plans` to `plan_prices`; repoint `fn_billing_apply`'s lookup. `plans.monthly_price` retained and deprecated. |
| `0032` | `founding_members`; `fn_claim_founding_slot()` with the advisory lock; the cap constraint. |
| `0033` | `subscription_changes`; `fn_set_subscription_plan` writes a row on every change; the lapse-detection and revocation rule. |

`0027`–`0030`, the Edge Function, and suites `011`–`020` are untouched by all
three. The resolver `0030` installed keeps working; only the table it reads moves.
