# DEPLOYMENT RUNBOOK — 0052 (search_path · foreign-key indexes · billing_config)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0051 applied**, 117 policies, 77 `fn_*` functions,
no `ix_fk_*` index, 23 functions without a `search_path`.

## What changes

| | |
|---|---|
| 23 functions | `set search_path = public` — every trigger function and helper that had none. Bodies untouched |
| 138 indexes | one covering index per uncovered foreign key, named `ix_fk_<table>_<columns>` |
| 1 grant | `revoke select on billing_config from anon` — **separable section 3**; strike it before running if you disagree |
| Tables, columns, policies, functions, rows | **none**. 117 policies and 77 functions before and after |

Every statement was **generated** from a repository-built replica that matches
production to the object count, not typed. Source: the Supabase security and
performance advisors read against production on 10 September.

### Why `public`, not `''`

Supabase's remediation suggests an empty `search_path` with fully-qualified
names. These function bodies use unqualified table names (`from subscriptions`),
so `''` would break them at first call. Every `SECURITY DEFINER` function in
this schema already pins `public`; the 23 now match.

### Why revoke `anon` on `billing_config`

No page and no edge function reads the table. Its only reader is
`fn_payment_failure_grace()`, which is `SECURITY DEFINER` and needs no client
grant; 0049 already describes the table as service-context only. The 0032
`anon` grant widened the anonymous surface to six tables for no caller, and
three suites have reported "expected five, found six" ever since.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0052.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0052_search_path_and_fk_indexes.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0052.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0052_rollback.sql` | psql, only if 3 fails | yes |

```
psql "<session-pooler connection string>" \
     --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0052_search_path_and_fk_indexes.sql
```

Expect **PRE 8/8**, one `NOTICE: 0052 OK: …`, **POST 8/8**. Same transaction
guard as 0049–0051; it refuses the SQL Editor.

After POST passes, `git mv` the file from `proposed/` to `migrations/` — that
move is the record that it is live.

## Rollback

Resets the 23 `search_path`s, drops the 138 indexes, restores the 0032 grant.
Byte-faithful to 0051. Available at any time — 0052 writes no data, so there
is no window that closes.

## Rehearsal results

| Item | Result |
|---|---|
| PRE / apply / POST | 8/8 · `0052 OK` · 8/8 |
| `tests/038` | **12 / 12** |
| Atomicity | 2 injected failures, both byte-identical afterwards; wrong executor refused |
| Rollback | byte-faithful to 0051 |
| Every suite, 0051 → 0052 | 736/5 → **761/2**; 011 and 017 turn green, 015 3→2, nothing else moves |

Raw output: `evidence/REHEARSAL_0052.txt`.
