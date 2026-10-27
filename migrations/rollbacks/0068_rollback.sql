-- ============================================================================
-- 0068 ROLLBACK: remove the signup contact. Back at 0066 (or 0067).
--
-- DELETES every WhatsApp number owners gave, their consent record and the
-- admin's check-ins. Export them first if you need them:
--   select u.email, p.phone, p.marketing_ok_at from profiles p join auth.users u on u.id = p.id where p.phone is not null;
-- The app keeps working: onboarding's number fails quietly (logged), Account
-- cannot save one, and the admin shows no check-ins. Roll the app back too
-- if you want the questions gone.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0068 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if to_regclass('public.contact_consents') is null then
    raise exception '0068 rollback: contact_consents does not exist; 0068 is not applied.';
  end if;
  if to_regclass('public.usage_views') is not null then
    raise exception '0068 rollback: 0069 (usage and help) is applied and builds on 0068. Roll 0069 back first.';
  end if;
end
$$;

drop function fn_admin_record_checkin(uuid, text, text, text, text);
drop function fn_admin_checkins_due();
drop function fn_set_my_contact(text, boolean, text, text);
drop table admin_checkins;
drop table contact_consents;

alter table profiles drop constraint ck_profiles_phone;
update profiles set phone = null;
alter table profiles
  drop column phone_added_at,
  drop column phone_confirmed_at,
  drop column marketing_ok_at,
  drop column contact_wording,
  drop column phone_wrong_at;
drop function fn_normalise_ng_phone(text);

-- profiles back to its 0011 grants
grant insert, update, delete on profiles to authenticated;
comment on column profiles.phone is null;

do $$
begin
  if to_regclass('public.admin_checkins') is not null
     or exists (select 1 from pg_proc where pronamespace='public'::regnamespace
                 and proname in ('fn_normalise_ng_phone','fn_set_my_contact','fn_admin_checkins_due','fn_admin_record_checkin')) then
    raise exception '0068 rollback FAILED: something of 0068 is still there.';
  end if;
  raise notice '0068 rolled back: no numbers, no consent log, no check-ins; % fn_*.',
    (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
end
$$;
