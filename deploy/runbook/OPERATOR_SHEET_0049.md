# OPERATOR SHEET — 0049

**Nothing here has been executed. Production is untouched and still at 0048.**

Windows · PostgreSQL 17.11 `psql` client · Supabase project `mgbrrrjxbufstsjrdoug`
(eu-west-2) · target branch the head commit of `claude/menu-master-ng-migrations-3faerm` (**local only, not pushed**).

A newer client against an older server is fine — `psql` 17.11 talking to
PostgreSQL 17.6.1.155 is a supported combination and no artefact here uses a
client-version-specific feature.

---

## ⛔ BLOCKER 0 — you do not have these files yet

`0049` lives on the head commit of the working branch, which exists **only inside this session's
container** and has not been pushed. Your Windows clone does not contain
`migrations/proposed/0049_billing_tiers_and_founders.sql`. There is nothing to
point `-f` at.

Worse, the container is ephemeral. If this session ends, that commit is gone and
the whole rehearsal has to be redone.

Three ways to get the files, best first:

1. **Push it** (needs your go-ahead — you have said not to). The commit
   touches only `migrations/`, `tests/`, `scripts/` and `deploy/runbook/`;
   **nothing under `web/`**, so a Vercel build from it produces a byte-identical
   frontend. It is still a deployment event, which is why I have not done it.
2. **Push it to a different, non-tracked branch** — say
   `claude/0049-artifacts` — which Vercel does not build. Say the word and I
   will. This gets you the files with no deployment of any kind.
3. **Copy-paste**, worst option. See BLOCKER 2: copy-paste will break the
   hash verification in §2, because Windows will save the file with CRLF line
   endings and change every hash below.

**Until one of these is done, steps 1–7 below cannot be run.**

---

## 1. The exact local file containing the certified migration

```
migrations/proposed/0049_billing_tiers_and_founders.sql
```

523 lines. Pure SQL — no `psql` meta-commands (`\i`, `\copy`, `\set`), so it is
safe to run with `-f`. It contains **no `BEGIN` and no `COMMIT` of its own**:
the transaction is owned by `psql`, deliberately, which is why §4 is not
optional.

Supporting artefacts, same directory tree:

| Purpose | File |
|---|---|
| preflight (read-only) | `deploy/runbook/PRE_DEPLOY_0049.sql` |
| post-verify (read-only) | `deploy/runbook/POST_VERIFY_0049.sql` |
| rollback | `migrations/proposed/0049_rollback.sql` |
| runbook | `deploy/runbook/DEPLOY_0049.md` |
| gate report | `deploy/runbook/PRE_PRODUCTION_GATE_0049.md` |
| raw rehearsal output | `deploy/runbook/evidence/REHEARSAL_0049.txt` |

## 2. The exact hashes to verify before execution

**SHA-256, of the LF (Unix) form of each file:**

```
a659b36e03eb1d7eb014baaef81f5fa4f067212874cdf51dd338fdf265d69883  migrations/proposed/0049_billing_tiers_and_founders.sql
dc35b13a6fc25e6ef0ac4fafbc86c864a6a8c4820e8a5e028b5161a5a044c26a  migrations/proposed/0049_rollback.sql
fd0df028c1f57f129c9b77543de261f69f4870444ec354684dc8a61339597289  deploy/runbook/PRE_DEPLOY_0049.sql
4c8b3af6100266ea34818fbf87a08f1f39c7931abaa06585a83b67f4f3f7f5e8  deploy/runbook/POST_VERIFY_0049.sql
```

MD5 of the forward migration, for cross-checking against the gate report:
`6640bc6c1ed71315b814af1b6af15776`.

**Verify in PowerShell:**

```powershell
Get-FileHash -Algorithm SHA256 `
  migrations\proposed\0049_billing_tiers_and_founders.sql,
  migrations\proposed\0049_rollback.sql,
  deploy\runbook\PRE_DEPLOY_0049.sql,
  deploy\runbook\POST_VERIFY_0049.sql |
  Format-List Path, Hash
```

`Get-FileHash` prints uppercase; compare case-insensitively.

### ⚠️ BLOCKER 2 — line endings will break this

These hashes are of the **LF** form. If you obtain the files by copy-paste, or
if `git config core.autocrlf` is `true` on your Windows clone, the working-tree
file will be **CRLF** and every hash above will mismatch — a false alarm that
looks exactly like tampering.

Fix it by verifying what git actually recorded, which is CRLF-independent:

```powershell
git rev-parse "HEAD:migrations/proposed/0049_billing_tiers_and_founders.sql"
git cat-file blob "HEAD:migrations/proposed/0049_billing_tiers_and_founders.sql" | Measure-Object -Line
```

The blob hash is git's own SHA-1 of the LF content and is the same on every
platform. Expect **523** lines.

CRLF does **not** affect execution — PostgreSQL treats `\r\n` as whitespace, and
the rehearsal covers the SQL semantics, not the byte encoding. It only breaks
the hash check.

## 3. The exact `psql` command, prompting interactively for the password

**The password never appears in the command, in your history, or in this chat.**
Passing `-W` makes `psql` prompt before connecting. Do not use a `postgresql://`
URI — a URI puts the password in the string, and therefore in
`(Get-PSReadlineOption).HistorySavePath`.

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" `
    -h aws-0-eu-west-2.pooler.supabase.com `
    -p 5432 `
    -U postgres.mgbrrrjxbufstsjrdoug `
    -d postgres `
    -W `
    --single-transaction `
    -v ON_ERROR_STOP=1 `
    -f migrations\proposed\0049_billing_tiers_and_founders.sql
```

### ⚠️ BLOCKER 3 — why your manual attempt returned "password authentication failed"

**The Session Pooler username is not `postgres`.** It is
`postgres.<project-ref>` — for you, `postgres.mgbrrrjxbufstsjrdoug`. The pooler
uses the suffix to route to your project. Connect as bare `postgres` with a
perfectly correct password and it fails with exactly the message you saw, which
is why it reads as a password problem when it is a username problem.

That is by far the most likely cause. The other two, in order:

* **Wrong pooler host.** I have written `aws-0-eu-west-2.pooler.supabase.com`
  above from the standard eu-west-2 pattern, but **I have not verified it** and
  I will not connect to production to find out. The `aws-0-` / `aws-1-` prefix
  varies by when the project was created. Confirm the host from the dashboard,
  or resolve both and see which answers.
* **The password itself.** If the username is right and it still fails, reset it
  at Dashboard → Project Settings → Database → Reset database password. That
  changes only the Postgres password; it does not touch the API keys, the
  `service_role` key, or anything the deployed app uses. Do not tell me the new
  one.

### If the Connect panel will not render

Everything you need can be assembled without it: host is
`aws-0-eu-west-2.pooler.supabase.com` or `aws-1-…` (region eu-west-2, from your
project settings), port `5432`, user `postgres.mgbrrrjxbufstsjrdoug`, database
`postgres`. Only the password must come from you.

### ⚠️ Port 5432, never 6543

| Port | Pooler mode | Verdict |
|---|---|---|
| **5432** | **session** | **the only correct choice** |
| 6543 | transaction | **will corrupt this deployment** |

The transaction pooler on 6543 hands each statement to a possibly different
backend. `--single-transaction` cannot hold across that, so 0049 would either
abort at its own transaction guard or, worse, apply piecemeal. Use 5432.

## 4. Required flags, and why each is load-bearing

| Flag | Required | What it does |
|---|---|---|
| `--single-transaction` | **yes** | Wraps the whole file in one transaction. 0049 has no `BEGIN`/`COMMIT` of its own, so **this flag is the atomicity**. |
| `-v ON_ERROR_STOP=1` | **yes** | Without it `psql` carries on past an error and commits the surviving statements at the end. |
| `-W` | recommended | Prompts for the password so it never reaches history. |
| `-f <file>` | yes | Runs the file. Do not pipe with `<`; `-f` gives correct file/line numbers in errors. |
| `-1` | — | Same as `--single-transaction`. Use whichever, not both. |
| `-e`, `-a` | optional | Echo statements. Useful for a transcript; noisy. |

**Both required flags, or do not run it.** Rehearsal, four separate injected
failures — including one with an RLS write policy dropped and not yet
recreated — left the schema **byte-identical to 0048** under these flags. The
same file under an autocommit executor left **68 catalogue differences** behind,
including `p_orders_insert` dropped and never recreated, i.e. orders unwritable
by anyone.

0049's first executable statement detects a non-transactional executor and
aborts before touching a single object:

```
ERROR:  0049 ABORT: this executor is not honouring transaction control
```

So a mistake here fails safe. **This also means 0049 cannot be pasted into the
Supabase SQL Editor** — it will refuse. That is deliberate.

## 5. The read-only preflight, immediately before 0049

`deploy/runbook/PRE_DEPLOY_0049.sql` — a single `SELECT`, writes nothing.
Pasteable into the SQL Editor, or:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" `
    -h aws-0-eu-west-2.pooler.supabase.com -p 5432 `
    -U postgres.mgbrrrjxbufstsjrdoug -d postgres -W `
    -f deploy\runbook\PRE_DEPLOY_0049.sql
```

**Expect 18 rows, every `result` = `PASS`.** Any FAIL stops the deployment.

Rows 1–3 pin identity: fingerprint `e24f3871788893cafd1fc17c70fe41d5`, 70 `fn_*`
functions, 116 policies. Rows 4–10 confirm the dependencies. Rows 11–17 confirm
no part of 0049 is already present. It fails closed — on a database already at
0049 it returns 11 FAILs.

**Read row 18 before you commit to anything.** It lists every plan and its
subscriber count. If any account is on plan `costing` and currently entitled,
that account loses the ability to record sales the moment 0049 commits. That is
the intended product change, but it is a live behavioural change and you should
know it is happening before it happens, not after.

## 6. The post-deployment verification

`deploy/runbook/POST_VERIFY_0049.sql` — a single `SELECT`, writes nothing. Run
it **immediately** after step 3 succeeds.

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" `
    -h aws-0-eu-west-2.pooler.supabase.com -p 5432 `
    -U postgres.mgbrrrjxbufstsjrdoug -d postgres -W `
    -f deploy\runbook\POST_VERIFY_0049.sql
```

**Expect 20 rows, every `result` = `PASS`.** It re-proves against the live
catalogue: the new columns and tables; exactly 100 slots numbered 1..100 with
none claimed; the cap enforced by a CHECK; one account cannot hold two; the four
prices in kobo; no active paid plan at ₦0; `fn_account_has_sales` present,
`SECURITY DEFINER`, and refusing non-members; **exactly 13 write policies gated
and exactly 0 read policies gated**; policy count 117; `authenticated` cannot
allocate a slot; `anon` can call none of the new functions; and every
pre-existing subscription still resolves to a real plan.

## 7. STOP conditions and rollback

### Success looks like exactly this

```
NOTICE:  0049 OK: 13 Sales write policies gated, 5 SELECT policies untouched,
100 founder slots seeded, the pre-existing 116 policies unchanged.
```

One `NOTICE`, no `ERROR`, `psql` exits 0. Anything else means the transaction
rolled back and **production is still at 0048** — verified four times in
rehearsal. Check with `$LASTEXITCODE`.

### STOP conditions

| # | Condition | Action |
|---|---|---|
| S1 | Any preflight row is FAIL | **Do not run 0049.** Send me the 18 rows. |
| S2 | Preflight row 18 shows an entitled account on `costing` | **Stop and decide.** That account loses Sales on commit. |
| S3 | `0049 ABORT: this executor is not honouring transaction control` | You dropped a flag or used port 6543. Nothing changed. Fix the command. |
| S4 | Any `0049 preflight FAILED: …` | 0049 is partly present, or production is not at 0048. Nothing changed. Send me the message. |
| S5 | Any `0049 self-check FAILED: …` | The migration rolled itself back. Nothing changed. Send me the message. |
| S6 | Connection drops mid-run | The transaction is aborted server-side; the backend rolls it back. **Do not rerun blind** — run the preflight; 18/18 PASS means nothing was applied. |
| S7 | Any post-verify row is FAIL | 0049 **has committed**. Go to rollback. Send me the 20 rows first. |
| S8 | Anything unexpected at all | Stop. Change nothing further. Send me the exact text. |

**Never** rerun 0049 after a failure without running the preflight first. The
preflight is what tells you which side of the commit you are on.

### Rollback

Only for S7 — a committed 0049 that failed verification.

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" `
    -h aws-0-eu-west-2.pooler.supabase.com -p 5432 `
    -U postgres.mgbrrrjxbufstsjrdoug -d postgres -W `
    --single-transaction -v ON_ERROR_STOP=1 `
    -f migrations\proposed\0049_rollback.sql
```

**The same two flags are required.** The rollback carries the same
transaction-control guard and will refuse an autocommit executor — rehearsed,
and 0049 was left fully intact when it refused. A half-applied rollback would be
worse than none, because it runs at the moment something has already gone wrong.

Success is one line:

```
NOTICE:  0049 rollback OK: back at the 0048 entitlement model, 116 policies.
```

Then run `PRE_DEPLOY_0049.sql` again: **18/18 PASS** means you are cleanly back
at 0048. Rehearsed — the full schema fingerprint after rollback is
byte-identical to a database that never saw 0049.

**Two ways the rollback refuses, both on purpose:**

* `founder_slots does not exist; 0049 is not applied` — you are already at 0048.
* **any slot has `claimed_at` set** — it refuses, permanently. A claimed slot is
  a commercial promise to a named customer and dropping the table would erase
  it. **The rollback window closes the moment the first founder subscribes.**
  Right now checkout does not exist, so no slot can be claimed and the window is
  fully open.

### What rollback cannot do

The project is on the Supabase **Free** plan: **no PITR and no scheduled
backups.** This script is the recovery path. It is byte-faithful, but it only
covers 0049 — it is not a general restore. Nothing else protects you, which is
why the preflight is not optional.

---

## The order, once BLOCKER 0 is resolved

1. Verify hashes (§2)
2. `PRE_DEPLOY_0049.sql` → **18/18 PASS**, read row 18 (§5)
3. 0049 via `psql --single-transaction -v ON_ERROR_STOP=1` (§3, §4) → one NOTICE
4. `POST_VERIFY_0049.sql` → **20/20 PASS** (§6)
5. Stop. No Paystack, no frontend change, no Vercel action.

**Never paste the database password, the connection string, the `service_role`
key or the Paystack secret into this chat.**
