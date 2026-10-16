-- Pin `search_path` on every trigger function that does not have it yet
-- (Issue #1046).
--
-- `awcms_app` and `awcms_worker` hold TEMP, and PostgreSQL resolves an
-- UNQUALIFIED relation name through the session's temp schema before `public`.
-- A guard trigger whose body reads `awcms_inventory_movements` (and does not pin
-- its own `search_path`) therefore reads whatever table the calling role created
-- with `CREATE TEMP TABLE awcms_inventory_movements (...)`, and can be fed rows
-- that make the guard pass. That is how #1032's workflow triggers were
-- bypassed. `tests/integration/function-search-path.integration.test.ts` runs
-- the attack against the transfer-balance guard.
--
-- `SET search_path = pg_catalog, public, pg_temp`:
--   * `pg_catalog` first -- built-ins cannot be shadowed by anything in `public`
--     (no body below calls a function that `public` redefines; every object this
--     repo creates is `awcms_`-prefixed, and extension functions installed in
--     `public` stay reachable through the `public` entry);
--   * `public` -- the schema every body's tables, helper functions and
--     extension functions live in;
--   * `pg_temp` LAST -- naming it explicitly is what demotes the temp schema,
--     which is otherwise searched FIRST for relations. `SET search_path = public`
--     alone would not help.
--
-- Every SECURITY DEFINER function and every trigger function written from
-- `sql/184` onward already carries `SET search_path = public, pg_temp`, which is
-- equally safe (`pg_catalog` is searched first implicitly, `pg_temp` is last), so
-- they are left alone. This migration covers the 30 trigger functions written
-- before that convention (sql/033, 169, 171, 172, 174, 176, 180, 182, 228, 252, and the sql/284 booking reminder guard).
--
-- `ALTER FUNCTION ... SET` edits the pin without touching the body, so the
-- already-applied migrations stay byte-identical. The static gate
-- `bun run db:function-search-path:check` folds `ALTER FUNCTION` statements and
-- keeps every future migration honest.

-- sql/033 theming
ALTER FUNCTION awcms_theming_versions_guard()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/169 inventory
ALTER FUNCTION awcms_inventory_reject_mutation()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_inventory_assert_transfer_balanced()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_inventory_assert_reversal_matches()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/171 tax rule versions
ALTER FUNCTION awcms_tax_rule_versions_guard()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_tax_rule_versions_no_overlap()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/172 tax snapshots
ALTER FUNCTION awcms_tax_snapshots_immutable()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_tax_snapshots_guard()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/174 procurement
ALTER FUNCTION awcms_procurement_reject_mutation()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_procurement_guard_document_insert()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_procurement_guard_document_update()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_procurement_guard_line_write()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/176 hr workforce
ALTER FUNCTION awcms_hr_reject_mutation()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_hr_guard_employment_update()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_hr_guard_term_insert()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_hr_stamp_termination()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_hr_guard_term_update()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_hr_guard_profile_merge()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/180 booking
ALTER FUNCTION awcms_booking_reject_mutation()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_booking_guard_reservation_insert()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_booking_guard_reservation_update()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_booking_guard_item_insert()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/182 hr commission rules
ALTER FUNCTION awcms_hr_commission_rules_guard()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_hr_commission_rules_insert_guard()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_hr_commission_rules_no_overlap()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/228 hr employment link
ALTER FUNCTION awcms_hr_guard_employment_link()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/252 workflow approval immutability
ALTER FUNCTION awcms_workflow_decisions_reject_mutation()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_workflow_instances_guard()
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION awcms_workflow_tasks_guard()
  SET search_path = pg_catalog, public, pg_temp;

-- sql/284 booking reminder intents (#943, merged after this migration was
-- written; the gate caught it on integration)
ALTER FUNCTION awcms_booking_guard_reminder_intent_update()
  SET search_path = pg_catalog, public, pg_temp;
