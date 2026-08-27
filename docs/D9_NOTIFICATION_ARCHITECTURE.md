# D-9 — BILLING COMMUNICATION ARCHITECTURE

**RULED 27 Aug 2026 — Option B, email + WhatsApp. DESIGN ONLY, NOT IMPLEMENTED.**
No provider configured, no credentials, no templates registered, no deployment.

Email is the **primary, system-of-record** transactional channel. WhatsApp is the
**high-urgency recovery** channel — not a mirror of every email.

**Commercial rule: failed-payment recovery must not depend solely on email.**

---

## 1. The invariant this whole design exists to protect

> **Billing decides state. The outbox guarantees communication attempts.**
> Neither is ever allowed to become the other.

Three enforceable consequences, and they should each be stated in the migration
headers rather than assumed:

1. **No `fn_billing_*` job may read `notification_outbox.status`.** Not one
   predicate, not one guard. A delivery outcome must be structurally incapable of
   influencing a state transition.
2. **Every state transition writes its notification obligations in the same
   transaction as the state change.** The obligation is exactly as durable as the
   fact that created it. A provider outage cannot lose a required message,
   because the message was never dependent on the provider being up.
3. **Delivery failure has no path back into entitlement.** J3 does not check
   whether the day-6 notice was delivered before lapsing.

### 1.1 The uncomfortable consequence, stated plainly

**If Meta is down for the entire grace period, the customer still lapses on
day 7.** That is deterministic and it is correct under the ruling. The mitigation
is a durable, retryable obligation plus a visible gap — not a delayed lapse.

There is a tempting alternative — extend grace when no notice was delivered — and
it should be **rejected**, because it makes entitlement a function of the
notification system, which is precisely the coupling the ruling forbids. If that
is ever wanted it must be a separate, explicit commercial decision, not a
quietly-added guard.

---

## 2. Provider-agnostic model

No vendor name appears in any table, column, constraint or enum. `provider_code`
is a **value in a row**, not a schema commitment. Swapping Resend for Postmark, or
Meta for another WhatsApp BSP, changes rows and Edge Function code and touches
nothing in the domain model.

```
notification_channels     code 'email' | 'whatsapp'; requires_consent; is_system_of_record
notification_types        code; template_key; channels[]; is_transactional; priority
account_contacts          account_id; kind 'email'|'phone'; value; verified_at;
                          verification_method; is_primary
communication_consents    account_id; channel; category; granted_at; revoked_at; source
notification_outbox       one row PER (type, channel) -- never one row for two channels
notification_attempts     one row per attempt
```

### 2.1 `notification_outbox`

```
  id, account_id, type_code, channel
  dedupe_key            text unique          -- (account, type, channel, subject_key)
  contact_id            -> account_contacts  -- resolved at queue time, re-checked at send
  template_key, template_version             -- STAMPED AT QUEUE TIME
  payload_vars          jsonb                -- variables only; no rendered body
  status                'pending' | 'in_flight' | 'sent' | 'delivered'
                        | 'failed_transient' | 'failed_permanent' | 'suppressed'
  suppression_reason    text
  attempts, next_attempt_at
  queued_at, sent_at, delivered_at, failed_at
  provider_code, provider_message_id, provider_status_raw
  last_error_code, last_error
```

Design notes that are load-bearing rather than cosmetic:

- **One row per channel.** Status, retry, backoff and dedupe are all per-channel,
  which is the only way "email delivered, WhatsApp failed" is representable. A
  single row with two channels cannot express partial success.
- **`template_key` + `template_version` are stamped at queue time**, so what was
  sent stays reproducible after templates change. The **rendered body is not
  stored** — it is deterministic from template version plus `payload_vars`, and
  storing it would duplicate personal data for no gain.
- **Timestamps are separate and nullable**: `sent_at` is what we did,
  `delivered_at` is what the provider confirmed. Where a provider exposes no
  delivery signal, `delivered_at` stays NULL — **it is never backfilled from
  `sent_at`**. An unknown delivery is recorded as unknown.

### 2.2 Consent and verified availability

- **Transactional billing mail is not subject to marketing opt-out.** A customer
  who unsubscribes from product news still receives "your payment failed".
- **WhatsApp requires an explicit consent record** even for transactional
  messages, and a verified phone number. *(Meta's exact policy and template rules
  must be verified before implementation — their documentation is unreachable
  from this environment, so this is recorded as an assumption, not a fact:
  **V-4**.)*
- A notification is dispatchable on a channel only if a **verified** contact of
  the right kind exists. Otherwise the row is created anyway with
  `status = 'suppressed'` and a reason — the obligation is recorded even when it
  cannot be met, so the gap is countable rather than invisible.

### 2.3 The fallback when WhatsApp is unavailable

The commercial rule cuts the other way from a normal fallback: email is not the
safety net, it is the thing that is **insufficient on its own**. So for the three
urgent types:

1. **Email always.** System of record, no exceptions.
2. **WhatsApp where a verified phone and consent exist.**
3. **If WhatsApp cannot deliver** — no consent, no verified number, or the
   provider fails past its retry budget — the obligation is **not silently
   dropped**. It becomes an open `notification_gap` reconciliation item naming the
   account, the type and the reason.

**The fallback for a broken second channel is a human, not silence.** That is
what makes "recovery must not depend solely on email" an honest claim rather than
an aspiration: either a second channel delivered, or somebody knows it did not.

### 2.4 Retry and idempotency — deliberately different from provider operations

| | Notifications | Provider operations |
|---|---|---|
| Attempts | 8 | **3** |
| Backoff | 1m, 5m, 15m, 1h, 4h, 12h, 24h, 24h | 2m, 15m, 2h |
| Reconcile before retry | **no** | **yes, mandatory (L5)** |
| Idempotency | `unique (dedupe_key)` + `sent_at is null` | deterministic `operation_key` + L5 |
| Terminal | `failed_permanent` + gap item | `needs_human` + operator alert |

Different tables, different policies, on purpose: **a duplicate WhatsApp message
costs goodwill; a duplicate subscription costs money.** Collapsing them into one
outbox would force one retry policy onto both risks.

---

## 3. Reconciling the event set against the approved state machine

Requested before freezing the enumeration. Six findings.

### F-1 — `SUBSCRIPTION_STATE_MACHINE.md` §3.2 now contains two false statements

Not a notification problem, but found while reconciling and it must not be
carried into implementation. §3.2 says:

> *"A later successful retry returns it to `active` and advances the period end.
> If Paystack exhausts its retries (`subscription.disable`), it becomes
> `cancelled`."*

**Under P-3 there are no Paystack retries.** Both sentences are false as written.
`past_due → active` still exists as a transition, but it is now driven by
**customer-present recovery**, and `past_due → cancelled` is driven by **our**
grace expiry (J3), not by Paystack exhausting anything. Flagged here rather than
silently edited; the correction belongs in the same change that implements the
grace bound.

### F-2 — Activation and first receipt are the same moment (redundant)

The first `charge.success` is both "subscription activated" and "payment
received". Firing both sends a new customer two emails seconds apart.

**Proposed:** the activation confirmation *carries* the first receipt; the
standalone receipt fires only on **subsequent** charges.

### F-3 — "Lapse / access-change confirmation" is misleading as named

At lapse, `0028` gates **writes only** — every `SELECT` remains open, deliberately
and permanently: *"Their data is theirs."* A message saying access has ended
would be false. The copy must say that recording new work has stopped and that
everything already entered stays readable and exportable.

### F-4 — A cancelled subscription's period end has no notification

The set covers cancellation *at request* (#7) and lapse *after grace* (#6), but
not the third moment: a cancelled subscription reaching `current_period_end`,
which J2 finalises. Today that passes in silence.

**Proposed:** rather than a twelfth type, let #6 cover both endings with the
reason as a parameter — lapse-unpaid or cancellation-ran-out. Same customer
situation, same copy skeleton, different sentence.

### F-5 — Two types are missing that the state machine makes reachable

- **Trial ending.** `trialing → cancelled` (trial ends unconverted) is a legal
  transition, and today a trial would expire in silence. This was in the earlier
  R8 list and is absent from the ruled set — flagging in case that was a slip
  rather than a decision.
- **Upgrade confirmed**, including D-14's **waiver** case where no charge is
  taken. The prorated charge can be covered by the receipt type; the waiver
  cannot, because there is no payment to receipt.

### F-6 — The founding anomaly notice has two audiences

"Founding-pricing anomaly / manual-review notice" mixes a customer message ("your
next renewal will be ₦X") with an operator task. The operator side already exists
as `reconciliation_items` and should **not** be an email to the customer. The
notification type should be customer-facing only.

### 3.1 Resulting enumeration

| # | Type | Email | WhatsApp |
|---|---|---|---|
| 1 | activation / subscription confirmed *(carries first receipt, F-2)* | ✅ | — |
| 2 | payment receipt *(subsequent charges, and prorated upgrades)* | ✅ | — |
| 3 | **payment failed** | ✅ | ✅ |
| 4 | **recovery reminder** | ✅ | ✅ |
| 5 | **final notice before lapse** | ✅ | ✅ |
| 6 | access changed — subscription ended *(reason: lapsed \| cancellation ran out, F-3/F-4)* | ✅ | — |
| 7 | cancellation / non-renewal confirmed | ✅ | — |
| 8 | downgrade scheduled | ✅ | — |
| 9 | downgrade now in effect | ✅ | — |
| 10 | material billing / price change | ✅ | — |
| 11 | founding-price ended | ✅ | — |
| 12 | founding-price anomaly — next renewal amount *(customer-facing only, F-6)* | ✅ | — |
| 13 | recovery succeeded *(§4)* | ✅ | conditional |
| — | *trial ending* — **awaiting your ruling (F-5)** | ? | — |
| — | *upgrade confirmed / charge waived* — **awaiting your ruling (F-5)** | ? | — |

---

## 4. Recovery confirmation on WhatsApp — recommendation: **YES, narrowly**

Asked for a recommendation rather than an assumption. **Send it — but only when
the recovery was initiated from a WhatsApp message**, tracked as a `source_channel`
on the recovery, not on every successful recovery.

Three reasons, in order of weight:

1. **It prevents a duplicate payment, which is a real cost, not a nuisance.** A
   customer who paid and sees no acknowledgement in the channel they acted from
   may pay again — and under our design a second checkout can create a second
   subscription, which is exactly the failure `provider_operations`' L5 exists to
   prevent on our side. Preventing it on the customer's side is cheaper.
2. **Closing the loop in the channel the customer acted in** is where they are
   looking. Sending them back to email to find out whether their payment worked
   negates the reason WhatsApp was chosen.
3. **The volume is bounded by definition** — it fires only when someone actually
   recovered from a WhatsApp prompt, so it cannot become the mirror-of-every-email
   that the ruling rules out.

Conditioning on `source_channel` is what keeps WhatsApp urgency-only in spirit as
well as in the table above.

---

## 5. Auditability

- Every obligation is a **row created in the transaction that created the fact**,
  so "was this customer told?" is answerable for every state change, including
  ones where the answer is no.
- Every attempt is a row: number, timestamps, provider, provider message id,
  outcome, error code. **Never request or response bodies** — the same rule that
  governs `provider_operation_attempts`, for the same reason.
- What was sent is reproducible from `template_key` + `template_version` +
  `payload_vars` without storing rendered personal data.
- `notification_gap` items make undeliverable obligations countable, so "recovery
  does not depend solely on email" is a measurable claim.
- Templates live in **version-controlled files**, not database rows, so a change
  to what customers are told is reviewable in a diff like any other change.

## 6. What must be verified before implementation

| | Item |
|---|---|
| **V-4** | Meta's WhatsApp policy for transactional/utility messages: consent requirements, template approval, and the 24-hour session-window rules. §2.2 assumes explicit consent and pre-approved templates; unverified — Meta's documentation is unreachable from this environment. |
| **V-5** | Which delivery signals the chosen providers actually expose, so §2.1's `delivered_at` is populated only where it means something. |

Neither blocks the schema. Both block going live on WhatsApp.
