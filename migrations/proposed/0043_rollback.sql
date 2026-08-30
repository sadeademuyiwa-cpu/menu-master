-- Rollback for 0043.
begin;
drop trigger if exists trg_order_lines_scope on order_lines;
drop function if exists fn_order_line_scope();
alter table order_lines drop constraint if exists fk_order_lines_business_id_account;
alter table order_lines drop column if exists business_id;
alter table customers drop column if exists company;
alter table customers drop column if exists notes;
commit;
