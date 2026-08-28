# SEPTEMBER 1 LAUNCH GATES

> **CURRENT TARGET: 7 SEPTEMBER 2026.** The 1 September plan below is retained
> as the historical record and is not deleted. The date moved on the owner's
> ruling of 28 Aug 2026 after the Track C inventory showed the costing journey
> had no frontend. **Gate A (public product and trial launch) is 7 September.
> Gate B (paid billing) remains a separate activation gate.**


**RULED 27 Aug 2026 — Option C.** Two separate gates, deliberately decoupled:

> **Gate A — 1 September: safe, usable product launch.** Registration, onboarding
> and the production-ready product under the approved 14-day trial.
>
> **Gate B — paid billing activation.** A separate gate requiring VAT resolution,
> payment readiness and a verified billing chain. **No path on 1 September accepts
> money.**

**Migration verification is not compressed to meet a marketing date.** Every
migration is authored, replica-tested and production-verified one at a time, as
`0021`–`0030` were.

---

## 1. Can we issue founding invitations on 1 September?

**Yes — and it needs no reservation table, because of a property of Gate B
itself.**

The reservation exists to stop the public taking a number before an invited user
can claim it. **Under Option C, paid checkout is disabled on 1 September, so no
allocation is possible by anyone.** A founding number cannot be taken while
nobody can pay. The commitment is therefore safe without any mechanism holding
it.

So the campaign splits, and neither half weakens an invariant:

| | When | What |
|---|---|---|
| **Phase 1** | 1 September | **Founding position notice.** No reservation row, no window, no payment. "You were a pre-launch user; a founding position is held for you, and you will receive a 7-day window to claim it when checkout opens." |
| **Phase 2** | Gate B opens | **The invitation proper.** `founding_slot_reservations` row created with its absolute 7-day expiry; trial extended to the same instant; invitation sent. |

**No invariant is weakened.** "A quote never reserves a founding slot" is
untouched — no quote exists in Phase 1. `founding_slot_allocations` stays
payment-backed. Reservations still never count as members, still expire by
predicate.

**One honest consequence.** The single-timestamp rule — reservation, invitation
and trial extension sharing one absolute value — was designed for the case where
invitation and checkout coincide. With checkout deferred they decouple, so:

- **Phase 1** extends the classified accounts' trials to a **stated pre-launch
  access date**, which the notice names explicitly.
- **Phase 2** sets reservation expiry, invitation deadline and trial end to
  **one** absolute timestamp.

Each phase keeps the idempotency rule separately: an absolute literal, never
`now() + interval`. Forcing one timestamp across both phases would mean inventing
a checkout date we do not have.

---

## 2. Launch-gate matrix

| Item | Required before **Sep 1** | May follow Sep 1, before paid checkout | May follow after billing launch |
|---|:---:|:---:|:---:|
| **`0034`** entitlement + trial bound + D-3 constraint | **✅** | | |
| **D-3** classification query (owner-run) | **✅** | | |
| **`0033`** subscription state, `subscription_changes` | **✅** | | |
| **D-25** trial extension for classified accounts | **✅** *(Phase 1)* | | |
| **Trial-ending notification** (T−3 / T+0) | **✅** | | |
| **Email provider** + sender domain verification | **✅** | | |
| **Track C** — business setup, units, recipes, variants, costing screens | **✅** | | |
| **Founding position notice** (Phase 1) | **✅** | | |
| Paid checkout UI | **must be absent or disabled** | | |
| **D-7 VAT** | | **✅ blocks Gate B absolutely** | |
| **`0031`** pricing foundation | | ✅ | |
| **`0032`** founding allocations + reservations | | ✅ | |
| **`0035`** `subscription_charges` | | ✅ | |
| **`0036`** scheduler core, `pg_cron`, outboxes | | ✅ | |
| **`0037`** notification model | | ✅ | |
| **`0039`** upgrade proration | | ✅ | |
| **D-8** twelve Paystack plans | | ✅ | |
| **D-20** checkout quotes + flow | | ✅ | |
| **D-21** price authorisations | | ✅ | |
| **Founding invitation** (Phase 2) | | ✅ | |
| **U-3** provider minimum · **U-4** interval arithmetic · **U-5** refund events | | ✅ | |
| **V-3** re-enable semantics · **V-6** checkout link TTL | | ✅ | |
| **D-22** quote expiry · **D-23** notice offsets | | ✅ | |
| **WhatsApp** provider + Meta template approval (**V-4**) | | ✅ | |
| **`0038`** plan-limit enforcement (R7) | | ✅ *(see §3)* | |
| **V-5** delivery signals | | | ✅ |
| **V-2** Paystack idempotency confirmation | | | ✅ |
| **V-7** `recipe_prices` gating | | | ✅ |
| **D-15** combined plan+interval change · **D-16** upgrade while `past_due` | | | ✅ |
| Track C — trading screens | | | ✅ |
| `monthly_equivalent` view · trial recipe-21 copy | | | ✅ |

### 2.1 Why `0033` and `0034` are both Gate A

`0034` is what makes the trial real — without it, "14-day trial" is false
advertising on day one, since `trialing` is currently entitled forever (D-26 §0).
And `0034` needs `0033`'s `subscription_changes` so the D-25 extension is
auditable rather than silent (D-26 §6). They are a pair.

`0031` is **not** required: nothing in Gate A resolves a price, because nothing
in Gate A takes money.

### 2.2 The one uncomfortable row

**`0038` plan-limit enforcement.** On 1 September everyone is on a trial, so the
`trial` limits — 1 business, 2 users, 20 recipes — are the only ones that bite,
and **none of them is enforced.** A trial user can create five businesses and
twenty staff.

It is placed in the middle column rather than Gate A because nothing about it is
unsafe: no money is involved, no tenant isolation is affected, and the limits are
generous. But it should be understood as **a promise the product will not keep
for a few weeks**, not as a thing nobody noticed. If the trial's limits appear in
launch copy, this moves to Gate A.

## 3. What "no path accepts money" means concretely

Not merely a hidden button:

1. **No Paystack plans exist** — D-8 sits behind Gate B, so there is nothing to
   charge against.
2. **No `plan_prices` rows exist** — `0031` is behind Gate B, so the server
   cannot resolve an amount even if asked.
3. **`checkout_quotes` does not exist**, so no quote can be issued.
4. **The sellable-price invariant refuses** (`PRICE_MODEL_RULINGS.md` §12): with
   zero of the twelve combinations sellable, checkout refuses before Paystack
   initialisation.

Four independent reasons, any one sufficient. **A disabled button is not the
control** — the control is that the machinery to take money has not been built
yet, which is the honest position and the safe one.
