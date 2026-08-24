# C10 — Idempotent Onboarding: Design Proposal

**Status:** design only. Nothing implemented, nothing applied. Awaiting approval.

---

## 1. The defect, precisely

`fn_create_account_and_business` is safe on failure and unsafe on success.

| Scenario | Observed on the replica | Verdict |
|---|---|---|
| Call fails (blank business name) | `ERROR: Account name and business name are required`; `accounts=0 memberships=0 businesses=0 locations=0 subscriptions=0 ingredients=0` | **Correct.** One transaction, no partial state. |
| Retry after that failure | Succeeds, `ingredients_added=180` | **Correct.** Failed calls are safely retryable. |
| Call **succeeds twice** | `accounts=2, businesses=2, memberships=2, subscriptions=2, ingredients=360` | **The defect.** Two tenants, two trials, two catalogues. |

A double-click, or any client retry after a timeout where the server actually
committed, silently duplicates the tenant. The user then owns two accounts and
cannot tell which one their data is in.

**Why nothing currently stops it.** The function takes no idempotency key, holds
no lock, and creates a brand-new `accounts` row every call. The uniqueness that
exists — `businesses unique (account_id, slug)`, `memberships unique (account_id,
business_id, user_id)`, and `ux_subscriptions_account` from 0017 — is all scoped
*within* an account, so a fresh account collides with nothing.

**Related gap.** There is no RPC that adds a business to an *existing* account.
`fn_create_account_and_business` is the only business-creating entry point in the
chain. So today the only way a user gets a second business is by accidentally
creating a second account — the bug is doubling as the missing feature.

---

## 2. Requirements, and how the design meets each

| Your requirement | How it is met |
|---|---|
| Double-clicks, network retries, timeout retries must not duplicate | Client-supplied idempotency key + a primary key on `(user_id, idempotency_key)`. A replay returns the original result. |
| A failed transaction stays retryable | The key row is written inside the same transaction, so a rollback removes it. Retrying with the same key finds nothing and proceeds normally. |
| Legitimate multi-business must remain possible | A separate `fn_create_business_in_account` RPC, plus an explicit `p_allow_additional` flag on the onboarding RPC. |
| Do not cap every `auth.uid()` at one account | No such constraint. The guard is *default-deny with an explicit override*, not a hard limit. |
| Server-enforced, not a disabled frontend button | The guarantee is a database primary key plus an advisory lock. A malicious or buggy client cannot bypass it. |

---

## 3. Recommended design

### 3.1 Schema — one new table

```sql
create table onboarding_requests (
  user_id         uuid  not null references auth.users(id) on delete cascade,
  idempotency_key text  not null,
  account_id      uuid  not null references accounts(id)   on delete cascade,
  business_id     uuid  not null references businesses(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
```

The primary key **is** the guarantee. It is not advisory, not a convention, and
not bypassable by the client.

RLS: enable, with `p_onboarding_requests` allowing a user to see only their own
rows (`user_id = auth.uid()`). Grants follow the 0018 pattern — `authenticated`
gets SELECT only; the RPC writes it as SECURITY DEFINER. `anon` gets nothing.

*Rejected alternative:* an `idempotency_key` column on `accounts`. It conflates
the request log with the tenant record, cannot express "this key produced this
business", and leaves nowhere to record a key whose account was later deleted.

### 3.2 RPC signature

```sql
fn_create_account_and_business(
  p_account_name     text,
  p_business_name    text,
  p_business_type    business_type,
  p_user_id          uuid    default null,
  p_currency         text    default 'NGN',
  p_timezone         text    default 'Africa/Lagos',
  p_trial_days       integer default 14,
  p_idempotency_key  text    default null,   -- NEW, trailing
  p_allow_additional boolean default false   -- NEW, trailing
)
```

Both new parameters are trailing and defaulted, so PostgREST resolves existing
call bodies unchanged.

### 3.3 Control flow

```
1. authorize exactly as today
     auth.uid() must be non-null and must equal p_user_id
     the auth.users row must exist
     names must be non-blank

2. pg_advisory_xact_lock(hashtextextended(v_user::text, 0))
     serialises concurrent onboarding for ONE user only.
     Released automatically at commit or rollback -- never leaks.

3. if p_idempotency_key is not null:
     look up (v_user, p_idempotency_key) in onboarding_requests
     FOUND -> return the stored account_id / business_id with
              idempotent_replay = true.  Create NOTHING.

4. if the caller already owns an account
        and p_idempotency_key is null
        and p_allow_additional is false:
     raise 'You already have a Menu Master account. Pass an idempotency key
            to retry safely, or set p_allow_additional to create a second
            account deliberately.'  using errcode = '23505'

5. create everything, exactly as today, in one transaction

6. if p_idempotency_key is not null:
     insert into onboarding_requests(...)

7. return { ..., idempotent_replay: false }
```

**Why both the lock and the key.** The primary key alone makes concurrent
duplicates *impossible*, but the loser of the race gets a raw `23505` rather than
the original result. The advisory lock makes the second caller wait and then take
the clean replay path in step 3. Belt and braces, and the belt is the constraint.

**Why step 4 exists.** It protects callers that forget to send a key — the exact
population most likely to double-submit. It is default-deny with an explicit,
documented override, so it never permanently limits anyone.

### 3.4 The multi-business RPC

```sql
fn_create_business_in_account(
  p_account_id    uuid,
  p_business_name text,
  p_business_type business_type,
  p_timezone      text default 'Africa/Lagos'
) returns jsonb
```

Requires `fn_has_account_role(p_account_id, 'owner')`. Creates the business, its
'Main' location, its business_settings and its 'Direct' channel. **Creates no
account, no membership row beyond the existing one, and no second subscription.**
`businesses unique (account_id, slug)` already prevents a duplicate business name
within the account, so this RPC is naturally idempotent on name.

This is where legitimate growth belongs. With it in place,
`fn_create_account_and_business` can be strict without blocking anybody.

---

## 4. Alternatives considered and rejected

| Option | Why rejected |
|---|---|
| Unique index on `memberships(user_id) where role='owner'` | Permanently caps every user at one owned account. You explicitly ruled this out, and it would break agencies and multi-brand owners. |
| Return the existing account whenever the user has one | Silently ignores a deliberate second-business request and returns the wrong `account_id`. Silent wrong answers are worse than loud refusals. |
| Frontend button-disable only | Not server-enforced. Fails on network retry, browser back-button, duplicate tab and any non-browser client. |
| Dedupe on `(user_id, account_name)` | Names are user text. "Mama Nkechi Foods" typed twice is indistinguishable from a genuine second brand of the same name. |
| `ON CONFLICT DO NOTHING` inside the function | Nothing to conflict on — every call mints a fresh `accounts.id`. |

---

## 5. Backward compatibility

1. **The signature change creates a new function object.** `0011` and `0016`
   grant EXECUTE against the exact 7-argument signature. The migration must
   `drop function` the old signature and re-grant the new one, or two overloads
   will coexist and PostgREST will resolve ambiguously. This is the single
   riskiest step and needs its own self-check.
2. **The Part 5 gate hard-codes the old signature** in the check
   `has_function_privilege('authenticated','fn_create_account_and_business(text,
   text,business_type,uuid,text,text,integer)','EXECUTE')`. It must be updated in
   the same migration, or the gate will STOP.
3. **Existing callers keep working.** Trailing defaulted parameters mean an old
   request body still resolves — it simply gets step 4's protection instead of
   step 3's.
4. **No data migration.** Production holds **0 accounts**, so there is no
   backfill, no ambiguity about which duplicate is canonical, and no cleanup.
   **This is the cheapest moment this change will ever be — it should land before
   the first real user, not after.**
5. **`0017` interaction.** `ux_subscriptions_account` guarantees one subscription
   per account. Replay creates no account, so it creates no second trial. The two
   mechanisms compose correctly.

---

## 6. Test plan

| # | Test | Expected |
|---|---|---|
| 1 | Call twice with the **same** key | One tenant. Second returns `idempotent_replay: true` and the identical ids. `accounts=1, ingredients=180`. |
| 2 | Call, fail on blank name, retry with the **same** key | Retry succeeds. No `onboarding_requests` row survived the rollback. |
| 3 | Call twice with **different** keys, `p_allow_additional=false` | Second refused, `23505`, with the guidance message. |
| 4 | Call twice with different keys, `p_allow_additional=true` | Two accounts, deliberately. `subscriptions=2`, one per account. |
| 5 | Legacy call (no key) by an already-onboarded user | Refused by step 4. |
| 6 | Legacy call (no key) by a brand-new user | Succeeds — no regression for first-time signup. |
| 7 | **Two concurrent sessions, same key** | Exactly one tenant. The second blocks on the advisory lock, then replays. Requires two real connections, not one script. |
| 8 | Two concurrent sessions, same key, advisory lock removed | Must still yield one tenant — proves the primary key, not the lock, is the guarantee. |
| 9 | Replay by a **different** user with the same key string | Creates its own tenant. Keys are namespaced by `user_id`. |
| 10 | `fn_create_business_in_account` as owner | Adds business + location + settings + channel. `accounts` and `subscriptions` unchanged. |
| 11 | Same, as a non-owner member | Refused. |
| 12 | Same, duplicate business name in one account | Refused by `unique (account_id, slug)`. |
| 13 | `anon` calls either RPC | Refused; `anon` holds EXECUTE on neither. |
| 14 | Test 010 re-run | Still 5/5 — the new table must not widen the anon surface. |
| 15 | Full Part 5 gate | 26 PASS after the signature check is updated. |

Tests 7 and 8 are the ones that actually prove the design; the rest prove it
did not break anything.

---

## 7. What I need from you

1. Approve or amend the mechanism (key + PK + advisory lock + `p_allow_additional`).
2. Confirm `fn_create_business_in_account` is wanted — it is what keeps
   multi-business ownership possible while the onboarding RPC turns strict.
3. Decide whether the client generates the idempotency key (a UUID minted once
   per onboarding form, reused across retries) or whether you want it derived
   server-side. **Recommendation: client-generated**, because only the client
   knows that a retry is the *same* attempt rather than a new one.
4. Confirm this lands **before** the first production user, while the zero-account
   window makes it free.

No code will be written until you approve.
