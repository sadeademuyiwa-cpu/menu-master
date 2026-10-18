-- ============================================================================
-- SCHEDULE_TRIAL_MAILER.sql       WRITES ONE cron.job ROW. Nothing else.
--
-- Runs supabase/functions/trial-reminder-mailer every hour at minute 20,
-- with its x-mailer-token header read from Vault at each run, so the token
-- is never written into the job itself (a job made in the dashboard Cron
-- form keeps it in plain text in cron.job.command).
--
-- RUN IT ONLY AFTER SCHEDULE_TRIAL_MAILER.md steps 1-4:
--   1. pg_cron and pg_net switched on (Database -> Extensions)
--   2. the function deployed with --no-verify-jwt
--   3. its secrets set (RESEND_API_KEY, MAILER_TOKEN, TRIAL_EMAIL_FROM, SITE_URL)
--   4. the SAME MAILER_TOKEN stored in Vault under the name mm_mailer_token
-- This file holds no token and must never be edited to hold one.
--
-- Paste the whole file into Supabase -> SQL Editor and press Run. It runs as
-- one step: if the check at the top fails, nothing is changed and the error
-- says what is missing. Safe to run again: it replaces the job, never adds
-- a second one. The answer at the bottom shows flags only, never the command.
--
-- Undo: select cron.unschedule('mm-trial-mailer');
-- ============================================================================

-- 1. Refuse to schedule anything that could not work.
do $pre$
declare v_len int;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not switched on. Database -> Extensions -> pg_cron -> enable, then run this again.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net is not switched on. Database -> Extensions -> pg_net -> enable, then run this again.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'Vault (supabase_vault) is not switched on. Database -> Extensions -> supabase_vault -> enable.';
  end if;
  select length(decrypted_secret) into v_len
    from vault.decrypted_secrets where name = 'mm_mailer_token';
  if v_len is null then
    raise exception 'No Vault secret named mm_mailer_token. Add it first: SCHEDULE_TRIAL_MAILER.md step 4.';
  end if;
  if v_len < 16 then
    raise exception 'The Vault secret mm_mailer_token is % characters; the mailer refuses tokens under 16. '
                    'Use the same long MAILER_TOKEN the function has.', v_len;
  end if;
  if (select count(*) from vault.decrypted_secrets where name = 'mm_mailer_token') > 1 then
    raise exception 'More than one Vault secret is named mm_mailer_token. Keep one.';
  end if;
end
$pre$;

-- 2. One job only: drop any job that already calls the mailer, including one
--    made in the dashboard with the token typed into it.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'mm-trial-mailer' or command ilike '%trial-reminder-mailer%';

-- 3. The job. 60 seconds, not pg_net's 5-second default: a run that sends 50
--    emails takes about 40 seconds.
select cron.schedule(
  'mm-trial-mailer',
  '20 * * * *',
  $job$
  select net.http_post(
    url                  := 'https://mgbrrrjxbufstsjrdoug.supabase.co/functions/v1/trial-reminder-mailer',
    headers              := jsonb_build_object(
                              'Content-Type',   'application/json',
                              'x-mailer-token', (select decrypted_secret from vault.decrypted_secrets
                                                  where name = 'mm_mailer_token')),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $job$
);

-- 4. What is scheduled now. Flags only: the command is never shown.
select jobid, jobname, schedule, active,
       command ilike '%vault.decrypted_secrets%' as token_from_vault,
       command ilike '%x-mailer-token%'          as sends_token
  from cron.job
 where command ilike '%trial-reminder-mailer%'
 order by jobid;
-- EXPECTED: exactly one row: mm-trial-mailer | 20 * * * * | true | true | true
