# D-13 — PAYSTACK RECURRING BILLING: RESEARCH FINDINGS

**Status: RESEARCH COMPLETE TO THE LIMIT OF THIS ENVIRONMENT. D-13 REMAINS OPEN.**
Read-only research. No Paystack plans created, no production contact, no
migrations, no billing code.

## 0. Source limitation — read this before using anything below

**The primary source could not be reached.** Every Paystack host is blocked by
this environment's egress proxy:

```
paystack.com            EGRESS_BLOCKED
support.paystack.com    EGRESS_BLOCKED
docs-v2.paystack.com    EGRESS_BLOCKED
docs-v1.paystack.com    DNS: ENOTFOUND
curl https://paystack.com/docs/api/plan/  ->  CONNECT tunnel failed, response 403
```

So the findings below come from **web search results that index those pages**,
not from the pages themselves. That is second-hand: better than memory, weaker
than the document. I have not quoted anything verbatim, because I could not read
anything verbatim.

Every row carries a confidence marker:

- **[A]** consistent across multiple independent search results, and consistent
  with the behaviour already observed in our deployed webhook
- **[B]** reported once, plausible, unverified
- **[!]** **sources actively disagree** — must be settled at the primary source
- **[?]** not established

**No plan code should be created, and no migration written, on [B], [!] or [?].**

Two ways to close D-13 properly:
1. allow `paystack.com` through the egress proxy for this session, and I will
   re-run this against the documents themselves; or
2. paste the relevant pages (Plan API, Subscription API, Subscriptions guide,
   Recurring Charges, Webhooks) and I will work from those.

---

## 1. Findings against the thirteen questions

| # | Question | Finding | Conf |
|---|---|---|---|
| 1 | Monthly recurring supported? | **Yes.** `monthly` is a documented plan interval. | **[A]** |
| 2 | Quarterly / 3-month supported? | **Yes.** `quarterly` is a documented plan interval — natively, not simulated. | **[A]** |
| 3 | Annual / 12-month supported? | **Yes**, but the token is **`annually`**, not `annual`. | **[A]** |
| 4 | Exact interval tokens | `hourly`, `daily`, `weekly`, `monthly`, `quarterly`, `biannually`, `annually` | **[A]** |
| 5 | One plan code = one fixed amount + interval? | **Yes.** A Plan carries `amount`, `interval`, `currency`. Update Plan can change them, with `update_existing_subscriptions` controlling whether existing subscribers move — and when true, changes apply **on the next billing cycle**. So one code expresses one amount-and-interval at a time. | **[A]** |
| 6 | Do we therefore need 12 plan codes? | **Yes.** 2 products × 2 tiers × 3 intervals, each a distinct amount-and-interval pair, and a plan code cannot express more than one. | **[A]**, follows from 5 |
| 7 | Moving a subscriber between plans | **No endpoint for this appears in the documentation.** Update Plan changes *a plan*; it does not move a *subscriber* from one plan to another. The available mechanism is therefore disable the subscription and create a new one on the target plan. | **[B]** — a negative finding, and negatives are exactly what a search index reports worst |
| 8 | Can a plan change take effect at the next boundary without cancel/re-authorise? | **Split.** Changing the *price or interval of a plan the customer is already on* does apply at the next cycle (`update_existing_subscriptions=true`). Moving a customer to a *different* plan appears to need disable + create. `/subscription/disable` needs `code` + `email_token`; it emits `subscription.not_renew` immediately and `subscription.disable` on the next payment date — so stopping cleanly **at** the boundary is supported. Whether a new subscription can then be created from a stored reusable authorisation with no customer action is **not established**. | **[B]** / **[?]** |
| 9 | One-off charge against an existing authorisation | **Supported.** `charge_authorization` takes `authorization_code`, `email`, `amount`. Works only where the authorisation is `reusable: true`. Check `data.paused` for a 2FA challenge and redirect to `data.authorization_url` if so. Save `data.reference`. | **[A]** |
| 10 | Minimum transaction amount, NGN | **No hard minimum is documented.** What exists is a *recommendation* in the Recurring Charges docs: **NGN 50.00** for a first recurring charge, with the caveat that lower amounts are not guaranteed to work across all card brands and banks. Separately, fees — not minimums — change at NGN 2,500. | **[B]** |
| 11 | What happens when a recurring charge fails | **SOURCES DISAGREE.** One says Paystack retries automatically over following days and may end with `subscription.disable`. Another says **"If a subscription charge fails, Paystack does not retry it."** Both are attributed to Paystack's own docs. Agreed on either reading: the subscription moves to status `attention`, and `most_recent_invoice.status = failed` with a `description`. | **[!]** |
| 12 | Relevant webhooks | `charge.success` · `invoice.create` (**3 days before** the next payment date) · `invoice.update` (after the attempt) · `invoice.payment_failed` · `subscription.create` · `subscription.disable` (on the next payment date, after cancellation) · `subscription.not_renew` · plus `charge.dispute.create` / `.remind` (every 4h while unresolved) / `.resolve`, and refund events. Signature: **HMAC SHA512** of the payload with the secret key, in `x-paystack-signature`. | **[A]** |
| 13 | Reliable next-payment date to store? | **Yes.** `next_payment_date`, ISO 8601 (e.g. `2016-10-15T00:00:00.000Z`), available from Fetch Subscription and reconcilable. | **[A]** |

### Paystack's own subscription statuses

Six, against our four: **Active**, **Active (Renewing)**, **Active
(Non-renewing)**, **Completed**, **Cancelled**, **Attention**. **[A]**

`Completed` is new information for us: a subscription completes when the
subscriber has made the maximum number of payments set by the plan's
`invoice_limit`. We do not set `invoice_limit`, so we should not see it — but
`SUBSCRIPTION_STATE_MACHINE.md` §3.5 refuses unknown statuses loudly, which is
the correct behaviour if we ever do.

---

## 2. What this confirms in `PRICE_MODEL_RULINGS.md`

| | Confirmed |
|---|---|
| §7.1 `provider_interval` | **Vindicated, and not optional.** Our `annual` is Paystack's `annually`. Had we assumed our own token was theirs, every annual plan lookup would have failed. `monthly` and `quarterly` happen to match; `annual` does not. |
| §7.1 native cycles | All three cycles are native. **§7 does not change shape** — the structural risk that made D-13 the top blocker did not materialise. |
| §8.1 twelve plan codes | Confirmed, and `0030`'s single `plans.provider_plan_code` is confirmed structurally wrong. |
| C-3 "R2 and R3 are not free at Paystack" | Confirmed, and **understated**. There is no plan-switch endpoint at all; it is disable-and-recreate. |
| §10.3 "a one-off charge against the stored authorisation" | Confirmed as a real mechanism (`charge_authorization`), subject to `reusable: true`. |
| §8.2 storing `current_period_end` | Confirmed. `next_payment_date` is documented, dated and fetchable, so our period end is reconcilable rather than inferred. |
| Deployed webhook | HMAC SHA512 over the raw body via `x-paystack-signature` — exactly what `paystack-webhook` implements and what production testing exercised. |

## 3. What this contradicts

| | Contradicted |
|---|---|
| **D-14's proposed ₦100 floor** | **No ₦100 minimum is documented.** The only figure found is a **₦50 recommendation** for a first recurring charge. The owner's revised D-14 — do not hard-code ₦100, use the provider's permitted minimum — is the correct instruction, and this research is why. |
| **§8.4's picture of dunning** | Our 7-day grace was written as though Paystack retries during it. If the "does not retry" reading is right, the grace is a window in which **we** must drive recovery, not one in which Paystack does. That changes what R8's notifications are *for* and may require a recovery mechanism of our own. Unresolved — see **[!]** above. |

Nothing else in the document is contradicted.

## 4. What this changes in the architecture

1. **`billing_intervals.provider_interval` is mandatory**, seeded
   `monthly → monthly`, `quarterly → quarterly`, `annual → annually`.
2. **A new conflict, and it is a real one.** §10 needs `charge_authorization` for
   the prorated upgrade, which needs `authorization_code` — and
   `BILLING_INTEGRATION_DESIGN.md` §7 calls stripping that code *"the single most
   important line in this document"*, with `lib.ts` deleting it before storage.
   Both positions are right; they cannot both stand. Options, none implemented:
   - **(a)** Prorated upgrades go through a **fresh checkout** — the customer is
     present and authorises the one-off amount. No credential is ever stored. The
     redaction rule survives intact.
   - **(b)** Store `authorization_code` in a **separate, service-role-only** table
     — never in `billing_events.payload`, never in a view, never readable by
     `authenticated`. Enables server-initiated proration and our own dunning
     retries; weakens an absolute rule to a scoped one.
   - **(c)** Keep redaction absolute and accept that no server-initiated charge is
     ever possible — which means §10 proration cannot work as specified.

   **This is D-17 and it is a genuine decision, not a detail.** Note that (a)
   composes well with the "never silently change the billing amount without
   authorisation" condition already binding from the founding-race ruling.
3. **`invoice.create` arrives 3 days before the next payment date.** This is a
   **provider-driven pre-charge trigger**, and it lands exactly where R8 needs
   one — the anomaly customer who must be told the standard price *before* the
   next charge, and the lapsed founder whose renewal amount changes. It does not
   remove D-1 (a scheduler is still needed for lapse, revocation and boundary
   plan switches) but it takes the hardest notification case off the scheduler.
4. **`attention` must be mapped.** It is Paystack's failed-charge state and maps
   to our `past_due`. Our current mapping keys on `invoice.payment_failed`, which
   should be sufficient — but the mapping table should name `attention`
   explicitly rather than leave it to the unknown-status refusal path.

## 5. What remains unknown

| | Unknown | Why it matters |
|---|---|---|
| **U-1** | **Does Paystack retry a failed subscription charge?** Sources directly conflict. | Decides whether our 7-day grace is a waiting period or a working one, and whether we need our own retry. |
| **U-2** | Can a subscription be **created from a stored reusable authorisation** with no customer action? | Decides whether an upgrade/downgrade at the boundary is silent or requires the customer. Directly affects R11 and the founding-price lapse path. |
| **U-3** | Is there a **hard** minimum transaction amount in NGN, as opposed to the ₦50 recommendation? | D-14. Our worst-case prorated charge (₦131.50) clears ₦50 comfortably, but the rule must key on a documented figure. |
| **U-4** | Does `quarterly` mean exactly 3 calendar months, and `annually` 12? | `billing_intervals.months` must match the provider's own arithmetic or our `current_period_end` will drift from theirs. |
| **U-5** | Exact refund event names and payload shape. | R5's reversal exception keys on them. |
| **U-6** | Whether an existing plan's `interval` can be changed, and what happens to subscribers if so. | Operational safety — it would be a way to break every subscriber at once. |

U-1, U-2 and U-4 are the ones that would change design. U-3 and U-5 change
values. U-6 is an operational guard-rail.

---

## 6. Verdict

**D-13's structural question is answered favourably: all three cycles are native,
so §7 stands.** That was the risk that put D-13 at the top of the queue, and it
has cleared.

**D-13 itself stays OPEN**, because none of this is primary-source verified, U-1
and U-2 would change design, and the exact tokens must be read rather than
inferred before twelve plan codes are created. It is no longer a *blocker on the
shape of `0031`*; it is a blocker on **seeding** it.
