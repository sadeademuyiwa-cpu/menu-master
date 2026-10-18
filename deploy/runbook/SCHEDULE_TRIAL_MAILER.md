# Set up the trial reminder mailer: deploy, secrets, hourly schedule

Only if `CHECK_TRIAL_MAILER.md` shows the mailer is not running (not
deployed, no job, or a job that cannot work). Skip any step the check
already showed is done.

**Do `EMAIL_DELIVERABILITY.md` first**, at least up to its DMARC record and
a passing Gmail test. The first run emails every trial already inside a
reminder window, and those emails should land in the inbox, not spam.

About 30 minutes, plus up to an hour to watch the first run.

Values used below:

| | |
|---|---|
| Supabase project | `mgbrrrjxbufstsjrdoug` |
| Function URL | `https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/trial-reminder-mailer` (the same function as `https://mgbrrrjxbufstsjrdoug.functions.supabase.co/trial-reminder-mailer`) |
| Schedule | `20 * * * *`: every hour at minute 20 (the same minute in Lagos and UTC) |
| Vault secret name | `mm_mailer_token` |

---

## Step 1. Switch on the scheduler

Supabase → **Database → Extensions**: enable **pg_cron** and **pg_net**
(both are on the Pro plan). **supabase_vault** is normally on already; if
not, enable it too.

If `CHECK_TRIAL_MAILER.sql` row 13 shows no `mm-admin-scan` job, also run
`SCHEDULE_ADMIN_SCAN.sql` once (0055 could not schedule it while pg_cron was
off).

## Step 2. Deploy the function

From the repository, on the branch that holds the current mailer:

```powershell
cd C:\laragon\www\MenuMasterNG
supabase login                      # once per machine
supabase functions deploy trial-reminder-mailer --no-verify-jwt --project-ref mgbrrrjxbufstsjrdoug
```

`--no-verify-jwt` is required: the scheduler sends no Supabase login, and
the function checks its own token (`x-mailer-token`) instead.

Check with the probe from `CHECK_TRIAL_MAILER.md` Part B step 5 (it sends
nothing): it must answer `401` with `{"error":"unauthorised"}`.

## Step 3. Set its secrets

Secrets are shared by every function in the project, so some may already
exist (`SITE_URL` from the Paystack setup, `RESEND_API_KEY` and
`MAILER_TOKEN` from the alert mailer). Set only the missing ones.

| Name | Value |
|---|---|
| `RESEND_API_KEY` | resend.com → API Keys → create one with sending access for `menumasterng.com` |
| `MAILER_TOKEN` | a random string of 16 or more characters (below) |
| `TRIAL_EMAIL_FROM` | `Menu Master NG <hello@menumasterng.com>` (must be on the domain verified in Resend) |
| `SITE_URL` | `https://menumasterng.com` |
| `SUPPORT_EMAIL` | optional: the inbox you read, so owners' replies reach you |

Set the two secret keys (`RESEND_API_KEY`, `MAILER_TOKEN`) in the
dashboard, **Edge Functions → Secrets → Add**, so they never sit in a
terminal's history. The other three can go either way:

```powershell
supabase secrets set TRIAL_EMAIL_FROM="Menu Master NG <hello@menumasterng.com>" SITE_URL=https://menumasterng.com --project-ref mgbrrrjxbufstsjrdoug
```

**MAILER_TOKEN.** The dashboard cannot show an existing value. If the alert
mailer already has one and you kept it (password manager), use that same
value in step 4. Otherwise make a new one in PowerShell; it goes straight
to the clipboard and is never printed:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)) | Set-Clipboard
```

Paste it into the `MAILER_TOKEN` secret, then into Vault (step 4), then into
your password manager. Clear the clipboard afterwards (`Set-Clipboard -Value ' '`).
A **new** token stops any older job that has the old token typed into it,
including the alert mailer's: see "The alert mailer" at the end.

New secret values reach the function on its next call; no redeploy is needed.

## Step 4. Put the same token in Vault

So the scheduled job can read the token without it being written into the
job:

- **Dashboard way (preferred):** Supabase → **Integrations → Vault**
  (older dashboards: Project Settings → Vault) → **Add new secret**.
  Name `mm_mailer_token`, secret = the `MAILER_TOKEN` value, description
  "x-mailer-token for the trial and alert mailers".
- **SQL way:** in a **new, unsaved** SQL snippet, then delete the snippet,
  because the SQL Editor keeps what you typed:

  ```sql
  select vault.create_secret('<MAILER_TOKEN>', 'mm_mailer_token', 'x-mailer-token for the trial and alert mailers');
  -- to change it later:
  -- select vault.update_secret((select id from vault.secrets where name = 'mm_mailer_token'), '<NEW TOKEN>');
  ```

Never put the token into `SCHEDULE_TRIAL_MAILER.sql` or any file in the
repository.

## Step 5. See what the first run will send

Run `CHECK_TRIAL_MAILER.sql` and note row 5 (owed now). The first run sends
all of those, at most 50 (the rest go the next hour). That is intended: those
owners have not been told yet.

## Step 6. Schedule it

SQL Editor → paste all of `deploy/runbook/SCHEDULE_TRIAL_MAILER.sql` → **Run**.

- It first checks pg_cron, pg_net, Vault and the `mm_mailer_token` secret
  (16+ characters). If anything is missing it stops, says what, and changes
  nothing.
- It removes any older job that calls the mailer (including one made in the
  dashboard Cron form), then creates `mm-trial-mailer`.
- The last result must be exactly one row:
  `mm-trial-mailer | 20 * * * * | true | true | true`
  (active, token read from Vault, token sent).

Running it again is safe: it replaces the job, never adds a second one.

## Step 7. Watch one run

After the next minute 20:

1. At about minute 22, run `CHECK_TRIAL_MAILER.sql` again:
   - row 14: one more `succeeded`; row 15: a run at minute 20;
   - row 16: `HTTP 200`; row 17: `{"due":N,"sent":N,"failed":0}`, with N
     the number from step 5 (or `{"sent":0}` if nothing was owed);
   - rows 1-3 have grown by N, and rows 5-6 have shrunk.
2. Edge Functions → `trial-reminder-mailer` → Invocations: a `POST` at
   minute 20 answering `200`, and no `resend HTTP` or `record failed` lines
   in Logs.
3. Resend → Emails: N emails about the free trial, **Delivered**.

**Not willing to wait?** This sends the owed emails now, exactly as the job
would. Run it in the SQL Editor:

```sql
select net.http_post(
  url                  := 'https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/trial-reminder-mailer',
  headers              := jsonb_build_object('Content-Type', 'application/json',
                            'x-mailer-token', (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'mm_mailer_token')),
  body                 := '{}'::jsonb,
  timeout_milliseconds := 60000) as request_id;
```

A minute later, `CHECK_TRIAL_MAILER.sql` rows 16-17 show the answer.

## Step 8. Write it down

In `DEPLOY_0058.md`, fill in the **Mailer status** table with the date of
each step, and tick `docs/LAUNCH_CHECKLIST.md` §6.

---

## Undo

```sql
select cron.unschedule('mm-trial-mailer');
```

The emails stop; nothing else changes. Sent emails stay recorded, so
scheduling it again never repeats one.

## Clean up after a plain-text token

If `CHECK_TRIAL_MAILER.sql` row 12 showed a job with the token typed into it,
step 6 removed that job, but pg_cron's run history still holds the old
command, token included. Either:

- **change the token** (best): make a new one (step 3), set it as
  `MAILER_TOKEN`, update the Vault secret (step 4), and move the alert
  mailer onto Vault too (below); or
- delete those history rows (this writes, but only to the timer's history):

  ```sql
  delete from cron.job_run_details
   where command ilike '%x-mailer-token%' and command not ilike '%vault.decrypted_secrets%';
  ```

## The alert mailer

`platform-alert-mailer` uses the same `MAILER_TOKEN`. If it is deployed and
set up (`DEPLOY_0053_0055.md`) and `CHECK_TRIAL_MAILER.sql` row 13 shows its
job with the token typed in, or the token changed, point it at the same Vault
secret:

```sql
select cron.unschedule(jobid) from cron.job where command ilike '%platform-alert-mailer%';
select cron.schedule(
  'mm-alert-mailer',
  '12 * * * *',
  $job$
  select net.http_post(
    url                  := 'https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/platform-alert-mailer',
    headers              := jsonb_build_object('Content-Type', 'application/json',
                              'x-mailer-token', (select decrypted_secret from vault.decrypted_secrets
                                                  where name = 'mm_mailer_token')),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 30000) as request_id;
  $job$
);
```
