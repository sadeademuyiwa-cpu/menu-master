# D-21 — WHEN A RECURRING CHARGE MUST INCREASE

**RULED 27 Aug 2026 — Option C with refinements. DESIGN ONLY.**
No migration, no Paystack change, no scheduled job, no notification, nothing
deployed.

> **No authorisation → no increased charge.**
> **No authorisation by the deadline → the renewal is stopped at the paid-through
> boundary.**

And the principle that generalises beyond this case, recorded because it will be
needed again:

> **The provider's recurring configuration is a mechanism, never an entitlement
> source.** A historical Paystack founding plan code does not confer founding
> pricing. Menu Master NG's entitlement state governs; Paystack executes.

---

## 1. This is not a payment failure, and must not be modelled as one

Nothing failed. We **deliberately prevented** a renewal because the next
commercially valid price required an authorisation we did not obtain.

| | |
|---|---|
| **Never** | enter `past_due`; fabricate an `invoice.payment_failed`; write a failed charge |
| **Instead** | the existing scheduled-cancellation path: `cancelled` with `current_period_end` **preserved**, then J2's ordinary finalisation |

**One consequence to be explicit about: there is no 7-day grace here.** Grace
exists to recover a failed card. No card failed and no debt exists, so there is
nothing to recover — the subscription simply ends at the date the customer
already paid through, and they may return at any time through D-20. Attaching
grace to this path would be modelling it as a payment failure by the back door.

Copy must follow the same discipline: **no dunning language, because there is no
debt.**

---

## 2. Structure — reconciled before adding anything

The instruction was not to create a second source of truth if an existing
structure can carry the lifecycle. Each candidate was tested and each fails for a
specific reason:

| Candidate | Why it cannot carry it |
|---|---|
| `subscriptions.scheduled_*` | Holds **one** pending change and is mutable. It cannot retain a decision, a deadline or a history, and the next scheduled change would overwrite the evidence. |
| `subscription_changes` | Append-only history of changes that **happened**. Using it for a pending decision would fill it with rows describing a future that may never occur. |
| `checkout_quotes` | Shaped around a **payment** — acceptance is a charge and the resolution is a provider reference. Here acceptance is a *decision*, and no money moves until the boundary. |
| `reconciliation_items` | An operator queue, not a customer-facing commercial lifecycle. |

So a dedicated table is justified — but it stores **only** the facts none of the
others owns, and delegates everything else:

```
price_authorisations
  id                    uuid primary key
  subscription_id, account_id
  from_plan_price_id    -> plan_prices   -- current authoritative price
  to_plan_price_id      -> plan_prices   -- required next price
  reason                text             -- 'founding_race_anomaly'
                                         -- | 'founding_entitlement_lapsed' | ...
  required_from         timestamptz not null   -- when authorisation became required
  boundary_at           timestamptz not null   -- the renewal boundary
  deadline_at           timestamptz not null   -- boundary_at - dispatch margin

  status                text  -- 'awaiting' | 'authorised' | 'declined'
                              -- | 'expired' | 'voided' | 'superseded'
  decided_at, decided_by, decision_source   -- 'app' | 'email_link' | 'whatsapp_link'
  resolution            text  -- 'renewed_at_new_price' | 'renewal_stopped' | 'voided'
  resolved_at

  unique (subscription_id) where status = 'awaiting'
```

**Deliberately not stored here, because something else already owns it:**

| Fact | Owner |
|---|---|
| amounts, currency, tier, interval, provider plan code | the two `plan_prices` foreign keys — append-only, so both prices are frozen by reference |
| notification obligations and their status | `notification_outbox`, keyed on this row's id as `subject_key` |
| the provider command at the boundary | `provider_operations`, `operation_key` derived from this row's id |
| the scheduled change itself | `subscriptions.scheduled_*`, written **only on authorisation** |
| what ultimately changed | `subscription_changes`, written at resolution |

### 2.1 Immutability of the evidence

`from_plan_price_id`, `to_plan_price_id`, `reason`, `required_from`,
`boundary_at`, `deadline_at`, `decided_at`, `decided_by` and `decision_source`
are **write-once**, enforced by a trigger refusing to update them once set. A
price change later cannot reach the offer, because the offer is a foreign key to
an immutable row — the same property that made `checkout_quotes` simple.

---

## 3. The customer authorises

1. Record the authorisation durably and immutably: what price, when, by whom,
   from where.
2. Write `subscriptions.scheduled_plan_price_id = to_plan_price_id` and
   `scheduled_effective_at = boundary_at`.
3. **Dispatch the provider operations immediately, not at the boundary** — D-1
   §1.1: disable the current subscription, create one on the standard plan code
   with `start_date = boundary_at` (P-6). No re-authorisation, no service gap, no
   stored credential.
4. Resolve: `status = 'authorised'`, and `subscription_changes` records it.

**No higher amount is charged before the boundary.** An immediate change would be
a different product decision and has **not** been approved, so the design refuses
it rather than offering it.

**Idempotency**, reusing what exists: `unique (subscription_id) where status =
'awaiting'` (L4) · the authorise call is effect-keyed `where status = 'awaiting'`
(L2) · the operation key derives from the row id, so a repeated dispatch is a
unique-violation rather than a second subscription (L4 + L5).

## 4. The customer does not authorise

At `deadline_at`, an hourly job selects `status = 'awaiting' and deadline_at <=
now()` — due-or-overdue, so a missed run self-recovers — and:

1. `status = 'expired'`, `resolution = 'renewal_stopped'`;
2. dispatches the provider disable **before** the renewal fires;
3. sets `subscriptions.status = 'cancelled'` with `current_period_end`
   **untouched**.

Entitlement therefore runs to the paid-through date under the existing derived
rule, with no new state and no special case. At that date J2 finalises and the
approved post-lapse read rules apply: **historical data stays readable and
exportable; only new work stops.**

Never: charge the higher price · renew indefinitely at the obsolete price ·
delete data · silently create another subscription · treat silence as consent.

### 4.1 `deadline_at` needs a dispatch margin, and `invoice.create` is the safety net

The disable must reach Paystack **before** it charges. So `deadline_at` sits a
margin short of `boundary_at` — proposed **2 days** — giving the drainer its
retry budget and reconciliation one pass.

Better: **`invoice.create` arrives 3 days before the payment date.** If one
arrives for a subscription whose `price_authorisations` row is still `awaiting`
or whose disable has not confirmed, **the stop has failed** — raise it
immediately. A provider event we already receive becomes a free cross-check on
our own machinery.

## 5. Notification — deterministic, interval-appropriate, not hard-coded

T−14/7/3 is **not** adopted as universal. A monthly subscriber cannot receive 45
days' notice and an annual subscriber deserves more than three. The schedule is
**data**, held per interval — proposed as `billing_intervals.authorisation_notice_days`:

| Interval | Notices before `deadline_at` |
|---|---|
| monthly | 10, 5, 2 |
| quarterly | 21, 10, 3 |
| annual | 45, 21, 7 |

**These figures are PROPOSALS, not approved commercial policy** — recorded as
**D-23**. What *is* ruled is that the schedule is stored as data, is
deterministic, and is appropriate to the billing interval rather than uniform.

Constrained so no offset exceeds the period length. J5 queues them on
due-or-overdue predicates; the final notice goes on **both** channels.

The final notice must state, plainly: the **current price**; the **new price**;
**when** it would take effect; that the customer **must actively approve**; the
**deadline**; that **without approval the subscription will not renew**; and that
**already-entered business data remains available** under the approved rules.

### 5.1 Delivery failure is not consent — and does not stop the stop

Two rules that look like they conflict and do not:

- **Silence is never consent.** Undelivered notices never authorise anything.
- **Undelivered notices do not prevent the renewal being stopped**, because the
  alternatives are charging more without authorisation or continuing an
  entitlement the customer does not have. **Stopping is the only outcome that
  does neither.**

So D-9's invariant holds unchanged — delivery status never appears in a billing
predicate. What delivery failure *does* create is a **human obligation**: zero
delivered notices across all channels at `deadline_at` raises a reconciliation
item so someone can reach the customer directly. The stop still happens; a person
is told it happened to someone who was never warned.

## 6. The two cases this closes

**Founding-race anomaly.** The payment and the period bought are preserved and
never retroactively altered. But the incorrect founding recurring price does not
continue: they must authorise the standard price for the next renewal, and if
they do not, §4 applies. The anomaly item closes when the authorisation resolves,
either way. **No consent is invented and no history is rewritten.**

**Lapsed founding member.** Identical treatment, under §0's principle: once
founding entitlement is legitimately lost, the historical Paystack plan code is
not an independent entitlement source.

**Re-subscription after either.** The ordinary D-20 flow; the server resolves the
currently applicable standard price. **Founding pricing is never automatically
restored** — which is already structural, since eligibility checks the revocation
stamp on a row that survives forever.

## 7. Missing standard price — WITHDRAWN as a designed path

This section previously described letting the renewal continue at the obsolete
founding price when no standard price existed.

**D-2 closed on 27 Aug 2026 and the sellable-price invariant
(`PRICE_MODEL_RULINGS.md` §12) makes that state unreachable by design** — a
missing required row now blocks deployment and blocks checkout.

So D-21 operates **deterministically**: a founder whose entitlement has ended is
quoted the exact applicable standard price for their plan and interval, and there
is no fallback branch. If a required row is ever missing in production it is an
**operational incident**, alerted as one; the customer's service is not stopped
for our configuration error, but nothing about that is a commercial design.

### 7.1 The increase is now material, which raises the stakes on §5

Under the ruled pricing a lapsed founder moves from **₦3,500 to ₦7,500** — the
charge **doubles**. On Costing + Sales it doubles again in absolute terms.

That is a deliberate commercial position, not a problem to solve. But it means
§4's stop-at-boundary path will be exercised more often than a modest step would
have produced, and the quality of §5's notices matters proportionately more. The
final notice is doing real work: it is the difference between a customer who
chooses to continue and one who discovers the change after their access ends.

## 8. Reconciliation summary

| Area | Effect |
|---|---|
| **D-9** | Notice types added to the enumeration; delivery status stays out of every billing predicate. Copy is explicitly non-dunning. |
| **D-17** | Unchanged. No credential is needed — the boundary move uses P-6 with `authorization` omitted. |
| **D-18** | This **is** D-18's enforcement mechanism for the one case it forbids doing unattended. |
| **D-20** | Re-subscription reuses checkout; `price_authorisations` is a sibling lifecycle, not a quote. |
| **Founding entitlement** | Unchanged. Allocations are never touched; only pricing moves. |
| **Cancellation / grace / recovery** | Reuses scheduled cancellation; **no grace**, because no payment failed (§1). |
| **Provider operations** | Dispatch-on-decision, deterministic keys, L5 before retry — all existing machinery. |
| **State machine** | **No new state.** The outcome is `cancelled` with `current_period_end` preserved. |
