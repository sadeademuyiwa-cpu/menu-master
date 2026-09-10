-- ============================================================================
-- SCHEDULE_ADMIN_SCAN.sql             WRITES ONE cron.job ROW.
--
-- Only needed if 0055 ran BEFORE pg_cron was enabled (its notice says so).
-- Enable pg_cron in Database > Extensions, then run this in the SQL Editor.
-- ============================================================================
select cron.unschedule(jobid) from cron.job where jobname = 'mm-admin-scan';
select cron.schedule('mm-admin-scan', '7 * * * *', 'select public.fn_admin_scan();');
select jobid, jobname, schedule, command, active from cron.job where jobname = 'mm-admin-scan';
-- a first run now, so the admin page has something to show
select public.fn_admin_scan();
