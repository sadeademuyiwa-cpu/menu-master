-- Rollback for 0042.
--
-- DROP then CREATE for v_onboarding_status: PostgreSQL cannot remove columns
-- from a view in place, so a replace would silently leave the six new ones
-- behind. security_invoker is restated -- a dropped view loses it -- and the
-- grant is reissued because dropping discards it.
begin;

drop view if exists v_ingredient_price_status;

-- v_onboarding_status reads v_product_attention, so it must go first.
drop view if exists v_onboarding_status;
drop view if exists v_product_attention;

create view v_onboarding_status with (security_invoker = on) as
 SELECT account_id,
    id AS business_id,
    name,
    ( SELECT count(*) AS count
           FROM ingredients i
          WHERE i.account_id = b.account_id AND i.deleted_at IS NULL) AS ingredients,
    ( SELECT count(*) AS count
           FROM ingredient_prices ip
          WHERE ip.account_id = b.account_id AND ip.reversed_at IS NULL) AS prices_entered,
    ( SELECT count(*) AS count
           FROM recipes r
          WHERE r.business_id = b.id AND r.deleted_at IS NULL) AS recipes,
    ( SELECT count(*) AS count
           FROM cost_snapshots s
          WHERE s.business_id = b.id AND s.is_complete) AS complete_costings,
    ( SELECT count(*) AS count
           FROM v_missing_unit_conversions m
          WHERE m.account_id = b.account_id AND m.reason <> 'suggested'::text) AS blocking_conversions,
    ( SELECT count(*) AS count
           FROM recipe_prices rp
             JOIN recipes r2 ON r2.id = rp.recipe_id
          WHERE r2.business_id = b.id) AS selling_prices_set
   FROM businesses b
  WHERE deleted_at IS NULL;

-- Restored EXACTLY as the baseline had them: dropping the view discards its
-- grants, and the pre-0042 view carried the four privileges Supabase default
-- privileges give `authenticated`. The write privileges are inert -- the view
-- is not auto-updatable -- but a rollback must not change the security
-- posture in either direction.
grant select, insert, update, delete on v_onboarding_status to authenticated;

commit;
