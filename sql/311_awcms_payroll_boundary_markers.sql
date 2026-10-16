-- Payroll boundary markers (Issue #1077, M1; `docs/awcms/hr-payroll.md` section 13.3).
--
-- The payroll boundary's family is NAME-based (`isPayrollTable`), so a payroll
-- table renamed out of it, with its triggers dropped, left both gate layers
-- silent. A COMMENT travels with the table through RENAME, which a name does
-- not: `payroll:catalog-boundary:check` now fails when a table carrying the
-- `payroll-boundary` marker has no family name, when a family table lacks the
-- marker, and when a table in `PAYROLL_REQUIRED_TABLES`
-- (src/modules/_shared/payroll-data-boundary.ts) is missing from the catalog.
--
-- The comment text after the marker is the pre-existing description, verbatim.
-- A phase-3 payroll table adds its own marker in the migration that creates it,
-- and its name to PAYROLL_REQUIRED_TABLES.

COMMENT ON TABLE awcms_hr_commission_accruals IS
  'payroll-boundary: Issue #951 / ADR-0132 — CONFIDENTIAL (a person''s earnings). The commission ledger: monetary facts immutable by trigger, only status and its stamps advance (pending -> approved -> payable -> paid, or voided from pending/approved), unique per source identity and employment, never deleted. References an employment, stores no name or identifier.';

COMMENT ON TABLE awcms_hr_commission_transitions IS
  'payroll-boundary: Issue #951 / ADR-0132 — CONFIDENTIAL. Append-only log of accrual status changes, written only by the accrual''s own triggers, so an accrual''s status always equals its latest transition.';
