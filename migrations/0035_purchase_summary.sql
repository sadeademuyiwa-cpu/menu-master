-- ============================================================================
-- MENU MASTER NG
-- 0035: purchase summary view
--
-- Requires: 0001-0034 applied.
--
-- WHY
--   The purchases list must show, per purchase, how many items it holds and
--   what was paid in total. Summing line amounts in the browser would put
--   money arithmetic in JavaScript, which the product rule forbids: every
--   financial figure must come from PostgreSQL.
--
--   It also avoids a real PostgREST failure. purchase_lines has TWO foreign
--   keys to both ingredients and purchases -- a composite tenant-scoped one
--   and a simple one -- so an unhinted embed returns PGRST201 "more than one
--   relationship was found" and the page silently renders zero rows. A view
--   resolves the joins in SQL and removes the ambiguity entirely.
--
-- READ ONLY. security_invoker, so RLS on purchases, purchase_lines and
-- suppliers applies to the caller exactly as it does to the tables.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_class where relname = 'v_purchase_summary') then
    raise exception '0035 preflight FAILED: v_purchase_summary already exists.';
  end if;
  if not exists (select 1 from pg_class where relname = 'purchase_lines') then
    raise exception '0035 preflight FAILED: the purchase ledger is missing.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0035 preflight FAILED: policy count is %, expected 116.',
      (select count(*) from pg_policies where schemaname = 'public');
  end if;
end
$$;

create view v_purchase_summary with (security_invoker = on) as
select
  p.id                                   as purchase_id,
  p.account_id,
  p.business_id,
  p.purchase_date,
  p.status,
  p.reference,
  p.reversal_reason,
  p.reverses,
  s.name                                 as supplier_name,
  count(pl.id)::int                      as line_count,
  -- NULL, not 0, when a purchase has no items yet: nothing has been paid and
  -- "N0.00" would read as a real zero-value purchase.
  case when count(pl.id) > 0 then sum(pl.amount) end as total_amount
from purchases p
left join suppliers s      on s.id = p.supplier_id
left join purchase_lines pl on pl.purchase_id = p.id and pl.account_id = p.account_id
group by p.id, p.account_id, p.business_id, p.purchase_date, p.status,
         p.reference, p.reversal_reason, p.reverses, s.name;

comment on view v_purchase_summary is
  'Per-purchase item count and total paid, summed in PostgreSQL so no money '
  'arithmetic happens in the browser. NULL total means no items recorded yet.';

grant select on v_purchase_summary to authenticated;

do $$
declare v_inv boolean;
begin
  select 'security_invoker=on' = any(reloptions) into v_inv
    from pg_class where relname = 'v_purchase_summary';
  if not coalesce(v_inv, false) then
    raise exception '0035 self-check FAILED: the view is not security_invoker.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public') <> 116 then
    raise exception '0035 self-check FAILED: policy count moved.';
  end if;
  raise notice '0035 OK: v_purchase_summary created, security_invoker, 116 policies unchanged.';
end
$$;
