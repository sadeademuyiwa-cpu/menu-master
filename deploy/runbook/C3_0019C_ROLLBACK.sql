-- ============================================================================
-- MENU MASTER NG — 0019c ROLLBACK
--
-- Restores public.handle_new_user() to its exact pre-0019c definition,
-- byte for byte, including SECURITY DEFINER, SET search_path TO 'public',
-- the original body, and the CRLF line endings the body actually contains.
--
-- ONLY run this if you need to undo 0019c. Running it re-breaks signup --
-- that is the point: it restores the previous state exactly, and the previous
-- state was broken.
--
-- WHY THE DEFINITION IS BASE64 AND NOT INLINE SQL
--   The stored body uses CRLF line endings inside the $function$ block: the
--   definition is 285 bytes, of which 5 are CR. A CSV export of this function
--   already silently stripped those CRs once during capture, producing text
--   that hashed to 8307129d... instead of the true 6eccc287...
--
--   Pasting the definition as literal SQL would risk the same corruption in
--   reverse and restore something that merely LOOKS like the original. Base64
--   survives CSV quoting, copy-paste and line-ending conversion unchanged, and
--   the payload is integrity-checked against the captured md5 before it is
--   executed. If the payload is damaged in transit, this script refuses to run
--   rather than restoring a corrupted function.
--
-- The owner is not changed: CREATE OR REPLACE preserves it, and the function
-- is already owned by postgres. There was no COMMENT on the function, so none
-- is restored.
--
-- RUN INSIDE A TRANSACTION:  begin;  <this file>  commit;
-- ============================================================================

do $$
declare
  v_b64      text := 'Q1JFQVRFIE9SIFJFUExBQ0UgRlVOQ1RJT04gcHVibGljLmhhbmRsZV9uZXdfdXNlcigpCiBSRVRVUk5TIHRyaWdnZXIKIExBTkdVQUdFIHBscGdzcWwKIFNFQ1VSSVRZIERFRklORVIKIFNFVCBzZWFyY2hfcGF0aCBUTyAncHVibGljJwpBUyAkZnVuY3Rpb24kDQpiZWdpbg0KICBpbnNlcnQgaW50byB2ZW5kb3JzIChpZCwgY29udGFjdF9uYW1lKSB2YWx1ZXMgKG5ldy5pZCwgbmV3LnJhd191c2VyX21ldGFfZGF0YS0+PidmdWxsX25hbWUnKTsNCiAgcmV0dXJuIG5ldzsNCmVuZDsNCiRmdW5jdGlvbiQK';
  v_expected text := '6eccc287be2c1bb645b28fbe8ccbe644';
  v_sql      text;
begin
  v_sql := convert_from(decode(v_b64, 'base64'), 'UTF8');

  -- Integrity gate: refuse to restore anything that is not bit-identical to
  -- what was captured from production before 0019c ran.
  if md5(v_sql) <> v_expected then
    raise exception 'ROLLBACK ABORTED: payload md5 is %, expected %. The '
                    'embedded definition was damaged. Do not proceed.',
                    md5(v_sql), v_expected;
  end if;

  if octet_length(convert_to(v_sql, 'UTF8')) <> 285 then
    raise exception 'ROLLBACK ABORTED: payload is % bytes, expected 285.',
                    octet_length(convert_to(v_sql, 'UTF8'));
  end if;

  if not exists (select 1 from pg_proc
                  where pronamespace = 'public'::regnamespace
                    and proname = 'handle_new_user') then
    raise exception 'ROLLBACK ABORTED: public.handle_new_user does not exist. '
                    'Something other than 0019c has happened -- investigate.';
  end if;

  execute v_sql;

  raise notice 'Rollback applied. Verifying...';
end
$$;

do $$
declare
  v_md5 text;
begin
  select md5(pg_get_functiondef(p.oid)) into v_md5
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'handle_new_user';

  if v_md5 <> '6eccc287be2c1bb645b28fbe8ccbe644' then
    raise exception 'ROLLBACK SELF-CHECK FAILED: definition md5 is now %, '
                    'expected 6eccc287be2c1bb645b28fbe8ccbe644.', v_md5;
  end if;

  if not exists (select 1 from pg_proc
                  where pronamespace='public'::regnamespace
                    and proname='handle_new_user' and prosecdef) then
    raise exception 'ROLLBACK SELF-CHECK FAILED: SECURITY DEFINER not restored.';
  end if;

  if not exists (select 1 from pg_trigger t
                   join pg_class c on c.oid = t.tgrelid
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname='auth' and c.relname='users'
                    and t.tgname='on_auth_user_created' and not t.tgisinternal) then
    raise exception 'ROLLBACK SELF-CHECK FAILED: the trigger is missing.';
  end if;

  raise notice 'ROLLBACK OK: handle_new_user restored byte-for-byte (md5 %). '
               'Signup is broken again, which is the pre-0019c state.', v_md5;
end
$$;
