# Billing Integration — Design for Review

**Status: DESIGN ONLY. No code written. Nothing deployed. Production untouched.**

Covers the Paystack webhook Edge Function and the `billing_events` audit table.
Arises from S13: `0017` correctly refuses a subscription update for an account
that has none, but that refusal currently leaves no durable trace.

---

## 0. Which gate this belongs to

**Neither Gate 1 nor Gate 2. It should be its own gate.**

Gate 1 is the database authorization and costing-integrity layer — verified and
complete. Gate 2 is already defined in `GATE2_FINAL_DESIGN.md` as serving
formats and recipe variants: a product-model concern with no billing overlap.

This work is different in kind from both. It is an **external integration with
money attached**, and it needs things neither gate needed: Edge Function
deployment, secret management, a Paystack test-mode account, and evidence
gathered against a third party's sandbox rather than our own database.

Proposed name: **Gate 3 — Billing Integration**. The number is a label, not a
sequence: Gate 2 and Gate 3 are independent and can run in either order.

**Recommendation on ordering.** Gate 2 first. Every `plans.monthly_price` is
currently `0`, so nothing is being charged and the billing path has no live
traffic to protect. Gate 2 unlocks product capability; Gate 3 unlocks revenue,
and revenue you cannot yet earn is not urgent. That said, **Gate 3 must be
complete before a single real payment is accepted** — not after.

---

## 1. `billing_events` schema

```sql
create table billing_events (
  id                 uuid primary key default gen_random_uuid(),
  received_at        timestamptz not null default now(),

  provider           text        not null default 'paystack',
  event_type         text,                       -- null when payload unparseable
  provider_event_id  text,                       -- Paystack data.id
  reference          text,                       -- Paystack data.reference
  account_id         uuid references accounts(id) on delete set null,

  body_sha256        text        not null,       -- exact-redelivery key
  payload            jsonb,                      -- REDACTED, see section 7
  body_bytes         integer,
  source_ip          inet,

  signature_valid    boolean     not null,
  status             text        not null default 'received',
  attempts           integer     not null default 0,
  next_retry_at      timestamptz,

  last_error_code    text,                       -- e.g. 'P0002'
  last_error         text,
  applied_at         timestamptz,

  constraint ck_billing_events_status check (status in (
    'received','processing','applied','ignored',
    'failed_permanent','failed_transient','rejected'))
);

create unique index ux_billing_events_body
  on billing_events (provider, body_sha256);

create unique index ux_billing_events_provider_event
  on billing_events (provider, event_type, provider_event_id)
  where provider_event_id is not null;

create index ix_billing_events_pending
  on billing_events (next_retry_at)
  where status in ('received','processing','failed_transient');

create index ix_billing_events_reconcile
  on billing_events (status, event_type) where status <> 'applied';
```

`account_id` uses `on delete set null` deliberately: deleting an account must
not erase the evidence that money moved.

### Access

RLS enabled, **no policies for client roles** — `anon` and `authenticated` can
read nothing. Only `service_role` is granted DML.

Note that thanks to `0018`, this table inherits **nothing** for client roles at
creation. Before `0018` it would have arrived with `ALL` granted to `anon`,
including `TRUNCATE` — an audit table an unauthenticated visitor could empty.
Verification item 9 proved a new table now grants `NONE`.

---

## 2. Idempotency strategy

Two layers, because they catch different mistakes.

**Layer 1 — exact redelivery.** `unique (provider, body_sha256)`. A Paystack
retry resends a byte-identical payload, so the hash collides and the insert is
refused.

**Layer 2 — logical duplication.** `unique (provider, event_type,
provider_event_id)`. Catches the same logical event arriving with a differing
body (re-serialised, timestamp added). Partial, because `provider_event_id` is
absent on some event types.

**The claim.** Insert and claim are separate, so concurrency is settled by the
database rather than by application timing:

```sql
insert into billing_events (...) values (...)
on conflict (provider, body_sha256) do nothing
returning id;
-- no row returned  =>  a duplicate; inspect the existing row's status

update billing_events
   set status = 'processing', attempts = attempts + 1
 where id = $1
   and status in ('received','failed_transient')
returning id;
-- no row returned  =>  another worker already claimed it
```

Only one caller can win the `UPDATE`. No advisory locks, no application-level
mutex, no reliance on request ordering.

**The crash gap.** If a worker inserts `received` and dies before applying, the
duplicate check would skip the retry forever. A sweeper reclaims rows left in
`received` or `processing` for longer than 5 minutes. Without it, a crash
mid-flight silently loses a payment.

---

## 3. Event lifecycle

```
                  signature invalid
   (request) ──────────────────────────► rejected      (terminal, minimal row)
       │
       │ signature valid
       ▼
   received ──claim──► processing ──┬──► applied            (terminal)
       ▲                            │
       │                            ├──► ignored            (terminal, unsupported type)
       │                            │
       │                            ├──► failed_permanent   (terminal, NEEDS A HUMAN)
       │                            │
       └────── sweeper ◄────────────┴──► failed_transient   (retryable)
```

| Status | Meaning | Retried? |
|---|---|---|
| `received` | verified, recorded, not yet processed | by sweeper |
| `processing` | claimed by a worker | by sweeper after timeout |
| `applied` | subscription transition succeeded | no |
| `ignored` | valid event, type we do not handle | no |
| `failed_permanent` | refused for a reason retrying cannot fix (`P0002`, `22023`) | no — **reconciliation queue** |
| `failed_transient` | database unavailable, timeout | yes |
| `rejected` | signature verification failed | no |

`failed_permanent` is the status that matters commercially: it means Paystack
believes something happened and our database disagrees.

---

## 4. Webhook verification flow

```
1. Read the RAW request body as bytes. Do not parse first — the signature is
   over the exact bytes, and re-serialising JSON changes them.
2. hmac_sha512(raw_body, PAYSTACK_SECRET_KEY)
3. Constant-time compare against the x-paystack-signature header.
   A byte-by-byte compare with early exit leaks the signature via timing.
4. Mismatch  -> record a minimal 'rejected' row, return 401. STOP.
5. Reject bodies over 256 KB before hashing.
6. Parse JSON. Unparseable -> record with event_type null,
   status 'failed_permanent', return 200.
7. Insert (idempotency layer 1). Duplicate -> branch on existing status.
8. Claim (layer 2). Lost the claim -> return 200.
9. Map event type -> internal transition (section 8).
   Unsupported -> 'ignored', return 200.
10. Call fn_set_subscription_plan with the service_role key.
11. Record the outcome. Return per section 5.
```

**Step 1 is the one most often got wrong.** Frameworks that parse JSON before
handing you the body make signature verification impossible to do correctly.

**On recording rejected signatures.** A minimal row only — timestamp, source IP,
body length, body hash. **Never the body**: it is attacker-controlled, and the
endpoint URL is guessable. There is a real trade-off here and it is your call:
recording gives forensic evidence of probing, but lets an unauthenticated caller
write rows. Mitigation is the size cap plus rate limiting at the edge. The
alternative — return 401 with no write at all — is safer against abuse and
blinder against attack. **My recommendation: record the minimal row**, because
an integration handling money should be able to prove what arrived.

---

## 5. Failure, retry and reconciliation

| Situation | Recorded as | HTTP to Paystack | Why |
|---|---|---|---|
| Applied cleanly | `applied` | 200 | done |
| Unsupported event type | `ignored` | 200 | valid, just not ours |
| Database unavailable | `failed_transient` | **500** | genuinely transient; a retry may succeed |
| `P0002` no subscription | `failed_permanent` | **200** | retrying cannot fix it |
| `22023` unknown status | `failed_permanent` | 200 | mapping bug on our side |
| Invalid signature | `rejected` | 401 | not from Paystack |
| Malformed payload | `failed_permanent` | 200 | unparseable now, unparseable later |

**Returning 200 on a permanent failure deserves justification.** It tells
Paystack to stop retrying, which is correct — the call can never succeed. It
does *not* mean we consider it handled: the `failed_permanent` row is the alarm,
and it must page a human.

The alternative is returning 422 so the failure also appears in Paystack's
dashboard. I recommend against relying on that: **our own records should be the
authority, not a third party's UI.** If you would rather have the external
visibility too, 422 is a defensible choice and the design supports either.

### Reconciliation

```sql
create view v_billing_reconciliation as
select received_at, event_type, reference, provider_event_id,
       account_id, status, last_error_code, last_error, attempts
from billing_events
where status in ('failed_permanent','failed_transient')
   or (status = 'received'   and received_at < now() - interval '15 minutes')
   or (status = 'processing' and received_at < now() - interval '15 minutes')
order by received_at desc;
```

This answers the question the whole table exists for: *Paystack says they paid —
did we act on it?* Anything in this view is money that moved without a matching
entitlement change.

**A view is not an alert.** Nobody reads a view. Whatever runs the sweeper must
also notify a human when a `failed_permanent` row appears.

---

## 6. Secrets

| Secret | Stored | Never |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | Supabase Edge Function secret (`supabase secrets set`) | in the repo, in the database, in a log line, in an error response |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function secret | same |

Read via `Deno.env.get()` at invocation. `.env` files stay in `.gitignore`.
Rotation: set the new secret, redeploy, then revoke the old one.

---

## 7. What must never be logged or stored

**`data.authorization.authorization_code` is a bearer credential.** It lets the
holder charge that customer again without their involvement. It must be stripped
from the payload before storage and must never appear in a log line. This is the
single most important line in this document.

Stripped before `payload` is written:

```
data.authorization.authorization_code     -- can initiate charges
data.authorization.signature              -- card fingerprint
data.authorization.bin                    -- card number prefix
data.authorization.exp_month / exp_year
```

Retained: `last4`, `card_type`, `bank`, `channel` — enough to identify a payment
method in a support conversation, not enough to use one.

Never logged under any circumstances: either secret key, the full raw body of an
unverified request, `authorization_code`.

Treated as personal data: customer email, phone, name. Stored where needed for
reconciliation, never emitted in an error returned to an external caller.

---

## 8. Integration with the subscription state machine

Paystack's vocabulary is mapped here and **never persisted** — per
`SUBSCRIPTION_STATE_MACHINE.md`, `subscriptions.status` only ever holds one of
four internal values, enforced by `ck_subscriptions_status` from `0017`.

| Paystack event | Internal transition | Notes |
|---|---|---|
| `charge.success` (first invoice) | `trialing → active` | set `current_period_end`, `provider_ref` |
| `charge.success` (renewal) | `past_due → active` / `active → active` | advance `current_period_end` |
| `invoice.payment_failed` | `active → past_due` | **do not** advance the period end |
| `subscription.not_renew` | `active → cancelled` | leave `current_period_end` — this is what preserves paid access |
| `subscription.disable` | `→ cancelled` | |
| `subscription.create` | ensure `active` | |
| anything else | no transition | `ignored` |

Every write goes through `fn_set_subscription_plan`. The Edge Function never
issues `UPDATE subscriptions` directly — `0012` revoked that from clients and
`0017` added the row-count and status guards, and bypassing them would discard
exactly the protections we just verified.

---

## 9. Migration and rollback

**`0019_billing_events.sql`** — additive, idempotent, no preflight needed (it
creates a new table and touches nothing existing).

Contents: the table, its constraints and indexes, RLS enabled with no client
policies, `service_role` grants, and `v_billing_reconciliation`.

**Rollback:**

```sql
drop view  if exists v_billing_reconciliation;
drop table if exists billing_events;
```

Safe because nothing references `billing_events` — the dependency runs one way.
Dropping it destroys the audit trail, so it is a development rollback, not a
production one. In production the reversal is to stop the Edge Function and
leave the table.

The Edge Function deploys and rolls back independently of the schema. Deploy
order: migration first, then the function. Removal order: reverse.

---

## 10. Test plan

### 10a. SQL layer — runs in the existing local harness

New suite `tests/010_billing_events.sql`, same pattern as `004`/`005`:

1. duplicate `body_sha256` is refused
2. duplicate `(event_type, provider_event_id)` is refused; NULL ids do not collide
3. the claim `UPDATE` succeeds exactly once across two concurrent attempts
4. a row stuck in `processing` past the timeout is reclaimable
5. every status outside the seven is refused by the CHECK
6. `anon` and `authenticated` can read nothing (0 rows, not an error)
7. `anon` cannot `TRUNCATE` it — the `0018` regression, on the new table
8. `v_billing_reconciliation` surfaces `failed_permanent` and hides `applied`
9. deleting an account leaves the billing row with `account_id` NULL

### 10b. Signature verification — unit tests

10. known-vector HMAC-SHA512 matches a precomputed value
11. a one-byte body change fails verification
12. a missing header fails
13. comparison is constant-time (implementation review, not timing measurement —
    a timing test in CI is too noisy to be evidence)

### 10c. The eleven scenarios — integration, disposable project + Paystack test mode

Section 11.

### 10d. Regression

Suites `001`, `002`, `004`, `005` must stay at **154/154**, plus the new `010`.
`0018`'s evidence script must still return 12/12 — `billing_events` is a new
table and item 9 asserts new tables inherit nothing.

---

## 11. The eleven scenarios

| # | Scenario | Expected behaviour |
|---|---|---|
| 1 | **Valid payment, existing subscription** | signature verifies → row `received` → claimed → `fn_set_subscription_plan` returns `rows_updated=1` → `applied`, `applied_at` set → **200** |
| 2 | **Valid payment, missing subscription** | recorded → claim → `P0002` → `failed_permanent`, `last_error_code='P0002'` → **200** → appears in `v_billing_reconciliation` → **alert raised**. This is S13's real fix: the refusal is now durable and visible. |
| 3 | **Duplicate webhook** | insert conflicts on `body_sha256` → existing row read → status `applied` → **200**, no second transition. The subscription is not advanced twice. |
| 4 | **Forged / invalid signature** | HMAC mismatch → minimal `rejected` row (no body) → **401**. `fn_set_subscription_plan` is never called. |
| 5 | **Received twice concurrently** | both attempt the insert; one wins, one conflicts. Both then attempt the claim; the `UPDATE`'s `where status in ('received','failed_transient')` lets exactly one through. Loser returns **200** without acting. Serialised by the database, not by timing. |
| 6 | **Database temporarily unavailable** | if the insert fails, nothing is recorded and we return **500** so Paystack retries — the only case where losing the record is acceptable, because no state changed. If the *transition* fails, the row exists → `failed_transient`, `next_retry_at` set → **500**. |
| 7 | **Paystack retries after a 5xx** | identical body → conflicts → existing row is `failed_transient` → reclaimed and retried. If it now succeeds → `applied`, **200**. |
| 8 | **Unsupported Paystack event** | recorded, `ignored`, **200**. Retained deliberately: the first sighting of a new event type is how we learn Paystack added one. |
| 9 | **Malformed payload** | signature may still verify over arbitrary bytes. Recorded with `event_type` NULL and `failed_permanent` → **200**. Never retried; it will not become parseable. |
| 10 | **Event recorded but subscription update fails** | scenarios 2 and 6 — the split between `failed_permanent` and `failed_transient` is exactly this case, and is why recording happens *before* applying. |
| 11 | **Update succeeds but acknowledgement fails** | `applied` is committed; the 200 never reaches Paystack; Paystack retries. The retry conflicts on `body_sha256`, sees `applied`, returns 200 without re-applying. **This is why idempotency is keyed on the payload rather than on our response.** |

Scenario 11 is the one that silently double-charges systems that get it wrong.

---

## 12. Open questions for you

1. **Record rejected signatures, or return 401 blind?** I recommend recording a
   minimal row. It admits unauthenticated writes; the alternative is blindness.
2. **200 or 422 on `failed_permanent`?** I recommend 200 plus our own alerting,
   rather than depending on Paystack's dashboard.
3. **What raises the alert?** A view nobody reads is not an alert. Email, Slack,
   or a dashboard the team actually opens — this needs an owner, not just a table.
4. **Sweeper: pg_cron or an external scheduler?** Nothing in Menu Master NG runs
   on a timer today, so this is the first scheduled job in the system.
