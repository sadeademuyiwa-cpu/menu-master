# C10 — Idempotent Onboarding: Design v2

**Status:** design only. Nothing implemented. Every behaviour below was proven on
a throwaway replica with a prototype that has since been destroyed — no
prototype code exists in `migrations/`.

---

## 0. `p_allow_additional` — you are right, and it is removed

I proposed it; it does not survive your question, and I am withdrawing it.

**What I claimed it protected:** callers that send no idempotency key, where a
double-click would still duplicate.

**Why that argument fails:** that hole exists only because I made the key
*optional*. The correct fix is to make the key **required**, not to bolt on a
second mechanism to patch the gap left by the first. Once the key is mandatory,
there is no unprotected path for the flag to protect.

**Is there any other invariant?** No. I looked for one specifically:

- *"One account per user by default"* — you explicitly ruled this out as a
  product rule, and the schema contradicts it: `memberships` is keyed
  `(account_id, business_id, user_id)`, so multi-account membership is designed in.
- *"Guard against a client that mints a fresh key per retry"* — real, but the
  flag does not help. A client buggy enough to regenerate keys would pass
  `p_allow_additional` too. This is inherent to idempotency keys and is solved by
  client discipline (§8), not by a server flag.
- *"Force deliberateness for a second business"* — that is what a distinct key
  already is.

**Your model is exactly right, and it is now the whole design:**

| Call | Result |
|---|---|
| `User A + Key 123` | Business 1 |
| retry `User A + Key 123` | Business 1 again, nothing created |
| `User A + Key 456` | Business 2 |

**Proven** (T1–T4, §9): identical payload replayed with no new rows; a different
key created a second tenant. No flag involved.

---

## 1. Schema

```sql
create table onboarding_requests (
  user_id             uuid not null references auth.users(id) on delete cascade,
  idempotency_key     text not null,
  payload_fingerprint text not null,
  account_id          uuid not null references accounts(id)   on delete cascade,
  business_id         uuid not null references businesses(id) on delete cascade,
  location_id         uuid not null,
  ingredients_added   integer not null,
  created_at          timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
```

`primary key (user_id, idempotency_key)` **is** the correctness guarantee —
enforced by the database, not by application logic, and not bypassable by any
client. Keys are namespaced per user, so two users may independently use the
string `"123"`.

RLS enabled; `p_onboarding_requests` for select using `user_id = auth.uid()`.
Grants follow 0018: `authenticated` SELECT only, `anon` nothing. The RPC writes
it as SECURITY DEFINER.

---

## 2. Signature

```sql
fn_create_account_and_business(
  p_account_name    text,
  p_business_name   text,
  p_business_type   business_type,
  p_user_id         uuid    default null,
  p_currency        text    default 'NGN',
  p_timezone        text    default 'Africa/Lagos',
  p_trial_days      integer default 14,
  p_idempotency_key text    default null      -- REQUIRED in effect
)
```

Declared with `default null` but **rejected when null**:

```sql
if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
  raise exception 'An idempotency key is required for onboarding.'
    using errcode = '22023';
end if;
```

A defaulted parameter plus an explicit raise gives a clear error message; a
parameter with no default would surface as a confusing PostgREST "function not
found" 404 instead. Enforcement is identical.

---

## 3. Control flow

```
1. authorize exactly as today
     auth.uid() non-null, equal to p_user_id, auth.users row exists,
     names non-blank
2. reject a null/blank idempotency key
3. compute payload_fingerprint
4. pg_advisory_xact_lock(hashtextextended(v_user::text, 0))     [optional, §7]
5. look up (v_user, key)
     FOUND and fingerprint matches   -> return the replay, create NOTHING
     FOUND and fingerprint differs   -> raise, create NOTHING
6. begin
     provision the tenant exactly as today
     insert into onboarding_requests(...)
   exception when unique_violation then
     -- provisioning above is rolled back with the block
     re-read the key row; return the replay
   end
7. return the fresh result with idempotent_replay = false
```

### Payload fingerprint

```sql
v_fingerprint := md5(jsonb_build_object(
  'account_name',  btrim(p_account_name),
  'business_name', btrim(p_business_name),
  'business_type', p_business_type::text,
  'currency',      upper(btrim(coalesce(p_currency, 'NGN'))),
  'timezone',      btrim(coalesce(p_timezone, 'Africa/Lagos')),
  'trial_days',    coalesce(p_trial_days, 14)
)::text);
```

`jsonb` (not `json`) because jsonb normalises key order, making the text form
canonical. Normalisation is whitespace-only, plus case-folding for currency —
"Mama Nkechi" and "mama nkechi" are treated as **different** payloads, because a
capitalisation change is a real change the user should be told about rather than
silently ignored.

**Same key + different payload fails explicitly.** Raised with SQLSTATE `23505`,
which PostgREST maps to HTTP 409 Conflict. Confirm that mapping against your
deployed PostgREST version during implementation; if it differs, set
`response.status` explicitly instead. Proven in T3 (§9): the call raised and
created nothing.

---

## 4. Atomicity — no window in either direction

The requirement is that the idempotency record and the tenant can never exist
without each other.

1. PostgREST executes each RPC call inside **one transaction**.
2. `fn_create_account_and_business` is a `FUNCTION`, not a `PROCEDURE`, so it
   **cannot** issue `COMMIT`. There is no intermediate commit point available to it.
3. Provisioning and the `onboarding_requests` insert are both in that
   transaction, inside the same `BEGIN … EXCEPTION` block.
4. The only exception handler catches `unique_violation` and **returns a replay**
   — it never falls through to continue provisioning. That is the one property
   that could reintroduce a window, so it must be enforced by review.

**Proven, T7 (§9):** a transaction that ran the function successfully and was
then rolled back left `key rows = 0, accounts = 0`. Neither committed. There is
no half state.

**Proven, T6 (§9):** the losing side of a concurrent race rolled back its own
provisioning entirely — `orphan accounts = 0`, so no abandoned `accounts` row was
left behind by the discarded work.

---

## 5. Failed attempts stay retryable

A failure rolls back the key row along with everything else, so the key is free
again and the same key retries cleanly.

**Proven, T8 (§9):** after the T7 rollback, retrying with the *same* key `KG1`
succeeded and produced `key rows = 1, accounts = 1`.

This is why the key row must be written **inside** the provisioning transaction
and never in a separate one. A "reserve the key first, provision second" design
would strand the key on failure and permanently block the retry.

---

## 6. Key lifetime — permanent, not expiring

**Decision: store permanently**, removed only by `ON DELETE CASCADE` when the
account or the user is deleted.

| Consideration | Verdict |
|---|---|
| Volume | One row per successful onboarding — bounded by the number of accounts. Negligible. |
| Expiry's failure mode | After a TTL the key becomes "new" again, so a late retry **creates a duplicate**. That is the exact bug C10 exists to fix, reintroduced on a timer. |
| Why Stripe expires keys (24h) | They process billions of keys where retention is a genuine storage problem. We process one per account. Their constraint is not ours. |
| Operational cost | A TTL needs a scheduled job. Permanent retention needs nothing — no `pg_cron` dependency, no job that can silently stop. |
| Side benefit | The table doubles as an onboarding audit trail: which key produced which tenant, and when. |

The only cost of permanence is that a client reusing a years-old key gets a
replay instead of a new business. That is a client bug, and replay is the safe
outcome.

---

## 7. Is the advisory lock still necessary once the constraint exists?

**No. It is an optimisation, not the guarantee — and I tested it both ways
rather than reasoning about it.**

- **With the lock (T5):** one session provisioned, the other waited, then
  replayed the same `account_id`. Exactly one account.
- **Without the lock (T6):** both sessions provisioned concurrently. The second
  blocked on the unique index, received `23505` once the first committed, rolled
  its entire subtransaction back, re-read the winner's row and returned it —
  tagged `"via": "23505 handler"`. **Exactly one account, and zero orphan
  accounts.**

So the unique constraint alone is sufficient for correctness. The lock only
prevents the loser doing ~180 ingredient inserts that it will immediately
discard.

**Recommendation: keep it, but classify it honestly.** Unlike
`p_allow_additional`, the lock changes **no semantics** — same inputs, same
outputs, less wasted work — so it is not the same category of unnecessary
mechanism. It is per-user, transaction-scoped, and released automatically on
commit or rollback, so it cannot leak. If you prefer strict minimalism, dropping
it is safe: T6 is the proof, and the `23505` handler must exist either way as the
backstop.

---

## 8. Frontend key generation and retention

The server guarantee is only as good as the client's discipline about *when* a
new key is minted.

```js
// Mint ONCE, when the onboarding form is first opened.
function onboardingKey() {
  let k = sessionStorage.getItem('mm.onboarding.key');
  if (!k) { k = crypto.randomUUID(); sessionStorage.setItem('mm.onboarding.key', k); }
  return k;
}
```

Rules:

1. **Mint once per onboarding attempt**, before the first submit.
2. **Reuse the same key for every retry** — network error, timeout, double-click,
   browser refresh, back-button resubmit.
3. **Never regenerate on retry.** This is the one client behaviour no server
   mechanism can compensate for: a fresh key is, by definition, a request for a
   new business.
4. **Clear it only** after a response with `idempotent_replay: false`, or when
   the user deliberately starts creating another business.
5. **On timeout, retry with the same key.** The reply will be either the original
   result or a replay of it — never a duplicate. This is the timeout-after-commit
   case, and it is the main reason the key exists.
6. Prefer `sessionStorage` over component state so a refresh mid-onboarding does
   not mint a new key.

---

## 9. Evidence

Every claim above was executed against a throwaway replica carrying the full
Parts 1–5 chain. The prototype existed only in that database and was destroyed.

| # | Scenario | Result |
|---|---|---|
| T1 | First call, key `K1` | Created. `accounts=1 businesses=1 subs=1 ingredients=180 keys=1`, `idempotent_replay: false` |
| T2 | Same key, same payload | **Replay.** Identical `account_id`/`business_id`, `idempotent_replay: true`. Counts unchanged: `accounts=1 … keys=1` |
| T3 | Same key, **different** payload | **Raised explicitly.** Counts unchanged — nothing created, and no unrelated business returned |
| T4 | Different key `K2` | Second business created deliberately: `accounts=2 businesses=2 subs=2 ingredients=360 keys=2`. **No flag needed** |
| T5 | Two concurrent sessions, same key, lock **on** | One provisioned, one replayed the same ids. **1 account** |
| T6 | Two concurrent sessions, same key, lock **off** | Loser hit the `23505` handler and returned the winner's ids. **1 account, 0 orphan accounts** |
| T7 | Function succeeds, transaction rolled back | `key rows=0, accounts=0`. **No half state** |
| T8 | Retry with the same key after T7 | Succeeded. `key rows=1, accounts=1` |

---

## 10. Multi-business: `fn_create_business_in_account`

Still recommended, but for a different reason now that the flag is gone.

Today a second key produces a second **account**, which means a second
**subscription** and a second **trial** (T4: `subs=2`). If the product intent is
"one owner, one billing account, several businesses", that is wrong — but it is a
*product* question, not an idempotency question, and it is why this RPC is
separate from C10 rather than folded into it.

```sql
fn_create_business_in_account(
  p_account_id uuid, p_business_name text,
  p_business_type business_type, p_timezone text default 'Africa/Lagos')
```

Requires `fn_has_account_role(p_account_id,'owner')`. Creates the business, its
'Main' location, `business_settings` and 'Direct' channel. **No account, no
membership beyond the existing one, no second subscription.** `businesses unique
(account_id, slug)` already prevents a duplicate name within an account.

**Decision needed from you:** should a second key create a second *account*
(current behaviour, second trial) or should additional businesses live under the
first account? I recommend the latter, with C10 shipping first and this RPC
following.

---

## 11. Migration and backward compatibility

1. **The signature change creates a new function object.** `0011` and `0016`
   grant EXECUTE against the exact 7-argument signature. The migration must
   `drop function` the old signature and grant the new one, or two overloads
   coexist and PostgREST resolves ambiguously. This is the riskiest step; it
   needs its own self-check asserting exactly one overload survives.
2. **The Part 5 gate hard-codes the old signature** in the
   `has_function_privilege('authenticated','fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)','EXECUTE')`
   check. It must be updated in the same migration or the gate will STOP.
3. **Test 010 must stay 5/5** — `onboarding_requests` must not widen the anon surface.
4. **No data migration.** Production holds **0 accounts**, so there is no
   backfill and no question of which duplicate is canonical.
5. **The existing frontend does not yet call this RPC in production** (no users
   exist), so requiring the key breaks no live caller. **This is the cheapest
   this change will ever be.** After the first user, requiring a new parameter
   means coordinating a client release with a schema change.

---

## 12. Test matrix

| # | Test | Expected |
|---|---|---|
| 1 | Double-click: two identical submits, same key | One tenant; second returns `idempotent_replay: true` |
| 2 | Timeout-after-commit: client times out, retries same key | Replay of the original result; no duplicate |
| 3 | Two concurrent requests, same key | Exactly one tenant (T5) |
| 4 | Same, advisory lock removed | Still exactly one tenant, zero orphan accounts (T6) |
| 5 | Same key, different payload | Explicit 409-class error; nothing created (T3) |
| 6 | Same key, payload differing only in trailing whitespace | Treated as identical → replay |
| 7 | Same key, payload differing only in letter case | Treated as **different** → error |
| 8 | Failed call (blank name), then retry with same key | Retry succeeds (T8) |
| 9 | Transaction rolled back after success, then retry | Retry succeeds; no half state (T7, T8) |
| 10 | Different key, same user | Second business created (T4) |
| 11 | Same key string, **different** user | Each gets its own tenant; keys are per-user |
| 12 | Null or blank key | Rejected, `22023` |
| 13 | `anon` calls the RPC | Refused; anon holds EXECUTE on no `fn_*` |
| 14 | User A passes user B's `p_user_id` | Refused, `42501` — existing check, must not regress |
| 15 | Exactly one overload of the function exists after migration | 1 |
| 16 | Test 010 re-run | 5/5 |
| 17 | Full Part 5 gate after the signature check is updated | 26 PASS |
| 18 | `fn_create_business_in_account` as owner / non-owner / duplicate name | Created / refused / refused |

Tests 3, 4, 5 and 9 are the ones that prove the design; the rest prove nothing
else broke.

---

## 13. What I need from you

1. Confirm removal of `p_allow_additional` (§0).
2. Keep or drop the advisory lock (§7) — either is correct; I recommend keeping it.
3. Confirm permanent key retention (§6).
4. Confirm the client generates the key (§8) — only the client knows whether a
   submit is a retry or a new attempt.
5. Decide the multi-business question in §10.
6. Confirm this lands before the first production user (§11.5).

No code until you approve.
