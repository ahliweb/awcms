-- blog_content — ADR-0044 §4, second step: provenance and least-privilege
-- grants for the legacy advertisement ingest job (`bun run blog:ads:ingest`).
--
-- Migration 078 widened the surviving ad table so it COULD hold what the
-- free-URL system held. This one makes moving the rows safe to attempt more
-- than once, and lets the drop that follows be verified rather than trusted.
--
-- ## `source_legacy_ad_id`
--
-- Records which `awcms_blog_ads` row a placement was ingested from. It buys
-- two things a data migration cannot do without:
--
--   1. **Idempotency.** The ingest job is operator-run against live data and
--      will be run more than once — first as a preview, then for real, then
--      again after an operator re-uploads the images that came back as
--      residue. Without a marker, run two duplicates every ad that run one
--      already moved, and the duplicates are indistinguishable from ads an
--      editor created on purpose.
--   2. **A verifiable drop.** Before `awcms_blog_ads` is dropped, someone has
--      to answer "did every ad either move or get reported?". With this column
--      that is a join. Without it, it is a promise.
--
-- The unique index is PARTIAL (`WHERE source_legacy_ad_id IS NOT NULL`) and
-- that is load-bearing, not tidiness. Every row written by hand has a NULL
-- here, and `NULLS NOT DISTINCT` would make two hand-created global placements
-- in the same tenant collide with each other — the constraint would reject
-- ordinary editorial work. `NULLS NOT DISTINCT` is still wanted INSIDE the
-- partial set, because an ingested `global` row has a NULL `target_id` and two
-- of those from the same legacy ad genuinely are the same row.
--
-- ## Grants
--
-- `awcms_app` needs nothing new: `sql/019` set default privileges in schema
-- public, so it already holds full DML on all four tables.
--
-- `awcms_worker` runs the ingest and holds NOTHING today on any of them. The
-- verbs below are traced from what the job actually does, and no further:
--
--   * `awcms_blog_ads`, `awcms_blog_ad_placements` — SELECT only. The job
--     reads the legacy rows and never edits or deletes them; retiring them is
--     the NEXT step's decision, taken by a human who has read the residue
--     report, not a side effect of the job that produced it.
--   * `awcms_news_portal_ad_placements` — SELECT + INSERT. It creates
--     successor rows and reads back what it already created (idempotency). No
--     UPDATE, no DELETE: the job may add, never rewrite.
--
-- `awcms_news_media_objects` is deliberately ABSENT from the list above, and
-- the reason is the most important design decision in this step. An earlier
-- draft granted the worker INSERT there, so the job could register a media row
-- for an image sitting in the tenant's R2 prefix. That would have fabricated a
-- `verified` registry row for bytes the job never fetched, sniffed, or
-- size-capped — a migration script quietly minting the exact assertion the
-- upload pipeline exists to make.
--
-- Instead the job LOOKS UP an existing registry row by object key, and an
-- image with no row is residue. The consequence is that every migrated ad
-- points at a media object that went through the real verification path, and
-- the job needs only the SELECT the worker already holds from `sql/041`. No
-- grant on this table changes here.
--
-- `scripts/security-readiness.ts`'s `WORKER_ROLE_GRANTS` is the single source
-- of truth for this matrix and is updated in the same change;
-- `tests/db-role-separation-worker-setup-migration.test.ts` holds the two to
-- each other, so a grant added here and forgotten there fails the build.

ALTER TABLE awcms_news_portal_ad_placements
  ADD COLUMN IF NOT EXISTS source_legacy_ad_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS awcms_news_portal_ad_placements_legacy_source_idx
  ON awcms_news_portal_ad_placements
     (tenant_id, source_legacy_ad_id, target_type, target_id)
  NULLS NOT DISTINCT
  WHERE source_legacy_ad_id IS NOT NULL;

GRANT SELECT ON awcms_blog_ads TO awcms_worker;
GRANT SELECT ON awcms_blog_ad_placements TO awcms_worker;
GRANT SELECT, INSERT ON awcms_news_portal_ad_placements TO awcms_worker;
