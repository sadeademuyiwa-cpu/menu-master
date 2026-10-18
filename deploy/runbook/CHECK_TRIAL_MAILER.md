# Is the trial reminder mailer working?

Owners are meant to get three emails: "your free trial ends in 3 days",
"ends tomorrow" and "has ended, your records are safe" (0058, sent by the
edge function `trial-reminder-mailer`). Migration 0058 is on production
(3 October 2026), but nothing in the repository shows that the function was
deployed, given its secrets, or put on an hourly schedule. If it was not,
**no trial email has ever gone out.**

This check answers that in about 15 minutes. **Everything here is read only**:
nothing sends an email or changes a setting. Do the four parts in order,
then write the answers in the status table in `DEPLOY_0058.md`.

If anything is missing, `SCHEDULE_TRIAL_MAILER.md` sets it up. Do
`EMAIL_DELIVERABILITY.md` first, so the first emails land in the inbox.

---

## Part A. The database (SQL Editor)

Supabase → **SQL Editor** → New snippet → paste all of
`deploy/runbook/CHECK_TRIAL_MAILER.sql` → **Run**. It works whether or not
pg_cron and pg_net are switched on.

The answer is 19 rows. It holds counts, dates, job names and yes/no only,
never an email, a business name, a token or a job's command, so it is safe
to paste to the developer. Still look before you paste.

| Row | Healthy answer | If not |
|---|---|---|
| 1-3 emails sent | more than 0 once any trial has reached its last 3 days | all 0 and row 4 says **never**: no trial email has ever been sent |
| 5 owed now | empty, or emails whose moment came within the last hour | |
| 6 owed for more than 2 hours | **0** | the mailer is not running, or every send fails. Parts B and C say which |
| 7 missed "has ended" | 0, or trials that ended in the last hour or two | the part "ended more than 7 days ago" will never get an email on today's rules. Note the count and the earliest date: the one-off catch-up email (a later phase) needs them. Meanwhile, message the most active of those owners yourself |
| 8-9 pg_cron, pg_net | installed | not installed: no job can exist. `SCHEDULE_TRIAL_MAILER.md` step 1 |
| 10 Vault | installed | Database → Extensions → `supabase_vault` |
| 11 jobs | exactly one: `mm-trial-mailer \| 20 * * * * \| active` | none, PAUSED, or two jobs: `SCHEDULE_TRIAL_MAILER.sql` makes it exactly one |
| 12 token | `token read from Vault` | "plain text": works, but the token sits readable in the job; rerun `SCHEDULE_TRIAL_MAILER.sql` to move it to Vault. "no header": every call is refused |
| 13 other jobs | `mm-admin-scan` and the alert mailer, if you set them up | only for your picture: the alert mailer shares `MAILER_TOKEN` |
| 14-15 last runs | about one `succeeded` an hour, the latest within the hour | "succeeded" only means the call was sent off; rows 16-17 show what the function answered |
| 16 replies | `HTTP 200` only | `401`: the token does not match, or the function checks for a login (Part B, step 1). `404`: not deployed. `500`: a secret is missing (Part B, step 2) |
| 17 latest reply | `{"sent":0}` (nothing owed) or `{"due":N,"sent":N,"failed":0}` | `"failed"` above 0: Resend refused some sends (Part C). `{"error":"unauthorised"}`: token. `{"error":"misconfigured"}`: a secret is missing |
| 18 time zone | `UTC` is normal on Supabase | another value is fine: no trial end depends on it, and this script prints Lagos times |

pg_net keeps replies for only about 6 hours, so rows 16-17 can be empty
even when all is well. The alert mailer's replies (`{"sent":N,"critical":N}`)
appear there too.

## Part B. Supabase dashboard

1. **Edge Functions** (left menu). Look for `trial-reminder-mailer` (and
   `platform-alert-mailer` if you use the alert emails).
   - Listed, with an "updated" date. Good.
   - Open it. Its settings must show **JWT verification off** ("Enforce JWT
     Verification" unticked). It is called by a timer, not by a signed-in
     person, and it checks its own token instead. If it is on, every
     scheduled call is refused before the function runs: redeploy with
     `--no-verify-jwt` (`SCHEDULE_TRIAL_MAILER.md` step 2).
   - Not listed: it was never deployed. `SCHEDULE_TRIAL_MAILER.md` from
     step 1.
2. **Edge Functions → Secrets.** Only names are shown, which is all you need:

   | Name | Needed by | |
   |---|---|---|
   | `RESEND_API_KEY` | both mailers | required |
   | `MAILER_TOKEN` | both mailers | required, 16+ characters |
   | `TRIAL_EMAIL_FROM` | trial mailer | required, e.g. `Menu Master NG <hello@menumasterng.com>` |
   | `SITE_URL` | trial mailer and Paystack | required, `https://menumasterng.com` |
   | `SUPPORT_EMAIL` | trial mailer | optional: where owners' replies go |
   | `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | alert mailer only | |

   Never copy a secret's value anywhere.
3. **Edge Functions → trial-reminder-mailer → Invocations**, then **Logs**.
   - Healthy: one `POST` an hour, at about minute 20, answering `200`.
     Times show in your browser's time zone.
   - Log lines that mean trouble:

     | Line | Means |
     |---|---|
     | `not configured` | `RESEND_API_KEY`, `TRIAL_EMAIL_FROM` or `SITE_URL` is missing |
     | `resend HTTP 4xx` / `5xx` | Resend refused the email; the rest of the line says why (often "domain not verified") |
     | `record failed` | the email went out but was not recorded, so it may go again a day later. Tell the developer |
     | `due list failed` | the database refused the function; tell the developer |
     | `founding places unknown ... no price line` | the founding-place count could not be read, so that run's emails went without a price. Harmless once; tell the developer if it repeats |

   - No invocations at all: nothing calls it. Check step 4.
4. **Integrations → Cron → Jobs** (needs pg_cron). The job
   `mm-trial-mailer`, schedule `20 * * * *`, active, with a recent last run.
   Its history shows **Succeeded** each hour. Also look under **Database →
   Extensions** that `pg_cron` and `pg_net` are on.
5. **A probe that sends nothing.** In PowerShell:

   ```powershell
   curl.exe -s -i -X POST https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/trial-reminder-mailer
   ```

   | Answer | Means |
   |---|---|
   | `401` with `{"error":"unauthorised"}` | deployed, JWT check off. Good |
   | `401` with a message about a missing authorization header or an invalid JWT | deployed with the JWT check **on**: redeploy with `--no-verify-jwt` |
   | `404` | not deployed |

   **Never add the token to this probe.** With the token it really sends the
   emails that are owed.

## Part C. Resend (resend.com)

1. **Domains → menumasterng.com.** Status **Verified**, every record green
   (DKIM, and SPF: the MX and TXT records on `send`). Anything else:
   `EMAIL_DELIVERABILITY.md`.
2. **Emails** (the log). Search for `free trial`.
   - Each one shows **Delivered**, **Bounced** or **Complained**.
     Delivered means Gmail accepted it, not that it reached the inbox:
     `EMAIL_DELIVERABILITY.md` step 6 tests that.
   - None at all: no trial email was ever handed to Resend.
3. **API Keys.** The key the mailers use shows a recent "last used" date.

## Part D. Write it down

Fill in the **Mailer status** table in `DEPLOY_0058.md` with today's date
and one word per line (yes, no, unknown), plus row 6 and row 7 of Part A as
numbers. Then:

| What you found | Next |
|---|---|
| Everything healthy | Nothing more. Tick `docs/LAUNCH_CHECKLIST.md` §6 with today's date |
| Not deployed, no job, pg_cron or pg_net off, or a paused job | `EMAIL_DELIVERABILITY.md`, then `SCHEDULE_TRIAL_MAILER.md` |
| A job with the token in plain text | `SCHEDULE_TRIAL_MAILER.sql` (it replaces the job and reads the token from Vault), then its "clean up" note |
| Replies `401` | the Vault secret differs from `MAILER_TOKEN`, or the JWT check is on (B1, B5) |
| Replies `500` / `misconfigured` | a secret is missing (B2) |
| `"failed"` above 0, or `resend HTTP` lines | Resend refuses the sender: `EMAIL_DELIVERABILITY.md` |
| Row 6 above 0 but replies are `{"sent":0}` | the owed owners have no usable email address on their login; tell the developer |

Never paste the output of `select * from cron.job`, `fn_trial_reminders_due()`
or the Edge Function secrets anywhere: they hold the token or owners'
emails. The SQL file above is written so you never need them.
