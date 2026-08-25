-- ============================================================================
-- MENU MASTER NG — 0020 ROLLBACK (C10)
--
-- Restores fn_create_account_and_business to its exact pre-C10 definition and
-- removes the idempotency ledger.
--
-- RUN INSIDE:  begin;  <this file>  commit;
--
-- *** DATA LOSS WARNING ***
--   This DROPS onboarding_requests and every row in it. Those rows are the
--   retry protection for tenants that have already onboarded. Dropping them
--   does not delete any tenant, but it does mean a subsequent retry could
--   duplicate one.
--
--   Per the owner's instruction this is acceptable ONLY while the table is
--   empty or holds test rows. Once C10 has processed real onboarding
--   requests, do NOT run this -- use a forward-fix migration instead. The
--   preflight below counts the rows and names them so the choice is explicit.
--
-- WHY THE DEFINITION IS BASE64
--   Production's stored body uses CRLF line endings -- 2771 bytes against a
--   2714-byte LF equivalent, i.e. 57 CR bytes, because PART_4 was CRLF
--   converted when pasted. A CSV export of a function has already silently
--   stripped CRLF once in this project. Pasting the old definition as literal
--   SQL risks restoring something that only looks right. Base64 survives
--   transport unchanged and is integrity-checked before execution.
-- ============================================================================

do $rb$
declare
  v_b64      text := 'Q1JFQVRFIE9SIFJFUExBQ0UgRlVOQ1RJT04gcHVibGljLmZuX2NyZWF0ZV9hY2NvdW50X2FuZF9idXNpbmVzcyhwX2FjY291bnRfbmFtZSB0ZXh0LCBwX2J1c2luZXNzX25hbWUgdGV4dCwgcF9idXNpbmVzc190eXBlIGJ1c2luZXNzX3R5cGUgREVGQVVMVCAnb3RoZXInOjpidXNpbmVzc190eXBlLCBwX3VzZXJfaWQgdXVpZCBERUZBVUxUIGF1dGgudWlkKCksIHBfY3VycmVuY3kgdGV4dCBERUZBVUxUICdOR04nOjp0ZXh0LCBwX3BsYW5faWQgdGV4dCBERUZBVUxUICd0cmlhbCc6OnRleHQsIHBfdHJpYWxfZGF5cyBpbnRlZ2VyIERFRkFVTFQgMTQpCiBSRVRVUk5TIGpzb25iCiBMQU5HVUFHRSBwbHBnc3FsCiBTRUNVUklUWSBERUZJTkVSCiBTRVQgc2VhcmNoX3BhdGggVE8gJ3B1YmxpYycKQVMgJGZ1bmN0aW9uJA0KZGVjbGFyZQ0KICB2X2FjY291bnQgdXVpZDsgdl9idXNpbmVzcyB1dWlkOyB2X2xvY2F0aW9uIHV1aWQ7IHZfc2x1ZyB0ZXh0Ow0KICB2X2Nsb25lZCBpbnRlZ2VyOyB2X3VzZXIgdXVpZDsNCmJlZ2luDQogIC0tIEEgY2xpZW50IG1heSBvbmx5IGNyZWF0ZSBhbiBhY2NvdW50IGZvciBpdHNlbGYuIFNlcnZpY2UgY29udGV4dCBtYXkNCiAgLS0gc3RpbGwgYWN0IG9uIGJlaGFsZiBvZiBhIHVzZXIsIGZvciBzdXBwb3J0IGFuZCBtaWdyYXRpb24gcHVycG9zZXMuDQogIGlmIGZuX2lzX3NlcnZpY2VfY29udGV4dCgpIHRoZW4NCiAgICB2X3VzZXIgOj0gY29hbGVzY2UocF91c2VyX2lkLCBhdXRoLnVpZCgpKTsNCiAgZWxzZQ0KICAgIHZfdXNlciA6PSBhdXRoLnVpZCgpOw0KICAgIGlmIHBfdXNlcl9pZCBpcyBub3QgbnVsbCBhbmQgcF91c2VyX2lkIDw+IHZfdXNlciB0aGVuDQogICAgICByYWlzZSBleGNlcHRpb24gJ1lvdSBtYXkgb25seSBjcmVhdGUgYW4gYWNjb3VudCBmb3IgeW91cnNlbGYnDQogICAgICAgIHVzaW5nIGVycmNvZGUgPSAnNDI1MDEnOw0KICAgIGVuZCBpZjsNCiAgZW5kIGlmOw0KDQogIGlmIHZfdXNlciBpcyBudWxsIHRoZW4NCiAgICByYWlzZSBleGNlcHRpb24gJ0EgdXNlciBpcyByZXF1aXJlZCB0byBvd24gdGhlIGFjY291bnQnOw0KICBlbmQgaWY7DQogIGlmIG5vdCBleGlzdHMgKHNlbGVjdCAxIGZyb20gYXV0aC51c2VycyB3aGVyZSBpZCA9IHZfdXNlcikgdGhlbg0KICAgIHJhaXNlIGV4Y2VwdGlvbiAnVXNlciAlIGRvZXMgbm90IGV4aXN0Jywgdl91c2VyOw0KICBlbmQgaWY7DQogIGlmIGNvYWxlc2NlKGJ0cmltKHBfYWNjb3VudF9uYW1lKSwnJykgPSAnJyBvciBjb2FsZXNjZShidHJpbShwX2J1c2luZXNzX25hbWUpLCcnKSA9ICcnIHRoZW4NCiAgICByYWlzZSBleGNlcHRpb24gJ0FjY291bnQgbmFtZSBhbmQgYnVzaW5lc3MgbmFtZSBhcmUgcmVxdWlyZWQnOw0KICBlbmQgaWY7DQoNCiAgaW5zZXJ0IGludG8gYWNjb3VudHMgKG5hbWUpIHZhbHVlcyAoYnRyaW0ocF9hY2NvdW50X25hbWUpKSByZXR1cm5pbmcgaWQgaW50byB2X2FjY291bnQ7DQoNCiAgaW5zZXJ0IGludG8gbWVtYmVyc2hpcHMgKGFjY291bnRfaWQsIGJ1c2luZXNzX2lkLCB1c2VyX2lkLCByb2xlKQ0KICB2YWx1ZXMgKHZfYWNjb3VudCwgbnVsbCwgdl91c2VyLCAnb3duZXInKTsNCg0KICB2X3NsdWcgOj0gYnRyaW0ocmVnZXhwX3JlcGxhY2UobG93ZXIoYnRyaW0ocF9idXNpbmVzc19uYW1lKSksICdbXmEtejAtOV0rJywgJy0nLCAnZycpLCAnLScpOw0KICBpbnNlcnQgaW50byBidXNpbmVzc2VzIChhY2NvdW50X2lkLCBuYW1lLCBzbHVnLCB0eXBlKQ0KICB2YWx1ZXMgKHZfYWNjb3VudCwgYnRyaW0ocF9idXNpbmVzc19uYW1lKSwgdl9zbHVnLCBwX2J1c2luZXNzX3R5cGUpDQogIHJldHVybmluZyBpZCBpbnRvIHZfYnVzaW5lc3M7DQoNCiAgaW5zZXJ0IGludG8gbG9jYXRpb25zIChhY2NvdW50X2lkLCBidXNpbmVzc19pZCwgbmFtZSwgaXNfZGVmYXVsdCkNCiAgdmFsdWVzICh2X2FjY291bnQsIHZfYnVzaW5lc3MsICdNYWluJywgdHJ1ZSkgcmV0dXJuaW5nIGlkIGludG8gdl9sb2NhdGlvbjsNCg0KICBpbnNlcnQgaW50byBidXNpbmVzc19zZXR0aW5ncyAoYnVzaW5lc3NfaWQsIGFjY291bnRfaWQsIGN1cnJlbmN5KQ0KICB2YWx1ZXMgKHZfYnVzaW5lc3MsIHZfYWNjb3VudCwgcF9jdXJyZW5jeSk7DQoNCiAgaW5zZXJ0IGludG8gY2hhbm5lbHMgKGFjY291bnRfaWQsIGJ1c2luZXNzX2lkLCBuYW1lLCBpc19kZWZhdWx0KQ0KICB2YWx1ZXMgKHZfYWNjb3VudCwgdl9idXNpbmVzcywgJ0RpcmVjdCcsIHRydWUpOw0KDQogIHZfY2xvbmVkIDo9IGZuX2Nsb25lX3N0YXJ0ZXJfY2F0YWxvZyh2X2FjY291bnQsIHBfYnVzaW5lc3NfdHlwZSk7DQoNCiAgaW5zZXJ0IGludG8gc3Vic2NyaXB0aW9ucyAoYWNjb3VudF9pZCwgcGxhbl9pZCwgc3RhdHVzLCB0cmlhbF9lbmRzX2F0LCBjdXJyZW50X3BlcmlvZF9lbmQpDQogIHZhbHVlcyAodl9hY2NvdW50LCBwX3BsYW5faWQsICd0cmlhbGluZycsDQogICAgICAgICAgbm93KCkgKyAocF90cmlhbF9kYXlzIHx8ICcgZGF5cycpOjppbnRlcnZhbCwNCiAgICAgICAgICBub3coKSArIChwX3RyaWFsX2RheXMgfHwgJyBkYXlzJyk6OmludGVydmFsKTsNCg0KICByZXR1cm4ganNvbmJfYnVpbGRfb2JqZWN0KA0KICAgICdhY2NvdW50X2lkJywgdl9hY2NvdW50LCAnYnVzaW5lc3NfaWQnLCB2X2J1c2luZXNzLCAnbG9jYXRpb25faWQnLCB2X2xvY2F0aW9uLA0KICAgICdpbmdyZWRpZW50c19hZGRlZCcsIHZfY2xvbmVkLCAnbmV4dF9zdGVwJywgJ2VudGVyX3lvdXJfb3duX3ByaWNlcycpOw0KZW5kOw0KJGZ1bmN0aW9uJAo=';
  v_expected text := '71aff1dbc2e89d11383d77e1cbf1f967';
  v_sql      text;
  v_rows     bigint;
begin
  if not exists (select 1 from pg_class where relname='onboarding_requests') then
    raise exception 'ROLLBACK ABORTED: onboarding_requests does not exist. '
                    '0020 was not applied, or has already been rolled back.';
  end if;

  execute 'select count(*) from onboarding_requests' into v_rows;
  if v_rows > 0 then
    raise warning '*** onboarding_requests holds % row(s). Rolling back DISCARDS '
                  'the retry protection for those onboardings. If any belong to '
                  'a real user, ABORT and use a forward fix instead.', v_rows;
  end if;

  v_sql := convert_from(decode(v_b64, 'base64'), 'UTF8');

  if md5(v_sql) <> v_expected then
    raise exception 'ROLLBACK ABORTED: payload md5 is %, expected %. The '
                    'embedded definition was damaged.', md5(v_sql), v_expected;
  end if;
  if octet_length(convert_to(v_sql,'UTF8')) <> 2771 then
    raise exception 'ROLLBACK ABORTED: payload is % bytes, expected 2771.',
                    octet_length(convert_to(v_sql,'UTF8'));
  end if;

  -- Remove the nine-argument function first, so only one overload ever exists.
  execute 'drop function if exists public.fn_create_account_and_business('
       || 'text, text, business_type, uuid, text, text, integer, text, uuid)';

  execute v_sql;

  execute 'revoke all on function public.fn_create_account_and_business('
       || 'text, text, business_type, uuid, text, text, integer) from public, anon';
  execute 'grant execute on function public.fn_create_account_and_business('
       || 'text, text, business_type, uuid, text, text, integer) '
       || 'to authenticated, service_role';

  execute 'drop policy if exists p_onboarding_requests on onboarding_requests';
  execute 'drop table onboarding_requests';

  raise notice 'Rollback applied. Verifying...';
end
$rb$;

do $ck$
declare v_md5 text; v_n integer;
begin
  select count(*) into v_n from pg_proc
   where pronamespace='public'::regnamespace
     and proname='fn_create_account_and_business';
  if v_n <> 1 then
    raise exception 'ROLLBACK SELF-CHECK FAILED: % overloads, expected 1.', v_n;
  end if;

  select md5(pg_get_functiondef(p.oid)) into v_md5 from pg_proc p
   where p.pronamespace='public'::regnamespace
     and p.proname='fn_create_account_and_business';
  if v_md5 <> '71aff1dbc2e89d11383d77e1cbf1f967' then
    raise exception 'ROLLBACK SELF-CHECK FAILED: md5 is %, expected '
                    '71aff1dbc2e89d11383d77e1cbf1f967.', v_md5;
  end if;

  if exists (select 1 from pg_class where relname='onboarding_requests') then
    raise exception 'ROLLBACK SELF-CHECK FAILED: onboarding_requests survives.';
  end if;

  if (select count(*) from pg_class
       where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')) <> 43 then
    raise exception 'ROLLBACK SELF-CHECK FAILED: expected 43 relations.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 92 then
    raise exception 'ROLLBACK SELF-CHECK FAILED: expected 92 policies.';
  end if;
  if has_function_privilege('anon',
       'public.fn_create_account_and_business(text,text,business_type,uuid,text,text,integer)',
       'EXECUTE') then
    raise exception 'ROLLBACK SELF-CHECK FAILED: anon holds EXECUTE.';
  end if;

  raise notice 'ROLLBACK OK: RPC restored byte-for-byte (md5 %), ledger removed, '
               '43 relations, 92 policies, anon excluded. Onboarding is NOT '
               'idempotent again.', v_md5;
end
$ck$;
