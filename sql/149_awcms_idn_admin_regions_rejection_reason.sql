-- Issue #768 — `rejected` was a dataset status declared by sql/080's CHECK
-- constraint, `DatasetStatus`, and `/admin/idn-regions`'s `statusVariant()`,
-- and written by no code path. `idn-regions:import` validates the vendored
-- dump WHOLE and refuses to write a partial region hierarchy on failure — the
-- right call for `awcms_idn_admin_regions` — but that meant a failed import
-- also wrote no dataset row, so the failure existed only in the shell/CI log
-- of whoever ran it. On `/admin/idn-regions`, "a dataset that failed to
-- import" and "a dataset never attempted" were indistinguishable.
--
-- This adds the one thing the `rejected` status needed to become real: a place
-- to record WHY. `rejection_reason` carries the joined validation problems
-- from `planDatasetImport` (unparsed lines, duplicate codes, orphaned
-- parents, a missing tier) — rendered on the admin screen as escaped TEXT,
-- never HTML. The CHECK below ties the column to the status by construction:
-- a `rejected` row must carry a reason, and no other status may carry one.
--
-- `sql/080` is an APPLIED migration and stays untouched — see AGENTS.md and
-- this repo's migration-immutability rule.

ALTER TABLE awcms_idn_region_datasets
  ADD COLUMN IF NOT EXISTS rejection_reason text;

COMMENT ON COLUMN awcms_idn_region_datasets.rejection_reason IS
  'Why a `rejected` dataset failed validation — the joined problems planDatasetImport reported (unparsed lines, duplicate codes, orphaned parents, a missing tier). NULL for every other status. Rendered as escaped TEXT on /admin/idn-regions, never HTML. Issue #768.';

ALTER TABLE awcms_idn_region_datasets
  ADD CONSTRAINT awcms_idn_region_datasets_rejection_reason_check
  CHECK (
    (status = 'rejected' AND rejection_reason IS NOT NULL)
    OR (status <> 'rejected' AND rejection_reason IS NULL)
  );
