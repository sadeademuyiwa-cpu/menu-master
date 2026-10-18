# DEPLOYMENT RUNBOOK — 0058 (trial reminder emails)

> ## Applied to production on 3 October 2026
>
> The migration was applied with psql on **3 October 2026** (commit
> `f8d5022`): `POST_VERIFY_0058` 6/6, and row 5 said the first run owed
> 6 emails (3 ended, 2 ends tomorrow, 1 ends in 3 days). The file now lives
> in `migrations/`.
>
> **The mailer itself is unconfirmed.** Nothing in the repository records
> that `trial-reminder-mailer` was deployed, given its secrets, or put on an
> hourly schedule. Until the checks below have been run, assume no trial
> email has gone out. Find out with `CHECK_TRIAL_MAILER.sql` and
> `CHECK_TRIAL_MAILER.md` (read only); if they show gaps, do
> `EMAIL_DELIVERABILITY.md` and then `SCHEDULE_TRIAL_MAILER.md`. Write the
> answers in the table below.

## Mailer status

Fill in with the date you checked. "Unconfirmed" means nobody has looked yet.

| | Answer | Checked on | How to check |
|---|---|---|---|
| `trial-reminder-mailer` deployed, JWT check off | deployed with --no-verify-jwt; answers 401 without the token | 18 Oct 2026 | `CHECK_TRIAL_MAILER.md` B1, B5 |
| Its secrets set (`RESEND_API_KEY`, `MAILER_TOKEN`, `TRIAL_EMAIL_FROM`, `SITE_URL`) | all four set; MAILER_TOKEN replaced with a new 48-character token (the old value was unknown); `SUPPORT_EMAIL` not set, so replies go to hello@, which has no inbox | 18 Oct 2026 | B2 |
| pg_cron and pg_net on | pg_cron 1.6.4 and pg_net 0.20.4 on (pg_net switched on by the owner) | 18 Oct 2026 | `CHECK_TRIAL_MAILER.sql` rows 8-9 |
| `mm_mailer_token` in Vault | yes, 48 characters, the same token | 18 Oct 2026 | `SCHEDULE_TRIAL_MAILER.sql` refuses without it |
| Job `mm-trial-mailer`, `20 * * * *`, active, token from Vault | yes (jobid 2); `mm-alert-mailer` `12 * * * *` too, token from Vault, alerts to the owner's Gmail | 18 Oct 2026 | rows 11-12 |
| One run watched: HTTP 200, emails delivered | 13:20 UTC run succeeded, HTTP 200, 1 `ends_tomorrow` sent; alert mailer 13:12 UTC run emailed 9 open alerts | 18 Oct 2026 | rows 14-17, `CHECK_TRIAL_MAILER.md` C2 |
| Emails ever sent (rows 1-4) | **never**: 0 of each kind | 18 Oct 2026 | rows 1-4 |
| Owed for more than 2 hours (row 6) | 1 (`ends_tomorrow`) | 18 Oct 2026 | row 6 (healthy: 0) |
| Trials that ended without an email (row 7) | 7, all ended more than 7 days ago (earliest 20 Sep) | 18 Oct 2026 | row 7 |
| menumasterng.com verified in Resend; SPF, DKIM, DMARC pass in Gmail | unconfirmed | | `EMAIL_DELIVERABILITY.md` steps 2, 6 |
| Mailer redeployed with the 18 October change (no guessed price; "The free trial never charges you.") | yes (first deploy of the mailer) | 18 Oct 2026 | `SCHEDULE_TRIAL_MAILER.md` step 2 |

Expected starting state when it was applied: **0057 applied**, 118 policies,
93 `fn_*` functions.

## What changes

| Adds | Policies | Customer rows touched |
|---|---|---|
| `trial_reminders` (RLS, no policy, no client grant); `fn_trial_reminders_due`, `fn_record_trial_reminder` — both service context only | 118 → 118 | none |

`fn_*` 93 → 95. The emails are sent by the edge function
`supabase/functions/trial-reminder-mailer`, hourly:

| Email | When | Sent |
|---|---|---|
| "Your free trial ends in 3 days" | the trial ends within 3 days | once |
| "Your free trial ends tomorrow" | it ends within a day | once |
| "Your free trial has ended — your records are safe" | it ended in the last 7 days, still unpaid | once |

The trial's end is `current_period_end` of a `trialing` subscription — the
date the app closes the account on — so an email can never disagree with
the app. Paying accounts are never emailed. Each email links to `/subscribe`
and quotes the lowest price by the same founding rule the plans page uses.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0058.sql` | SQL Editor | no |
| 2 | `migrations/0058_trial_reminders.sql` (was in `proposed/`) | **psql only** | yes |
| 3 | `POST_VERIFY_0058.sql` — row 5 shows what the first run will send | SQL Editor | no |
| 4 | deploy `trial-reminder-mailer` and set its secrets | `SCHEDULE_TRIAL_MAILER.md` steps 2-3 | — |
| 5 | schedule it hourly, token in Vault | `SCHEDULE_TRIAL_MAILER.sql` (SQL Editor) | one `cron.job` row |
| — | `migrations/rollbacks/0058_rollback.sql`, only if 3 fails | psql | yes |

Expect **PRE 5/5**, `NOTICE: 0058 OK: …`, **POST 6/6**. Steps 1-3 were done
on 3 October 2026; steps 4-5 are unconfirmed (see the status table above).

## The mailer

Secrets, in the Edge Function secret store only (never in Vercel, never in
the repository). `RESEND_API_KEY` and `MAILER_TOKEN` are shared with the
platform alert mailer.

| Secret | What |
|---|---|
| `RESEND_API_KEY` | from resend.com |
| `MAILER_TOKEN` | any long random string (at least 16 characters) |
| `TRIAL_EMAIL_FROM` | e.g. `Menu Master NG <hello@menumasterng.com>` — on the domain verified in Resend |
| `SITE_URL` | `https://menumasterng.com` |
| `SUPPORT_EMAIL` | optional: where replies go |

```
supabase functions deploy trial-reminder-mailer --no-verify-jwt --project-ref mgbrrrjxbufstsjrdoug
supabase secrets set TRIAL_EMAIL_FROM="Menu Master NG <hello@menumasterng.com>" SITE_URL=https://menumasterng.com --project-ref mgbrrrjxbufstsjrdoug
```

Schedule: `POST https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/trial-reminder-mailer`
with header `x-mailer-token: <MAILER_TOKEN>`, at `20 * * * *` (hourly).
Use `SCHEDULE_TRIAL_MAILER.sql`, which reads the token from Vault at each
run, rather than the dashboard's Cron form, which writes the token into
the job in plain text. The full steps are in `SCHEDULE_TRIAL_MAILER.md`.
Each run sends at most 50; anything left goes on the next run. A failed
send is not recorded, so it is retried; a repeated run within 24 hours
cannot double-send (Resend idempotency key per account and kind).

Since 18 October 2026 (branch `fix/trial-ops`) the email leaves out the
price line when the number of founding places left cannot be read, instead
of quoting the standard price, and its small print adds "The free trial
never charges you." A redeploy is needed for either to reach owners.

The first run after deploying emails every trial already inside a window
(POST row 5 says how many). That is intended: those owners have not been
told.

## Rehearsed

On a local copy built 0001 → 0058 with `scripts/setup_db.ps1 -WithProposed`:
all 42 SQL suites pass (906 checks), including
`tests/044_trial_reminders.sql`; `0058_rollback.sql` returns to 0057 and
re-applies cleanly. `deno test` covers the email content (10 tests; 15
since 18 October 2026, with the founding-place count and the small print).
`web/e2e/rehearse-trial-mailer.mjs` runs the real function in Deno against
the local database with a stand-in for Resend (11 checks): token refused,
the right email once, recorded, not repeated, "ends tomorrow" next, nothing
after payment.

## Rollback

`0058_rollback.sql` drops both functions and the table. Unschedule the
mailer first (`select cron.unschedule('mm-trial-mailer');`). The record of
who was reminded goes with the table, so re-applying 0058 later would remind
those accounts again.
