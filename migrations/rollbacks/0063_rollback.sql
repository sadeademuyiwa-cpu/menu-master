-- ============================================================================
-- 0063 ROLLBACK: remove the four mm_dish_* storage policies and
-- recipes.photo_path. Back at 0062.
--
-- Roll the app back FIRST: an app that reads photo_path fails to load Home,
-- Dishes and New sale once the column is gone.
--
-- Which photo belongs to which dish is lost with the column. The files are
-- not: the bucket is kept whenever it holds any, because Supabase does not
-- allow deleting storage rows from SQL. With the policies gone nobody can
-- upload, replace or list there any more. To remove them, empty and delete
-- the bucket in Supabase -> Storage. An EMPTY bucket is removed here, so a
-- rollback straight after a deploy leaves exactly the 0062 state; if the
-- platform refuses even that, the bucket stays and the rollback still
-- completes.
-- ============================================================================
drop table if exists _tx_probe;
create temp table _tx_probe as select pg_current_xact_id() as x;
do $guard$
begin
  if (select x from _tx_probe) <> pg_current_xact_id() then
    raise exception '0063 rollback ABORT: this executor is not honouring transaction control. '
      'Run it with psql --single-transaction.';
  end if;
end
$guard$;
drop table _tx_probe;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='recipes' and column_name='photo_path')
     and not exists (select 1 from pg_policies where schemaname='storage' and policyname like 'mm\_dish\_%') then
    raise exception '0063 rollback: neither recipes.photo_path nor the mm_dish_* policies exist; 0063 is not applied.';
  end if;
  if to_regprocedure('public.fn_menu_prices()') is not null then
    raise exception '0063 rollback: 0064 is still applied (fn_menu_prices exists). Run 0064_rollback.sql first.';
  end if;
end
$$;

drop policy if exists mm_dish_select on storage.objects;
drop policy if exists mm_dish_delete on storage.objects;
drop policy if exists mm_dish_update on storage.objects;
drop policy if exists mm_dish_insert on storage.objects;

alter table recipes drop constraint if exists ck_recipes_photo_path;
alter table recipes drop column if exists photo_path;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'dish') then
    raise notice '0063 rollback: bucket "dish" holds % file(s) and is kept. Empty and delete it in Supabase -> Storage.',
      (select count(*) from storage.objects where bucket_id = 'dish');
  else
    begin
      delete from storage.buckets where id = 'dish';
    exception when others then
      raise notice '0063 rollback: the platform refused to delete the empty bucket "dish" (%). It is kept; delete it in Supabase -> Storage.', sqlerrm;
    end;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname='storage' and policyname like 'mm\_dish\_%') then
    raise exception '0063 rollback FAILED: an mm_dish_* policy remains.';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='recipes' and column_name='photo_path') then
    raise exception '0063 rollback FAILED: recipes.photo_path remains.';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and policyname like 'mm\_site\_%') <> 4 then
    raise exception '0063 rollback FAILED: the website bucket''s four policies moved.';
  end if;
  if (select count(*) from pg_policies where schemaname='public') <> 118 then
    raise exception '0063 rollback FAILED: policy count is %, expected 118.',
      (select count(*) from pg_policies where schemaname='public');
  end if;
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%') <> 98 then
    raise exception '0063 rollback FAILED: fn_* count is %, expected 98.',
      (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'fn\_%');
  end if;
  raise notice '0063 rollback OK: back at 0062. %',
    case when exists (select 1 from storage.buckets where id = 'dish')
         then 'Bucket "dish" is kept; nobody can upload to it.'
         else 'Bucket "dish" removed (it was empty).' end;
end
$$;
