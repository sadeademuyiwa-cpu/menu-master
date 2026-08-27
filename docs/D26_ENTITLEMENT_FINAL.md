# D-26 — TRIAL EXPIRY, AND THE FINAL ENTITLEMENT DEFINITION

**RULED 27 Aug 2026 — Option A. DESIGN ONLY.** `fn_account_is_entitled` is not
modified, `0034` is not deployed, no account is updated, no reservation created,
no Paystack change, no notification sent.

This document reconciles **D-3** (missing boundary), **R4/D-11** (payment-failure
grace) and **D-26** (trial expiry) into **one** final definition, so `0034`
replaces the function **once**.

---

## 1. The ruling

The advertised 14-day trial gives exactly 14 days of write access. `trialing`
alone never grants indefinite access. After the boundary: writes stop, **reads
and exports continue permanently**, the customer may subscribe to resume, **no
automatic grace**, no dependency on any job, nothing deleted and nothing hidden.

**Trial expiry is not payment failure.** The 7-day grace exists because a card
failed and a recovery path exists. At the end of a trial nobody attempted
payment, nobody failed, and no debt exists. If a 21-day trial is ever wanted, the
trial duration changes explicitly — grace is not a disguise for it.

---

## 2. The single reconciled definition

```sql
create or replace function fn_account_is_entitled(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from subscriptions s
     where s.account_id = p_account_id
       and (
         -- (1) ANOMALY TOLERANCE (D-3). NOT a valid state.
         --     Missing data never withdraws entitlement from someone who may
         --     legitimately have paid. Every match carries an open
         --     null_period_end reconciliation item. Once the NOT NULL
         --     constraint lands (§4) no new row can reach this branch.
         s.current_period_end is null

         -- (2) TRIAL (D-26). Exactly the advertised days. No grace.
         or (s.status = 'trialing' and s.current_period_end > now())

         -- (3) PAID AND EXPECTED TO RENEW. Deliberately status-only.
         --     A stale row is OUR gap, not the customer's. Withdrawing here
         --     would cut off every customer whose renewal webhook is minutes
         --     late. J6 reconciles; see §3 case 2.
         or s.status = 'active'

         -- (4) DUNNING GRACE (R4/D-11). current_period_end is NOT advanced on
         --     a failed renewal, so this is 7 days past the last paid-through
         --     date. Interval read from configuration -- see §5.
         or (s.status = 'past_due'
             and s.current_period_end + <grace_interval> > now())

         -- (5) CANCELLED BUT PAID THROUGH.
         or (s.status = 'cancelled' and s.current_period_end > now())
       )
  );
$$;
```

Signature unchanged, so **none of the 60 write policies is touched**. Replaced
**once**, carrying all three rulings.

### 2.1 Boundary semantics — confirmed

Every comparison is **strict `>`**. At exactly `current_period_end` the account is
**not** entitled: access ends *at* the boundary, not after it. Equality never
remains entitled, for trials, for cancellations, and for the end of grace.

(In practice `now()` carries microsecond resolution, so exact equality is
effectively unreachable — but the semantics are defined rather than left to
chance.)

---

## 3. Entitlement truth table

**Read access is `✓` in every row without exception.** No `SELECT` policy is
gated by entitlement, by `0028`'s permanent rule: *"Their data is theirs."*
Expiry never deletes, hides or destroys anything.

| # | Case | Write | Read | Reconciliation |
|---|---|:---:|:---:|:---:|
| 1 | `active`, inside period | **✓** | ✓ | — |
| 2 | `active`, period expired | **✓** | ✓ | **✓** J6: renewal evidence missing |
| 3 | `past_due`, inside 7-day grace | **✓** | ✓ | — *(dunning notices, not an anomaly)* |
| 4 | `past_due`, beyond grace | ✗ | ✓ | — *(J3 lapses it; expected)* |
| 5 | `trialing`, before boundary | **✓** | ✓ | — |
| 6 | `trialing`, **exactly at** boundary | ✗ | ✓ | — |
| 7 | `trialing`, after boundary | ✗ | ✓ | — |
| 8 | `trialing`, boundary **NULL** | **✓** | ✓ | **✓** `null_period_end` |
| 9 | `cancelled`, inside paid period | **✓** | ✓ | — |
| 10 | `cancelled`, outside period | ✗ | ✓ | — |
| 11 | `active` / `past_due` / `cancelled`, boundary **NULL** | **✓** | ✓ | **✓** `null_period_end` |
| 12 | **no subscription row at all** | ✗ | ✓ | **✓** — onboarding always creates one, so absence is a real signal, not an unknown (`0028`) |

Case 2 is the one worth defending explicitly. `active` with a passed boundary
means we have heard neither a success nor a failure — a gap in *our* record.
Withdrawing entitlement there would cut off a paying customer at every renewal
where the webhook is delayed by so much as a minute. The exposure is bounded by
J6's daily sweep, not by the predicate, and that is the approved asymmetry:
**evidence may extend entitlement automatically; it may never withdraw it.**

Case 11 applies the D-3 fail-open branch **uniformly across all statuses**,
including `cancelled`. That is the reading flagged as **D-3 §2.1** and it is
still awaiting your explicit confirmation — it changes today's behaviour for
`cancelled` + NULL, which currently fails closed. It is written this way here
because the alternative is one rule for three statuses and a different one for
the fourth, which is how the inconsistency arose in the first place.

---

## 4. New trials must never enter production without a boundary

Your distinction between legacy tolerance and the creation invariant exposes a
defect in D-3's own proposal.

**D-3 proposed:**

```sql
check (status = 'trialing' or current_period_end is not null)   -- WRONG under D-26
```

That **exempts exactly the case D-26 now requires**. Under D-26 a trialing row
without a boundary is not a legitimate unlimited trial — it is the anomaly.
Amended to:

```sql
alter table subscriptions
  add constraint ck_subscriptions_period_present
  check (current_period_end is not null);
```

Every status needs a boundary; no exemption is left. Simpler, stronger, and a
direct consequence of D-26.

| Layer | Coverage |
|---|---|
| **Write boundary** | `fn_set_subscription_plan` refuses any status — **including `trialing`** — without the required dates |
| **Database** | the constraint above, binding `service_role`, support fixes, webhooks and jobs identically |
| **`0020`** | already sets `current_period_end` for every new trial — **verified in the deployed source**, so the constraint should not conflict with the onboarding path |
| **`0034` self-check** | asserts **zero** NULL rows before adding the constraint, and refuses rather than proceeding |

Once the constraint lands, branch (1) of §2 can only ever match a **legacy** row.
It is retained deliberately: removing it would mean a row predating the
constraint loses access the moment the constraint is added.

---

## 5. Grace as configuration, not a literal

D-11 ruled 7 days uniform, as a design assumption. **Recommendation: hold it in
configuration rather than inline in the function.**

The reason is directly relevant to your instruction not to replace this function
repeatedly: with a literal, changing 7 → 10 means **replacing
`fn_account_is_entitled` again**. With configuration it is an `UPDATE`. Given
that three separate rulings had to be reconciled to replace it once, the next
change should not require a fourth.

The function stays `stable`, so a one-row config read is cached within a
statement. Same treatment as D-4's reversal window and D-14's provider minimum.

---

## 6. D-25 audit sequencing — recommendation

You asked for whichever keeps one source of truth and avoids throwaway
infrastructure. **Run the D-25 production updates after `0033`, recorded in
`subscription_changes`.**

- **One source of truth.** `subscription_changes` will hold every subscription
  change from launch onward. Putting these five in a separate runbook file
  creates a second place to look for subscription history — permanently, for the
  five most commercially significant accounts we have.
- **No throwaway infrastructure.** The alternative requires inventing a record
  format used once.
- **The sequencing is free.** D-25 depends on classification and invitation
  timing, which is launch-transition work that naturally follows `0031`–`0033`.

**One requirement this places on `0033`:** `subscription_changes` must be able to
record a change whose cause is an **owner action**, not a customer or provider
event — a `change_source` ('customer' | 'provider' | 'owner') and an
`authorised_by`. Without it there is nowhere to record who authorised the
extension and why, and the audit requirement is met in form but not in substance.

## 7. Customer communication

D-9's trial-ending notice **ships with `0034`, not after**. Approved timing,
unchanged: **T−3** (ending soon, what happens next, the price) and **T+0** if
unconverted (ended, data stays readable, how to subscribe). Timing is ours from
`trial_ends_at`; no provider evidence is assumed.

**The D-9 invariant is unchanged and unchallenged**: no email or WhatsApp
delivery result may grant, extend, revoke or determine entitlement. Nothing in
§2 reads a delivery status; a customer whose notice bounced expires on exactly
the same boundary as one who read it, and the undelivered notice becomes a human
obligation rather than a change in state.
