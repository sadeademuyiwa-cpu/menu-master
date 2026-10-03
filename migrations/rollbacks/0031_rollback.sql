-- Rollback for 0031. The table is new and carries no dependants at deploy time.
drop trigger if exists trg_subscription_changes_append_only on subscription_changes;
drop table if exists subscription_changes;
drop function if exists fn_guard_subscription_changes();
