# DEPLOYMENT RUNBOOK — 0058 (trial reminder emails)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0057 applied**, 118 policies, 93 `fn_*` functions.

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
| 2 | `migrations/proposed/0058_trial_reminders.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0058.sql` — row 5 shows what the first run will send | SQL Editor | no |
| 4 | deploy `trial-reminder-mailer` (below) | Supabase CLI | — |
| 5 | schedule it hourly (below) | Supabase → Integrations → Cron | — |
| — | `migrations/rollbacks/0058_rollback.sql`, only if 3 fails | psql | yes |

Expect **PRE 5/5**, `NOTICE: 0058 OK: …`, **POST 6/6**.

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
supabase functions deploy trial-reminder-mailer --no-verify-jwt
supabase secrets set TRIAL_EMAIL_FROM="Menu Master NG <hello@menumasterng.com>" SITE_URL=https://menumasterng.com
```

Schedule: `POST https://<ref>.functions.supabase.co/trial-reminder-mailer`
with header `x-mailer-token: <MAILER_TOKEN>`, at `20 * * * *` (hourly).
Each run sends at most 50; anything left goes on the next run. A failed
send is not recorded, so it is retried; a repeated run within 24 hours
cannot double-send (Resend idempotency key per account and kind).

The first run after deploying emails every trial already inside a window
(POST row 5 says how many). That is intended: those owners have not been
told.

## Rehearsed

On a local copy built 0001 → 0058 with `scripts/setup_db.ps1 -WithProposed`:
all 42 SQL suites pass (906 checks), including
`tests/044_trial_reminders.sql`; `0058_rollback.sql` returns to 0057 and
re-applies cleanly. `deno test` covers the email content (10 tests).
`web/e2e/rehearse-trial-mailer.mjs` runs the real function in Deno against
the local database with a stand-in for Resend (11 checks): token refused,
the right email once, recorded, not repeated, "ends tomorrow" next, nothing
after payment.

## Rollback

`0058_rollback.sql` drops both functions and the table. Unschedule the
mailer first. The record of who was reminded goes with the table, so
re-applying 0058 later would remind those accounts again.
