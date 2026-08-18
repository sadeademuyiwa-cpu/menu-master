-- ============================================================================
-- MENU MASTER NG
-- Migration 0002: add the 'container' unit kind
--
-- THIS FILE MUST RUN ALONE, IN ITS OWN TRANSACTION.
--
-- A paint, basket, tuber or keg is not mass, volume or count. It is a
-- container or a natural item whose conversion to a base unit is specific
-- to the ingredient inside it. Giving it its own kind makes "this unit
-- needs a per ingredient conversion" a queryable fact rather than a
-- convention someone has to remember.
--
-- Postgres will not allow a newly added enum value to be USED in the same
-- transaction that added it. Migration 0003 inserts rows with kind =
-- 'container', so this alter has to commit first. Run 0002 on its own,
-- confirm success, then run 0003.
-- ============================================================================

alter type unit_kind add value if not exists 'container';
