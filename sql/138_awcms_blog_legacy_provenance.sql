-- Issue #599 — an imported article remembers where it came from.
--
-- PRD §41 brings SeputarBorneo in as the second tenant: 23,906 articles that
-- search engines have indexed for years, at URLs shaped
-- `/news/{id_ber}_{slug}.html`. After an import, nothing on the
-- `awcms_blog_posts` row remembers `id_ber`, so the 301 map cannot be derived
-- after the fact — only GUESSED from the slug, and a slug is not stable
-- (an editor fixes a headline, the slug moves, and the guess is now wrong for
-- the URL that has the inbound links).
--
-- Two columns, and the timing is the whole argument: adding them before the
-- import costs one migration, and adding them after 23,906 rows have landed
-- without them costs the provenance permanently. There is no later moment at
-- which this is cheaper.
--
-- ## Why a pair rather than one column
--
-- `legacy_source_id` alone is ambiguous the moment a tenant migrates from two
-- systems, or migrates twice. `legacy_source_system` names the origin
-- ('seputarborneo_ckeditor', a WordPress export, whatever comes next), so
-- "article 4812" is a question with one answer instead of one per import that
-- ever ran. It also makes the redirect map derivable per system rather than by
-- assuming every legacy id shares one namespace.
--
-- ## Why text and not bigint
--
-- `id_ber` is numeric today. The next system's identifier will be a uuid, a
-- slug, or a path. A numeric column would force the next import to either lose
-- information or add a third column, and nothing here does arithmetic on it.
--
-- ## The unique index, and why it is PARTIAL
--
-- Importing the same legacy article twice is the failure that produces two live
-- URLs for one document and splits exactly the ranking this work exists to
-- preserve. So the pair is unique per tenant — but only for rows that HAVE one:
-- every natively-authored post leaves both columns NULL, and a plain unique
-- index over nullable columns would be satisfied by them trivially while a
-- NOT NULL default would be a lie about their origin.
--
-- Soft-deleted rows are deliberately still covered. A re-import that collides
-- with something an editor deleted should stop and be looked at, not silently
-- create a second copy beside a row that can be restored.

ALTER TABLE awcms_blog_posts
  ADD COLUMN IF NOT EXISTS legacy_source_system text,
  ADD COLUMN IF NOT EXISTS legacy_source_id text;

ALTER TABLE awcms_blog_pages
  ADD COLUMN IF NOT EXISTS legacy_source_system text,
  ADD COLUMN IF NOT EXISTS legacy_source_id text;

-- Both or neither. A row naming a system without an id cannot be looked up, and
-- an id without a system is the ambiguity the pair exists to remove.
ALTER TABLE awcms_blog_posts
  DROP CONSTRAINT IF EXISTS awcms_blog_posts_legacy_provenance_check;

ALTER TABLE awcms_blog_posts
  ADD CONSTRAINT awcms_blog_posts_legacy_provenance_check
  CHECK (
    (legacy_source_system IS NULL AND legacy_source_id IS NULL)
    OR (legacy_source_system IS NOT NULL AND legacy_source_id IS NOT NULL)
  );

ALTER TABLE awcms_blog_pages
  DROP CONSTRAINT IF EXISTS awcms_blog_pages_legacy_provenance_check;

ALTER TABLE awcms_blog_pages
  ADD CONSTRAINT awcms_blog_pages_legacy_provenance_check
  CHECK (
    (legacy_source_system IS NULL AND legacy_source_id IS NULL)
    OR (legacy_source_system IS NOT NULL AND legacy_source_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_posts_legacy_source_dedup
  ON awcms_blog_posts (tenant_id, legacy_source_system, legacy_source_id)
  WHERE legacy_source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_pages_legacy_source_dedup
  ON awcms_blog_pages (tenant_id, legacy_source_system, legacy_source_id)
  WHERE legacy_source_id IS NOT NULL;

COMMENT ON COLUMN awcms_blog_posts.legacy_source_id IS
  'Issue #599 — the identifier this article had in the system it was imported from (`id_ber` for the SeputarBorneo CKEditor archive). Written at import; the 301 map is derived FROM it, never guessed from the slug.';

COMMENT ON COLUMN awcms_blog_posts.legacy_source_system IS
  'Issue #599 — which system `legacy_source_id` belongs to, so a tenant that migrates twice does not collapse two id namespaces into one.';
