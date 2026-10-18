-- ============================================================================
-- CHECK_TRIAL_MAILER.sql        READ ONLY -- a single SELECT. Changes nothing.
--
-- Is the trial reminder mailer (0058 + supabase/functions/trial-reminder-mailer)
-- actually sending? Paste the whole file into Supabase -> SQL Editor and press
-- Run. It works whether or not pg_cron and pg_net are switched on: the rows
-- that need them say "not installed" instead of failing.
--
-- SAFE TO SHARE: the answer holds counts, dates, job names, schedules and
-- yes/no flags only. It never shows an owner's email, a business name, a
-- token, or a cron job's command (a job made in the dashboard keeps its
-- token in plain text inside the command, so the command is never selected).
-- Still glance at it before pasting it anywhere.
--
-- Needs 0058 (applied 3 October 2026). Row 5 calls fn_trial_reminders_due(),
-- which only the service context may call; the SQL Editor runs as postgres,
-- which counts (POST_VERIFY_0058 row 5 relies on the same).
--
-- How to read each row: the "good" column says what a healthy answer looks
-- like. CHECK_TRIAL_MAILER.md walks through the dashboard half and says what
-- to do about each kind of bad answer.
-- ============================================================================
with
ext as (
  select
    (select extversion      from pg_extension            where extname = 'pg_cron')        as cron_v,
    (select extversion      from pg_extension            where extname = 'pg_net')         as net_v,
    (select extversion      from pg_extension            where extname = 'supabase_vault') as vault_v,
    (select default_version from pg_available_extensions where name    = 'pg_cron')        as cron_avail,
    (select default_version from pg_available_extensions where name    = 'pg_net')         as net_avail
),
sent as (
  select k.o, k.kind, count(r.account_id) as n, max(r.sent_at) as last_at
    from (values (1, 'ends_in_3_days'), (2, 'ends_tomorrow'), (3, 'ended')) k(o, kind)
    left join trial_reminders r on r.kind = k.kind
   group by k.o, k.kind
),
-- what is owed right now; the owner's email column is never selected
due as (
  select d.kind, d.trial_ends_at from fn_trial_reminders_due() d
),
missed as (
  select count(*)                                                                 as n,
         count(*) filter (where s.current_period_end <= now() - interval '7 days') as beyond_window,
         min(s.current_period_end)                                                as earliest
    from subscriptions s
    join accounts a on a.id = s.account_id and a.deleted_at is null
   where s.status = 'trialing'
     and s.current_period_end <= now()
     and s.current_period_end >  now() - interval '30 days'
     and not exists (select 1 from trial_reminders r
                      where r.account_id = s.account_id and r.kind = 'ended')
),
-- pg_cron and pg_net live in their own schemas, which do not exist until the
-- extension is switched on. query_to_xml runs each read only when its
-- extension is there, so this one statement never fails on a missing schema.
-- Each of those reads returns exactly one row (an empty answer cannot be
-- parsed as XML), which is why they are all aggregates or scalar subqueries.
cron as (
  select
    case when (select cron_v from ext) is not null then
      (xpath('/row/v/text()', query_to_xml($q$
         select string_agg(coalesce(jobname, '(no name, id ' || jobid || ')') || ' | ' || schedule
                           || case when active then ' | active' else ' | PAUSED' end,
                           '; ' order by jobid) as v
           from cron.job where command ilike '%trial-reminder-mailer%'
       $q$, false, true, '')))[1]::text end as trial_jobs,
    case when (select cron_v from ext) is not null then
      (xpath('/row/v/text()', query_to_xml($q$
         select string_agg(coalesce(jobname, 'id ' || jobid) || ': '
                           || case when command ilike '%vault.decrypted_secrets%' then 'token read from Vault'
                                   when command ilike '%x-mailer-token%'          then 'token typed into the job (plain text)'
                                   else 'sends no x-mailer-token header' end,
                           '; ' order by jobid) as v
           from cron.job where command ilike '%trial-reminder-mailer%'
       $q$, false, true, '')))[1]::text end as trial_token,
    case when (select cron_v from ext) is not null then
      (xpath('/row/v/text()', query_to_xml($q$
         select string_agg(coalesce(jobname, 'id ' || jobid) || ' | ' || schedule
                           || case when active then ' | active' else ' | PAUSED' end
                           || case when command ilike '%platform-alert-mailer%' then ' (alert mailer)'
                                   when command ilike '%fn_admin_scan%'         then ' (admin scan)'
                                   else '' end,
                           '; ' order by jobid) as v
           from cron.job
          where command ilike '%platform-alert-mailer%' or command ilike '%fn_admin_scan%'
       $q$, false, true, '')))[1]::text end as other_jobs,
    case when (select cron_v from ext) is not null then
      (xpath('/row/v/text()', query_to_xml($q$
         select string_agg(status || '=' || n, ', ' order by status) as v
           from (select d.status, count(*) as n
                   from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                  where j.command ilike '%trial-reminder-mailer%'
                    and d.start_time > now() - interval '48 hours'
                  group by d.status) x
       $q$, false, true, '')))[1]::text end as runs_48h,
    case when (select cron_v from ext) is not null then
      (xpath('/row/v/text()', query_to_xml($q$
         select to_char(max(d.start_time) at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') as v
           from cron.job_run_details d join cron.job j on j.jobid = d.jobid
          where j.command ilike '%trial-reminder-mailer%'
       $q$, false, true, '')))[1]::text end as last_run
),
net as (
  select
    case when (select net_v from ext) is not null then
      (xpath('/row/v/text()', query_to_xml($q$
         select string_agg(code || '=' || n, ', ' order by code) as v
           from (select coalesce('HTTP ' || status_code,
                                 case when timed_out then 'timed out' else 'no reply' end) as code,
                        count(*) as n
                   from net._http_response
                  where created > now() - interval '6 hours'
                  group by 1) x
       $q$, false, true, '')))[1]::text end as replies,
    -- only replies shaped like the two mailers' own JSON ({"due":..}, {"sent":..},
    -- {"error":..}) or the gateway's ({"code":..,"message":..}); nothing else
    case when (select net_v from ext) is not null then
      (xpath('/row/v/text()', query_to_xml($q$
         select (select content || '  (HTTP ' || coalesce(status_code::text, '?') || ', '
                        || to_char(created at time zone 'Africa/Lagos', 'Dy DD Mon HH24:MI') || ' Lagos)'
                   from net._http_response
                  where content ~ '^\{"(due|sent|error|code|message|msg)":[^{}<>]{0,160}\}$'
                  order by created desc limit 1) as v
       $q$, false, true, '')))[1]::text end as last_body
)
select n, section, item, value, good from (
  select 1 as n, 'emails sent' as section, 'sent "ends in 3 days": how many, latest' as item,
         (select n || coalesce(' | latest ' || to_char(last_at at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos', '')
            from sent where o = 1) as value,
         'more than 0 once trials have reached their last 3 days; 0 everywhere = no trial email has ever gone out' as good
  union all
  select 2, 'emails sent', 'sent "ends tomorrow": how many, latest',
         (select n || coalesce(' | latest ' || to_char(last_at at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos', '')
            from sent where o = 2),
         'as row 1'
  union all
  select 3, 'emails sent', 'sent "has ended": how many, latest',
         (select n || coalesce(' | latest ' || to_char(last_at at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos', '')
            from sent where o = 3),
         'as row 1'
  union all
  select 4, 'emails sent', 'first trial email ever sent',
         coalesce((select to_char(min(sent_at) at time zone 'Africa/Lagos', 'Dy DD Mon YYYY HH24:MI') || ' Lagos'
                     from trial_reminders), 'never'),
         'a date; "never" means the mailer has not sent a single email'
  union all
  select 5, 'owed now', 'emails owed right now, by kind',
         coalesce((select string_agg(kind || '=' || c, ', ' order by kind)
                     from (select kind, count(*) as c from due group by kind) x), 'nothing owed'),
         'anything here should be gone after the next run at minute 20'
  union all
  select 6, 'owed now', 'emails owed for more than 2 hours (their moment passed and no run sent them)',
         (select count(*)::text from due
           where trial_ends_at <= now() - interval '2 hours'
                 + case kind when 'ended'         then interval '0'
                             when 'ends_tomorrow' then interval '1 day'
                             else                      interval '3 days' end),
         '0. More than 0 means the mailer is not running, or every send is failing'
  union all
  select 7, 'missed', 'trials ended in the last 30 days, still unpaid, never sent "has ended"',
         (select n || ' (of which ' || beyond_window || ' ended more than 7 days ago and will never get it on today''s rules)'
                 || coalesce(' | earliest ended ' || to_char(earliest at time zone 'Africa/Lagos', 'Dy DD Mon YYYY'), '')
            from missed),
         '0, or only trials that ended in the last hour or two'
  union all
  select 8, 'scheduler', 'pg_cron (runs jobs on a timetable)',
         coalesce('installed, version ' || (select cron_v from ext),
                  'NOT installed' || coalesce(' (version ' || (select cron_avail from ext) || ' is available)', '')),
         'installed'
  union all
  select 9, 'scheduler', 'pg_net (lets a job call a web address)',
         coalesce('installed, version ' || (select net_v from ext),
                  'NOT installed' || coalesce(' (version ' || (select net_avail from ext) || ' is available)', '')),
         'installed'
  union all
  select 10, 'scheduler', 'Vault (keeps the mailer token out of the job)',
         coalesce('installed, version ' || (select vault_v from ext), 'NOT installed'),
         'installed (Supabase projects have it)'
  union all
  select 11, 'scheduler', 'jobs that call trial-reminder-mailer: name | schedule | state',
         case when (select cron_v from ext) is null then 'pg_cron is not installed, so there can be no job'
              else coalesce((select trial_jobs from cron), 'NO job calls trial-reminder-mailer') end,
         'exactly one: mm-trial-mailer | 20 * * * * | active'
  union all
  select 12, 'scheduler', 'how each of those jobs sends the mailer token',
         case when (select cron_v from ext) is null then 'pg_cron is not installed'
              else coalesce((select trial_token from cron), 'no job') end,
         'token read from Vault. "plain text" works but should be moved; "no header" means every call is refused'
  union all
  select 13, 'scheduler', 'other Menu Master jobs (alert mailer, admin scan)',
         case when (select cron_v from ext) is null then 'pg_cron is not installed'
              else coalesce((select other_jobs from cron), 'none') end,
         'not about trials; listed because the alert mailer shares MAILER_TOKEN'
  union all
  select 14, 'last runs', 'trial mailer job runs in the last 48 hours, by result',
         case when (select cron_v from ext) is null then 'pg_cron is not installed'
              else coalesce((select runs_48h from cron), 'no runs in the last 48 hours') end,
         'succeeded=48 (one an hour). This only proves the call was queued; rows 16-17 show the reply'
  union all
  select 15, 'last runs', 'latest trial mailer job run',
         case when (select cron_v from ext) is null then 'pg_cron is not installed'
              else coalesce((select last_run from cron) || ' Lagos', 'never') end,
         'within the last hour, at minute 20'
  union all
  select 16, 'last runs', 'web replies pg_net kept (about the last 6 hours), by status',
         case when (select net_v from ext) is null then 'pg_net is not installed'
              else coalesce((select replies from net), 'no replies kept') end,
         'HTTP 200 only. 401 = token mismatch or JWT check on; 404 = not deployed; 500 = a secret is missing'
  union all
  select 17, 'last runs', 'latest mailer-shaped reply',
         case when (select net_v from ext) is null then 'pg_net is not installed'
              else coalesce((select last_body from net), 'none kept') end,
         '{"sent":0} or {"due":N,"sent":N,"failed":0}'
  union all
  select 18, 'database', 'database time zone (show timezone)',
         current_setting('TimeZone'),
         'UTC is normal on Supabase. It moves no trial end; this script prints Lagos times anyway'
  union all
  select 19, 'database', 'checked at',
         to_char(now() at time zone 'UTC', 'Dy DD Mon YYYY HH24:MI') || ' UTC = '
         || to_char(now() at time zone 'Africa/Lagos', 'HH24:MI') || ' Lagos',
         'write this time next to the answers in DEPLOY_0058.md'
) rows
order by n;
