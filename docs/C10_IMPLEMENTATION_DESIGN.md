# C10 — Idempotent Onboarding: Implementation Design

**Status: design for review. No SQL to execute. Nothing applied.**

Baseline captured from production:

```
fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)
one overload · owner postgres · SECURITY DEFINER · search_path=public
EXECUTE: authenticated, service_role   (anon: none)
md5 71aff1dbc2e89d11383d77e1cbf1f967 · 2771 bytes
```

**Note on that byte count.** My reference build produces 2714 bytes; production
reports 2771. The 57-byte difference is 57 CRLF line endings — PART_4 was
CRLF-converted when it was pasted, exactly as 0019c later was. **The C10
rollback must therefore be base64-driven**, like 0019c's, not literal SQL.

**I still need the base64 payload from row 4 of the capture.** It was taken but
not returned. Without it I cannot author a byte-exact rollback, and I will not
write one from a transcription.

---

## 1. The exact idempotency contract

Let `K` be the idempotency key, `U` the caller (`auth.uid()`), and `F` a
fingerprint of the onboarding payload.

| Input | Behaviour | Rows created |
|---|---|---|
| `(U, K)` unseen, U owns no account | **Create account + business** | account, owner membership, business, Main location, business_settings, Direct channel, 180 ingredients, trial subscription, 1 `onboarding_requests` row |
| `(U, K)` unseen, U already owns an account | **Create business inside that account** | business, its Main location, business_settings, Direct channel, 1 `onboarding_requests` row. **No account. No membership. No subscription. No re-clone.** |
| `(U, K)` seen, `F` matches | **Replay** — return the stored result | **nothing** |
| `(U, K)` seen, `F` differs | **Refuse**, SQLSTATE `23505` | **nothing** |
| `K` null or blank | **Refuse**, SQLSTATE `22023` | **nothing** |
| Two concurrent calls, same `(U, K)` | Exactly one provisions; the other replays it | one tenant only |
| Transaction rolled back | Key row rolls back with it → same `K` retries cleanly | nothing persists |
| Key lifetime | **Permanent**, removed only by `ON DELETE CASCADE` | — |

The third row is the approved product decision: **one account may own many
businesses**, and a different key adds a business to the existing account
rather than minting a second account and a second trial.

### Which account, when the user already owns one

A new optional parameter `p_account_id` resolves it:

| `p_account_id` | User owns… | Behaviour |
|---|---|---|
| null | 0 accounts | create a new account |
| null | exactly 1 | use it |
| null | more than 1 | **refuse as ambiguous** — the caller must name one |
| supplied | — | must hold `owner` on it, else `42501` |

This never silently guesses. Ambiguity is refused, not resolved.

---

## 2. Schema changes

```sql
create table onboarding_requests (
  user_id             uuid    not null references auth.users(id) on delete cascade,
  idempotency_key     text    not null,
  payload_fingerprint text    not null,
  account_id          uuid    not null references accounts(id)   on delete cascade,
  business_id         uuid    not null references businesses(id) on delete cascade,
  location_id         uuid    not null,
  ingredients_added   integer not null,
  account_created     boolean not null,
  created_at          timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

alter table onboarding_requests enable row level security;

create policy p_onboarding_requests on onboarding_requests
  for select to authenticated
  using (user_id = auth.uid());

grant select on onboarding_requests to authenticated;
-- anon: nothing. service_role: unchanged by us.
```

`primary key (user_id, idempotency_key)` **is** the guarantee. Not application
logic, not a convention — a database constraint no client can bypass. Keys are
namespaced per user, so two users may independently use the string `"123"`.

The policy is scoped `to authenticated` deliberately, following the 0018
section 7 lesson: an unscoped policy calling nothing is fine today, but scoping
it keeps `anon` from ever evaluating it.

### Counts these change — the gates must be updated in the same migration

| | Before | After |
|---|---|---|
| public relations | 43 | **44** |
| policies | 92 | **93** |
| `fn_*` functions | 40 | 40 (unchanged — the RPC keeps its name) |

---

## 3. Signature change

```sql
fn_create_account_and_business(
  p_account_name    text,
  p_business_name   text,
  p_business_type   business_type,
  p_user_id         uuid    default null,
  p_currency        text    default 'NGN',
  p_timezone        text    default 'Africa/Lagos',
  p_trial_days      integer default 14,
  p_idempotency_key text    default null,   -- NEW, required in effect
  p_account_id      uuid    default null    -- NEW, optional
)
```

Declared `default null` but rejected when null, so a caller omitting the key
gets a clear message rather than PostgREST's confusing "function not found".

**This creates a new function object.** The migration must:

1. `drop function public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer);`
2. create the new one;
3. `grant execute ... to authenticated;` — and confirm `service_role` matches the captured baseline;
4. self-check that **exactly one overload** survives.

Step 4 matters most: two overloads would let PostgREST resolve ambiguously by
body keys, which is a correctness bug that no gate currently catches.

---

## 4. Replay behaviour

### Payload fingerprint

```sql
v_fingerprint := md5(jsonb_build_object(
  'account_name',  btrim(p_account_name),
  'business_name', btrim(p_business_name),
  'business_type', p_business_type::text,
  'currency',      upper(btrim(coalesce(p_currency,'NGN'))),
  'timezone',      btrim(coalesce(p_timezone,'Africa/Lagos')),
  'trial_days',    coalesce(p_trial_days,14),
  'account_id',    coalesce(p_account_id::text,'')
)::text);
```

`jsonb`, not `json`, because jsonb normalises key order — the text form is
canonical. Normalisation is whitespace-only, plus case-folding for currency.
**"Mama Nkechi" and "mama nkechi" are different payloads**: a capitalisation
change is a real change the user should be told about, not silently ignored.

### What is persisted and what is replayed

Stored: `account_id`, `business_id`, `location_id`, `ingredients_added`,
`account_created`, `payload_fingerprint`, `created_at`.

Replayed:

```json
{ "account_id": "…", "business_id": "…", "location_id": "…",
  "ingredients_added": 180, "account_created": true,
  "idempotent_replay": true, "originally_created_at": "…",
  "next_step": "<recomputed from current state>" }
```

`next_step` is **recomputed**, not stored. A replay months later must not claim
`enter_your_own_prices` if the owner has since entered prices.

### Same key, different payload

Raised with SQLSTATE `23505`, which PostgREST maps to HTTP 409 Conflict. **That
mapping must be confirmed against the deployed PostgREST version during
implementation**; if it differs, set `response.status` explicitly instead.

---

## 5. Concurrency behaviour

```
pg_advisory_xact_lock(hashtextextended(v_user::text, 0))
  ↓
look up (user, key) → replay if found
  ↓
begin
  provision
  insert into onboarding_requests
exception when unique_violation then
  -- the whole block, including provisioning, rolls back
  re-read the key row and return the winner's result
end
```

**The unique constraint is the guarantee; the advisory lock is an
optimisation.** Both were tested on a replica:

| | Result |
|---|---|
| Concurrent same key, **lock on** | one provisioned, one replayed the same ids — **1 account** |
| Concurrent same key, **lock off** | loser hit the `23505` handler, rolled its provisioning back, returned the winner's ids — **1 account, 0 orphan accounts** |

The lock only prevents the loser doing ~180 ingredient inserts it will discard.
It changes no semantics, is per-user, transaction-scoped and cannot leak.

---

## 6. Atomicity

1. PostgREST runs each RPC call in **one transaction**.
2. This is a `FUNCTION`, not a `PROCEDURE` — it **cannot** `COMMIT`. There is no
   intermediate commit point available to it.
3. Provisioning and the key insert are in the same `BEGIN … EXCEPTION` block.
4. The only handler catches `unique_violation` and **returns a replay** — it
   never falls through to continue provisioning. That is the single property
   that could reintroduce a window, and it must be enforced by review.

Verified: a transaction that ran the function and was then rolled back left
`key rows = 0, accounts = 0`. **No half state in either direction.**

---

## 7. A useful property already present

`fn_clone_starter_catalog` is keyed on **account**, not business, and its
inserts carry `not exists` guards. So even if it were called again for the same
account it would insert nothing. The second-business path will not call it at
all, but this is a second line of defence against the specific trap of
double-cloning 180 ingredients.

Likewise `fn_is_account_member` is **account-scoped**:

```sql
select exists (select 1 from memberships
                where account_id = p_account_id and user_id = auth.uid());
```

`business_id` is not consulted, so the existing account-level owner membership
already covers every business in the account. **A second business needs no new
membership row** — confirmed from the definition, not assumed.

---

## 8. Rollback strategy

Symmetric with 0019c, and base64-driven for the same reason.

```
1. drop function fn_create_account_and_business(…9 args…);
2. restore the captured 7-arg definition from base64,
   verified against md5 71aff1dbc2e89d11383d77e1cbf1f967 and 2771 bytes
   -- refuses to execute if either differs;
3. grant execute to authenticated (and service_role per the baseline);
4. drop policy p_onboarding_requests; drop table onboarding_requests;
5. self-check: exactly one overload, md5 restored, table gone,
   relations back to 43, policies back to 92.
```

**Data loss on rollback:** every `onboarding_requests` row. That is acceptable
only while the table is empty or holds test rows. **Once real users have
onboarded, rolling back discards their retry protection** — the tenants
survive, but a subsequent retry could then duplicate. Rollback is therefore a
short-window option, not an indefinite one, and that should be stated in the
runbook.

---

## 9. Acceptance tests

Run against a replica first, then production with `begin; … rollback;`.

| # | Test | Expected |
|---|---|---|
| 1 | First call, key K1 | account + business + 180 ingredients + trial; `idempotent_replay: false` |
| 2 | Same key, same payload | **replay**, identical ids, **no new rows** |
| 3 | Same key, different payload | refused `23505`, nothing created |
| 4 | Different key K2, same user | **business added to the SAME account**; accounts unchanged, **subscriptions unchanged**, **ingredients NOT re-cloned** |
| 5 | Two concurrent calls, same key | exactly one tenant |
| 6 | Same, advisory lock removed | exactly one tenant, zero orphan accounts |
| 7 | Rollback then retry with same key | succeeds |
| 8 | Null / blank key | refused `22023` |
| 9 | Same key string, different user | each gets its own tenant |
| 10 | User A passes user B's `p_user_id` | refused `42501` — existing check must not regress |
| 11 | `p_account_id` for an account the user does not own | refused |
| 12 | `p_account_id` null while the user owns two accounts | refused as ambiguous |
| 13 | Duplicate business name in one account | refused by `businesses(account_id, slug)` |
| 14 | `anon` calls the RPC | refused; anon holds EXECUTE on no `fn_*` |
| 15 | Exactly one overload after migration | 1 |
| 16 | `tests/010_anon_reference_read.sql` | still 5 PASS — the new table must not widen the anon surface |
| 17 | Updated gates | PASS at 44 relations / 93 policies |
| 18 | Signup acceptance test | still passes end to end |

Tests **4, 5, 6 and 12** are the ones that prove this design. The rest prove
nothing else broke.

---

## 10. What I need before writing SQL

1. **The base64 payload** from row 4 of the C10 baseline capture. Without it
   there is no byte-exact rollback.
2. **Approval of the `p_account_id` resolution rule** in §1 — specifically that
   ambiguity is refused rather than guessed.
3. **Confirmation** that discarding `onboarding_requests` on rollback (§8) is
   acceptable, given it is empty today.

Nothing will be written until those are settled.
