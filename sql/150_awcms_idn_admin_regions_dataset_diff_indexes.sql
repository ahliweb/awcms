-- Issue #766 — dataset version comparison ("what actually changes if I
-- activate this?") adds two read shapes `sql/080`'s indexes do not serve:
--
--   1. Per-tier region counts: `GROUP BY level` filtered to one dataset_id.
--      The existing `awcms_idn_admin_regions_dataset_code_key` unique index
--      on `(dataset_id, code)` can restrict the scan to one dataset, but
--      `level` is not in it, so every matching row still needed a heap fetch
--      just to be counted. `(dataset_id, level)` below makes the aggregate an
--      Index Only Scan feeding a GroupAggregate — bounded by the number of
--      rows in the dataset either way, but never touching the heap.
--
--   2. The added/removed/renamed diff: a FULL OUTER JOIN on `code` between
--      two dataset_id's, comparing `official_name`. Each side of the join is
--      already equality-filtered on `dataset_id` and can stream out
--      pre-sorted by `code` from the existing unique index — a Merge Full
--      Join, not a hash of either table — but `official_name` still meant a
--      heap fetch per row on both sides. `(dataset_id, code) INCLUDE
--      (official_name)` below lets Postgres answer the whole join with an
--      Index Only Scan on either side.
--
-- Both are ADDITIVE. `awcms_idn_admin_regions_dataset_code_key` (`sql/080`) is
-- untouched — an APPLIED migration, and this repo's migration-immutability
-- rule forbids editing it; nothing here changes what it enforces.
--
-- No RLS/tenant-scoping question here: `awcms_idn_admin_regions` is GLOBAL
-- reference data (ADR-0046 §3, `sql/080`'s own header) — these are ordinary
-- read-path indexes on it, not a new privilege surface.

CREATE INDEX IF NOT EXISTS awcms_idn_admin_regions_dataset_level_idx
  ON awcms_idn_admin_regions (dataset_id, level);

CREATE INDEX IF NOT EXISTS awcms_idn_admin_regions_dataset_code_name_idx
  ON awcms_idn_admin_regions (dataset_id, code) INCLUDE (official_name);
