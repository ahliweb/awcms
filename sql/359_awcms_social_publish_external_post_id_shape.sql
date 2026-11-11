-- social_publishing -- the provider's post id is an IDENTIFIER, not free text
-- (Issue #1145, residual L6 of the ADR-0157 audit). Forward-only; `sql/330` is
-- applied and is NOT edited.
--
-- `sql/330` bounded `external_post_id` by length only (1..255). It is written
-- from an adapter's answer and then appears in responses, events and audit rows,
-- so any string a provider (or a buggy adapter) returned could carry a provider
-- body or a credential into all three. The dispatcher now checks the id against
-- the adapter's declared per-provider pattern (`externalPostIdPattern`) and
-- answers `unknown` when it does not match; this CHECK is the database's floor
-- under that: an identifier alphabet every supported provider's ids fit (numeric
-- ids, `123_456` page-post ids, YouTube's `[A-Za-z0-9_-]` ids, LinkedIn URNs such
-- as `urn:li:share:123`), at most 128 characters, no whitespace, no `/`, `?`,
-- `&`, `=`, quotes or `@`.
--
-- No adapter has ever been registered (connectors are #1146 to #1151), so no row
-- can hold a post id that a provider returned; VALIDATE therefore checks only
-- rows a test fixture or the dispatcher's own fallback wrote.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

ALTER TABLE awcms_social_publish_jobs
  ADD CONSTRAINT awcms_social_publish_jobs_external_post_id_shape_check
  CHECK (
    external_post_id IS NULL
    OR external_post_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ) NOT VALID;

ALTER TABLE awcms_social_publish_jobs
  VALIDATE CONSTRAINT awcms_social_publish_jobs_external_post_id_shape_check;
