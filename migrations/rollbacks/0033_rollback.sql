-- Rollback for 0033. A view with no dependants; nothing else was touched.
drop view if exists v_recipe_line_costs;
