# DEPLOYMENT RUNBOOK — Trial and billing release, Phase 1

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production or Paystack.

The whole release in one order, for the owner, from your own machine. It
ships:

| Part | What it does | Its own runbook |
|---|---|---|
| `0065_help_videos` (**only if it ships now**) | a help video per screen | `DEPLOY_0065.md` |
| `0066_trial_gate` | after a trial nothing new is saved, except money received on confirmed sales; trials end at 23:59:59 Lagos on day 14 | `DEPLOY_0066.md` |
| `0067_billing_self_serve` | plan change without a double charge, Cancel plan, Update your card, Pay now after a failed payment | `DEPLOY_0067.md` |
| `paystack-webhook`, `paystack-manage` (new), `paystack-checkout` | the Paystack side of 0067 | `DEPLOY_0067.md`, `supabase/functions/*/README.md` |
| `trial-reminder-mailer` | the footer wording, and no price line when the founding count cannot be read | `SCHEDULE_TRIAL_MAILER.md` |
| one Vercel deploy | the trial-gate screens, the sale-page payment switch, the billing screens | this file, step 12 |
| `BILLING_SELF_SERVE` in Vercel | the web switch for self-serve billing on a paying account | this file, step 11 |

Order (integration decision X9): the read-only checks; 0065 (if it ships),
0066 and 0067, each with its PRE and POST; `paystack-webhook`, then
`paystack-manage`, then `paystack-checkout`, then `trial-reminder-mailer`;
the Paystack test-mode checks; `BILLING_SELF_SERVE=on` in Vercel; then the
Vercel deploy. Rollback is the same list backwards (the end of this file).

**Expected starting state:** production database at **0064**, 118 policies,
99 `fn_*` functions; the site on the 17 October release (`2b1974a`).

**Time:** about 3 hours at the desk, plus the test-mode checks (step 10)
and up to a day for DNS (the mail track).

Two places you type into:

- **Supabase → SQL Editor** (New query → paste the **whole** file → Run)
  for every read-only check. They are single SELECTs; nothing changes.
- **PowerShell** (Windows PowerShell or PowerShell 7) for `psql`, the
  `supabase` CLI and `git`. Migrations go **only** through `psql`: their
  guard refuses the SQL Editor on purpose.

Never paste a password, a key, a token or a lookup result into a chat. The
check scripts print counts only, so their answers are safe to share.

---

## Before you start (once per PowerShell window)

```powershell
cd C:\laragon\www\MenuMasterNG
git status                         # "nothing to commit, working tree clean"
git log --oneline -1               # the release commit the developer named
$env:Path = "C:\laragon\bin\postgresql\postgresql-17.6\bin;$env:Path"
$env:PGPASSWORD = [Net.NetworkCredential]::new('', (Read-Host 'Database password' -AsSecureString)).Password
$db = @('-h', 'aws-0-eu-west-2.pooler.supabase.com', '-p', '5432', '-U', 'postgres.mgbrrrjxbufstsjrdoug', '-d', 'postgres', '-P', 'pager=off')
psql @db -c "select current_user, (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fn\_%') as fn_count, (select count(*) from pg_policies where schemaname = 'public') as policies"
```

Good answer: one row, `postgres | 99 | 118`.

- The host: copy it from **Supabase → Connect → Session pooler**
  (`aws-0-…` or `aws-1-…`). The user is `postgres.mgbrrrjxbufstsjrdoug`,
  not `postgres`. **Port 5432, never 6543**: 6543 cannot hold one
  transaction, and every migration needs one.
- `Read-Host` keeps the password out of the history. When you finish:
  `Remove-Item Env:PGPASSWORD`.
- `supabase login` once per machine. Every `supabase` command below names
  the project with `--project-ref mgbrrrjxbufstsjrdoug`.

---

## Step 1. Read-only checks (Day 0)

All in the SQL Editor. Note each answer; share counts only.

| # | File | Good answer | Not good |
|---|---|---|---|
| 1a | `deploy/runbook/PRE_DEPLOY_0066.sql` | **35 rows, all PASS**. Row 4 says whether 0065 is in. Rows 23-35 are facts (counts) about today: note row 32 (how many live trials 0066 will move) | any FAIL in rows 1-22: **stop** and send the output. A changed function body means 0066 was written against something else |
| 1b | `deploy/runbook/CHECK_TRIAL_MAILER.sql`, then the dashboard walk in `CHECK_TRIAL_MAILER.md` | 19 rows. Healthy: rows 1-4 show emails sent, row 6 = 0, row 11 one `mm-trial-mailer \| 20 * * * * \| active` job, row 12 `token read from Vault`, row 16 `HTTP 200` only | anything else: the mail track below |
| 1c | `deploy/runbook/BILLING_SUPPORT_CHECKS.sql` | 24 rows. On 0064, row 23 says `not yet \| not yet` and rows 14-15 say "0067 not applied". Note rows 2 (failed notices), 9 (paying accounts with no subscription code), 14 (two subscription codes) and 17 (logins on two accounts) | row 4 or 6 above 0, or row 2 listing `subscription.*` failures: read `BILLING_SUPPORT.md` before going on; none of them blocks the release |
| 1d | `deploy/runbook/PRE_DEPLOY_0067.sql` | **12 rows, all PASS**; row 1 says "NOT YET: apply 0066 first" (it passes before and after 0066). Note rows 8-10 | any FAIL: stop and send the output |
| 1e | `deploy/runbook/PRE_DEPLOY_0065.sql`, **only if 0065 ships** | 5 rows, all PASS | stop |

### The mail track (start on Day 0, beside the release)

DNS can take up to a day, so start it now. It does not depend on the
migrations.

1. `EMAIL_DELIVERABILITY.md` steps 1-6: SPF and DKIM from Resend, the
   `dmarc@` alias, DMARC at `p=none`, all senders on `@menumasterng.com`,
   and the Gmail "Show original" test. **Good answer:** SPF PASS, DKIM
   'PASS' with domain menumasterng.com, DMARC 'PASS'.
2. If step 1b showed the mailer is not scheduled, `SCHEDULE_TRIAL_MAILER.md`
   steps 1 and 3-8 **after step 9 below** (step 9 is its deploy, so skip its
   step 2), and only once the Gmail test passes: its first run emails every
   trial already inside a reminder window.

---

## Step 2. 0065 help videos — only if it ships now

0065 is **not** on the trial and billing branches; it is another piece of
work. If it ships, the developer commits it to the release first, and it
goes in **before 0066**: its preflight, its self-check and suite 051 expect
exactly 99 `fn_*`, and 0066 makes that 102. If it does not ship now, skip
this step. It then cannot be applied after 0066 until the developer changes
those counts (to 102 after 0066, or the count after 0067) and re-runs suite
051.

```powershell
psql @db --single-transaction -v ON_ERROR_STOP=1 -f migrations\proposed\0065_help_videos.sql
"exit code: $LASTEXITCODE"
```

Good answer: `NOTICE:  0065 OK: site_settings has its sixth row, help (empty); 118 policies, 99 fn_*.`
and `exit code: 0`. Then `deploy/runbook/POST_VERIFY_0065.sql` in the SQL
Editor: 5 rows, all PASS. Run it **now, before 0066**: once 0066 is in, its
row 5 fails (it expects 99 `fn_*` and 0066 makes 102), which is expected.
Re-run step 1a afterwards: row 4 now says "0065 applied".

## Step 3. 0066 trial gate

Re-run step 1a if more than a day has passed (row 32 changes as trials come
and go). Then:

```powershell
psql @db --single-transaction -v ON_ERROR_STOP=1 -f migrations\proposed\0066_trial_gate.sql
"exit code: $LASTEXITCODE"
```

Good answer: `NOTICE:  0066 OK: … (N live trial(s) moved later, each logged) …`,
with **N equal to PRE row 32**, and `exit code: 0`. Then
`deploy/runbook/POST_VERIFY_0066.sql`: **17 rows, all PASS**.

Anything else: the transaction rolled back and the database is still at
0064 (or 0065). Nothing changed, so the site works as before. Stop and send
the output.

## Step 4. 0067 self-serve billing

`deploy/runbook/PRE_DEPLOY_0067.sql` again: 12 rows, all PASS, and row 1 now
says "0066 applied". Then:

```powershell
psql @db --single-transaction -v ON_ERROR_STOP=1 -f migrations\proposed\0067_billing_self_serve.sql
"exit code: $LASTEXITCODE"
```

Good answer: `NOTICE:  0067 recovery: …` (how many subscription codes it
recovered and how many accounts it left for review), `NOTICE:  0067 OK: …`,
`exit code: 0`. The OK line ends with **107 `fn_*` (+5), 118 policies**. Then
`deploy/runbook/POST_VERIFY_0067.sql`: **13 rows, all PASS**.

Then `BILLING_SUPPORT_CHECKS.sql`: row 23 says `applied | applied`, row 15
says `0`.

**From here until rollback step R6, 0067 stays in.** Its webhook
(step 6) is what switches old subscriptions off.

## Step 5. Close the edge kill switch for now

The new `paystack-checkout` (step 8) lets a paying owner change plan or pay
again, and the site still on production until step 12 shows such an owner
"Choose plan" on the other plan. Keep that closed until the test-mode checks
(step 10) have passed:

```powershell
supabase secrets set BILLING_SELF_SERVE=off --project-ref mgbrrrjxbufstsjrdoug
```

Good answer: `Finished supabase secrets set.` While it is `off`,
`paystack-checkout` answers `switch_needs_support` to every plan change or
Pay now on an account that already pays. **A trial's first payment is not
affected.** Cancel plan and Update your card are not on the site yet.

## Step 6. Deploy paystack-webhook

```powershell
supabase functions deploy paystack-webhook --no-verify-jwt --project-ref mgbrrrjxbufstsjrdoug
```

Good answer: `Deployed Functions on project mgbrrrjxbufstsjrdoug: paystack-webhook`.
`--no-verify-jwt` is required: Paystack sends no Supabase login, and the
function checks Paystack's signature instead. In **Supabase → Edge Functions
→ paystack-webhook**, "Enforce JWT verification" must be **off**. After the
next Paystack notice (or within the day), its **Logs** show `200` answers and
`BILLING_SUPPORT_CHECKS.sql` row 3 stays `0`.

## Step 7. Deploy paystack-manage (new)

```powershell
supabase functions deploy paystack-manage --project-ref mgbrrrjxbufstsjrdoug
curl.exe -s -o NUL -w "%{http_code}`n" -X POST https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/paystack-manage
```

Good answer: `Deployed Functions …: paystack-manage`, then `401` (a request
without a login is refused before the function runs; nothing is sent to
Paystack). This one **keeps** JWT verification: no `--no-verify-jwt`.

## Step 8. Deploy paystack-checkout

```powershell
supabase functions deploy paystack-checkout --project-ref mgbrrrjxbufstsjrdoug
curl.exe -s -o NUL -w "%{http_code}`n" -X POST https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/paystack-checkout
```

Good answer: `Deployed Functions …: paystack-checkout`, then `401`. JWT
verification stays on. **Never deploy this before steps 4 and 6**: it lets
a paying owner open a new subscription, and only 0067 and the new webhook
switch the old one off.

## Step 9. Deploy trial-reminder-mailer

```powershell
supabase functions deploy trial-reminder-mailer --no-verify-jwt --project-ref mgbrrrjxbufstsjrdoug
curl.exe -s -i -X POST https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/trial-reminder-mailer
```

Good answer: `Deployed Functions …: trial-reminder-mailer`, then `401` with
`{"error":"unauthorised"}` (it sends nothing without the token; **never add
the token to this probe**). `--no-verify-jwt` is required here too: the
scheduler sends no Supabase login. If the mailer was not scheduled (step
1b), do the mail track's part 2 now.

In the same sitting, redeploy the alert mailer so the admin alert emails
name the new billing alerts in words (until then they read as their raw
names; nothing else changes):

```powershell
supabase functions deploy platform-alert-mailer --no-verify-jwt --project-ref mgbrrrjxbufstsjrdoug
```

## Step 10. Paystack test-mode checks

These prove what Paystack really sends before owners can use self-serve on
a paying account. They run in Paystack **test mode** against a **test
copy** (a separate Supabase project with the `sk_test_…` key, test plans
mapped as in `PAYSTACK_TEST_MODE_SETUP.md`, the functions from this
release, and a Vercel **preview** of the release pointed at it with
`BILLING_SELF_SERVE=on` set for **Preview** only). **Never** put a test key
on the production project, and never run these against live customers.

The full table, with what each one must show, is `DEPLOY_0067.md`
"Test-mode checks". In short:

| | Do | Good answer |
|---|---|---|
| T1 | A trial account pays | the subscription code is stored (L2); **write down where each notice carries the code** |
| T2 | The owner switches to the other plan | Paystack shows **one** Active subscription for that customer within a minute; the old one's notices arrive `ignored`; a founder keeps the founding price |
| T3 | The owner of an active plan picks the plan they are on | refused, `already_on_plan`; no founder hold |
| T4 | A manager tries | refused, `owner_only` |
| T5 | The owner presses Cancel plan | the end date shown; the account stays usable to that date; **write down when `subscription.disable` arrives** |
| T6 | The owner presses Update your card | an https page on paystack.com; **write down the reply's field name** |
| T7 | Cancel again | refused, `nothing_to_cancel` |
| T8 | A cancelled owner chooses a plan again inside the paid month | goes ahead; "starts a new paid month today"; the old code recorded `already_off` |
| T9 | A test subscription renews | **write down whether a renewal charge carries our metadata or a subscription code**; it is applied to the current plan, and a renewal of a replaced subscription is `ignored` `superseded_charge` |
| T10 | A renewal fails (a declining test card), then the overdue owner presses **Pay now** on the same plan | goes ahead; the account is `active` with a new month; the failed subscription is switched off; **one** Active subscription |
| T11 | Another overdue owner presses **Cancel plan** | `ends_on` empty; the account is `cancelled` and read-only at once; a founder loses the founding price |
| T12 | Cancel plan, Update your card, or choosing a plan again, in a second tab while a plan change is finishing | refused, `change_in_progress` (the window is seconds; if you cannot catch it, the automated tests cover it) |
| T13 | Switch off a second subscription of a paying test customer in the dashboard without recording it first | its notices are held `failed_permanent` `not_current_subscription`; the account is unchanged |

**All must pass.** One that fails: leave the edge switch `off` and the
Vercel variable unset, and send the developer what you saw. The release can
still go out in that state (step 12): owners of paying accounts then see
"message us", and `BILLING_SUPPORT.md` section 10 is how you help them.

## Step 11. Open the switches

Only when step 10 has passed in full, POST_VERIFY_0067 passed, and
`BILLING_SUPPORT_CHECKS.sql` row 15 is `0`:

1. The edge kill switch back to its default:

   ```powershell
   supabase secrets unset BILLING_SELF_SERVE --project-ref mgbrrrjxbufstsjrdoug
   supabase secrets list --project-ref mgbrrrjxbufstsjrdoug
   ```

   Good answer: the list no longer shows `BILLING_SELF_SERVE`. (It shows
   names and digests only, never values.)

2. The web switch: **Vercel → the project (menu-master) → Settings →
   Environment Variables → Add New**: Key `BILLING_SELF_SERVE`, Value `on`
   (exactly that, lower case), Environment **Production** only → Save.

   It takes effect with the next deploy, which is step 12. Anything but
   exactly `on` (including not set) keeps self-serve hidden: owners of
   paying accounts see "To change or cancel your plan, message us. We do it
   for you, so you are never charged twice.", and the terms, refunds page
   and FAQ say "message us".

Do steps 11 and 12 one straight after the other.

If you want the release out before step 10 is done, skip this step, do step
12, and come back: unset the edge switch, set the variable, then Vercel →
Deployments → the latest → ⋯ → **Redeploy**.

## Step 12. The Vercel deploy

The release is the commit on `launch/2026-10-02` that the developer names,
with all five branches merged. Vercel deploys production from
`claude/menu-master-ng-migrations-3faerm`. Before pushing, note the current
production deployment in **Vercel → Deployments** (the one marked
Production): it is the rollback target.

```powershell
git fetch origin
git status                          # clean, on launch/2026-10-02
git log --oneline -1                # the release commit
git push origin HEAD:launch/2026-10-02
git push origin HEAD:claude/menu-master-ng-migrations-3faerm
```

Good answer: both pushes say `<old>..<new>` (a fast-forward). A push that is
refused as "non-fast-forward" means the branches differ: stop, never use
`--force`, and ask the developer. Then **Vercel → Deployments**: a new
**Production** deployment, **Ready** in a few minutes.

## Step 13. After the deploy

Within the hour:

1. Signed out, `https://menumasterng.com/terms` and `/refunds`: with the
   switch on, they say you cancel from the Account page and change plan on
   Plans & billing; with it off, they say "message us".
2. Signed in as an owner on a trial: the trial bar and Plans & billing. On
   a confirmed sale, the payment form (**Save payment**, or **Change the
   payment** when something is already paid) is there and saves.
3. If you have a paying account of your own: **More → Account** shows
   **Cancel plan** (do not press it); Plans & billing shows "Your plan" on
   your plan and "Switch to this plan" on the other.
4. `BILLING_SUPPORT_CHECKS.sql`: rows 2-7 show nothing new; row 15 `0`.
5. `DEPLOY_0067.md` "After deploy: what to watch": no replaced subscription
   left without `disabled_at`, no open billing alert.

The next day: `BILLING_SUPPORT_CHECKS.sql` again, and `CHECK_TRIAL_MAILER.sql`
if the mailer was scheduled (rows 14-17).

## Step 14. Write it down

1. Move the applied migrations out of `proposed/` and push (this triggers
   one more production deploy of the same app):

   ```powershell
   git mv migrations\proposed\0066_trial_gate.sql migrations\0066_trial_gate.sql
   git mv migrations\proposed\0067_billing_self_serve.sql migrations\0067_billing_self_serve.sql
   # and 0065 if it shipped
   git commit -m "0066-0067 are applied on production: move them out of proposed/"
   git push origin HEAD:launch/2026-10-02
   git push origin HEAD:claude/menu-master-ng-migrations-3faerm
   ```

2. `docs/LAUNCH_CHECKLIST.md` §12: the date `BILLING_SELF_SERVE` went `on`.
3. `DEPLOY_0058.md` "Mailer status", if the mail track scheduled the mailer.

---

## Rollback: the same list backwards

Do only the steps you need, from the top. Each step is safe on its own.

| # | Undo | How | Good answer |
|---|---|---|---|
| R1 | the Vercel deploy and the web switch | **Vercel → Deployments →** the rollback target from step 12 **→ ⋯ → Promote to Production** (instant). Then Settings → Environment Variables → `BILLING_SELF_SERVE` → set to `off` (or delete it), so no later deploy brings self-serve back | the old deployment marked Production; the site works as on 17 October |
| R2 | the edge kill switch | `supabase secrets set BILLING_SELF_SERVE=off --project-ref mgbrrrjxbufstsjrdoug` | `Finished supabase secrets set.` From now no paying account can start a plan change |
| R3 | trial-reminder-mailer (only if it misbehaves) | stop it at once with `select cron.unschedule('mm-trial-mailer');` in the SQL Editor, then redeploy the earlier version (below) and schedule it again (`SCHEDULE_TRIAL_MAILER.sql`) | `true`; no more runs at minute 20 until you schedule it again. Sent emails stay recorded, so none is sent twice |
| R4 | paystack-checkout | **Usually leave the new one in place.** With R2 done it refuses every plan change or Pay now on a paying account, a trial's first payment still works, and it needs nothing from 0067. Redeploy the earlier version (below) only if the new one is itself broken (for example a trial's first payment fails), and read the warning under the table first | `Deployed Functions …` |
| R5 | paystack-manage | `supabase functions delete paystack-manage --project-ref mgbrrrjxbufstsjrdoug` | the function is gone from Edge Functions |
| R6 | 0067 | first wait until no replaced subscription is waiting (`BILLING_SUPPORT_CHECKS.sql` row 15 `0`, and `DEPLOY_0067.md` "what to watch" empty), or switch those off in Paystack and record them as `DEPLOY_0067.md` says. Then `psql @db --single-transaction -v ON_ERROR_STOP=1 -f migrations\rollbacks\0067_rollback.sql` | `NOTICE:  0067 rollback OK: back at 0066; 102 fn_*, 118 policies.`, exit code 0. It **refuses** while a replaced subscription is not recorded as off, and names the codes |
| R7 | paystack-webhook | redeploy the earlier version (below) with `--no-verify-jwt`, **only after R6**: until then the new webhook is what switches old subscriptions off | `Deployed Functions …` |
| R8 | 0066 | after R1 (the web that calls `fn_record_order_payment` is gone), `psql @db --single-transaction -v ON_ERROR_STOP=1 -f migrations\rollbacks\0066_rollback.sql`. It refuses while 0067 is still in | `NOTICE:  0066 rollback OK: back at 0064. …`, exit code 0. Trials it moved later stay later |
| R9 | 0065 (only if it shipped and must go) | `psql @db --single-transaction -v ON_ERROR_STOP=1 -f migrations\rollbacks\0065_rollback.sql` | `NOTICE:  0065 rollback OK: back at 0064. No screen shows a Help button.`, exit code 0 |

Then `POST_VERIFY` of the level you are back at (for example
`POST_VERIFY_0064.sql`) and `BILLING_SUPPORT_CHECKS.sql`.

**Redeploying an earlier version of a function** (R3, R4, R7): from the
commit that was live before this release (`2b1974a`):

```powershell
git worktree add C:\laragon\www\mm-rollback 2b1974a
cd C:\laragon\www\mm-rollback
supabase functions deploy paystack-checkout --project-ref mgbrrrjxbufstsjrdoug
supabase functions deploy paystack-webhook --no-verify-jwt --project-ref mgbrrrjxbufstsjrdoug
supabase functions deploy trial-reminder-mailer --no-verify-jwt --project-ref mgbrrrjxbufstsjrdoug
cd C:\laragon\www\MenuMasterNG
git worktree remove C:\laragon\www\mm-rollback
```

Run only the lines for the functions you are rolling back.

**Warning about the earlier `paystack-checkout`.** It has no kill switch and
refuses nothing, and the earlier site (R1) still shows an owner who already
pays a "Choose plan" button on the other plan, and both plans when a payment
has failed. Paying there opens a **second** Paystack subscription, and once
0067 is rolled back nothing switches the first one off: the double charge
this release exists to stop. If you must put it back, run
`BILLING_SUPPORT_CHECKS.sql` every day until the release is fixed and
re-shipped, and deal with rows 14 and 16 as `BILLING_SUPPORT.md` section 4
says.

While anything is rolled back, owners of paying accounts message you:
`BILLING_SUPPORT.md` section 10.
