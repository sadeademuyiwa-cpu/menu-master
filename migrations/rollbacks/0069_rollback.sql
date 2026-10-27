-- ============================================================================
-- 0069 ROLLBACK: remove screen visits, friction, help requests and ratings.
-- Back at 0068 (with or without 0067).
--
-- DELETES every recorded screen visit and friction event (both are kept 90
-- days anyway), every help request people sent from the app, and every
-- answer to the short questions. Export the last two first if you need them:
--   select h.created_at, u.email, h.screen, h.channel, h.message, h.status, h.note
--     from help_requests h join auth.users u on u.id = h.user_id order by h.created_at;
--   select f.created_at, u.email, f.prompt, f.score, f.comment
--     from feedback f join auth.users u on u.id = f.user_id order by f.created_at;
--
-- ALSO DELETES who turned screen recording off (profiles.usage_opt_out_at).
-- That is a person's objection (NDPA s.36) and must survive a re-apply.
-- ALWAYS export it first:
--   select id, usage_opt_out_at from profiles where usage_opt_out_at is not null;
-- and if 0069 is ever applied again, put them back IN THE SAME TRANSACTION,
-- so nothing of theirs can be recorded in between (the app stays live):
--   psql "<conn>" --single-transaction -v ON_ERROR_STOP=1 \
--        -f migrations/proposed/0069_usage_and_help.sql -f restore_objections.sql
-- where restore_objections.sql is
--   update profiles set usage_opt_out_at = x.at
--     from (values ('<id>'::uuid, '<usage_opt_out_at>'::timestamptz)) x(id, at) where profiles.id = x.id;
-- Run separately instead, it must also delete what was recorded meanwhile:
--   delete from usage_views where user_id in (<ids>); delete from usage_events where user_id in (<ids>);
--
-- The app keeps working: its beats, events, help and ratings calls fail
-- quietly (each one ignores an error), the Help sheet's "Write to us" says
-- it did not send, and the admin's Live now, Journeys and Help & feedback say
-- they need 0069. Roll the app back too if you want them gone.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0069 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if to_regclass('public.usage_views') is null then
    raise exception '0069 rollback: usage_views does not exist; 0069 is not applied.';
  end if;
end
$$;

-- The nightly purge first, so it never runs against a missing function.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mm-usage-purge') then
      perform cron.unschedule('mm-usage-purge');
    end if;
  end if;
end
$$;

drop function fn_usage_purge();
drop function fn_admin_set_help_status(bigint, text, text);
drop function fn_admin_help();
drop function fn_admin_journey(uuid);
drop function fn_admin_activation(uuid);
drop function fn_admin_live();
drop function fn_set_my_usage_tracking(boolean);
drop function fn_give_feedback(text, integer, text, text);
drop function fn_feedback_due();
drop function fn_ask_for_help(text, text, text, text, text);
drop function fn_usage_event(text, text, text, text);
drop function fn_usage_beat(uuid, uuid, text, text, text, integer, text);

drop index purchases_first_posted_idx, cost_snapshots_first_complete_idx, recipe_prices_account_created_idx,
           orders_first_final_idx, sales_entries_account_created_idx, billing_events_first_paid_idx;

drop table feedback;
drop table help_requests;
drop table usage_events;
drop table usage_views;
alter table profiles drop column usage_opt_out_at;

do $$
begin
  if to_regclass('public.usage_views') is not null or to_regclass('public.help_requests') is not null
     or to_regclass('public.feedback') is not null or to_regclass('public.usage_events') is not null
     or exists (select 1 from pg_indexes where schemaname = 'public'
                 and indexname in ('purchases_first_posted_idx','cost_snapshots_first_complete_idx',
                                   'recipe_prices_account_created_idx','orders_first_final_idx',
                                   'sales_entries_account_created_idx','billing_events_first_paid_idx'))
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'profiles' and column_name = 'usage_opt_out_at')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                 and proname in ('fn_usage_beat','fn_usage_event','fn_ask_for_help','fn_give_feedback',
                                 'fn_feedback_due','fn_set_my_usage_tracking','fn_admin_live',
                                 'fn_admin_activation','fn_admin_journey','fn_admin_help',
                                 'fn_admin_set_help_status','fn_usage_purge')) then
    raise exception '0069 rollback FAILED: something of 0069 is still there.';
  end if;
  raise notice '0069 rolled back: no screen visits, help requests or ratings; % fn_*.',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fn\_%');
end
$$;
