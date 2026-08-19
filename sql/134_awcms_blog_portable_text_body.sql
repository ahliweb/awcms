-- ADR-0100 / Issue #588 — Portable Text becomes the canonical body format.
--
-- A paragraph in the format this replaces is `{ "type": "paragraph", "text":
-- "..." }`. One string. There is no way to bold a word, italicise a phrase or
-- put a link inside a sentence — not "no editor for it", NO PLACE FOR IT IN THE
-- DATA. Every article this CMS has stored is unstyled prose, and no editor
-- could have changed that.
--
-- ## Why a NEW column and not a rewrite of `content_json`
--
-- `content_json` is not body-only, and discovering that is what shaped this
-- migration. `ahliweb/awcms-astro` stores a whole structured sidecar under
-- `content_json.awcmsAstro` — procedure steps, costs, legal basis, FAQ,
-- review dates — and reads the body from `content_json.blocks`. Two
-- consequences, both load-bearing:
--
-- 1. Replacing the envelope would DELETE that sidecar for every article on the
--    sibling site, and nothing in this repo would notice.
-- 2. That repo's renderer returns an empty string for a non-array `blocks`
--    rather than failing. So if this repo simply stopped writing `blocks`, the
--    sibling site would render EVERY ARTICLE AS A BLANK PAGE and its build
--    would stay green.
--
-- So the body moves to its own column, `content_json` survives as the
-- non-body envelope, and `content_json.blocks` keeps being written as a
-- DERIVED PROJECTION of the new column until `awcms-astro` reads Portable Text
-- directly. That projection is an output, not a second source of truth:
-- nothing here reads it, and an edit to it is discarded on the next save.
--
-- ## Why `content_text` stays exactly as it is
--
-- It keeps its column, its two `search_vector` GENERATED expressions and its
-- `site_search` descriptor. What changes is upstream and invisible here: the
-- API stops ACCEPTING it and starts DERIVING it from the body. Today it is a
-- required request field validated independently of `content_json`, with no
-- check that the two agree — so a caller can send a body about one subject and
-- search text about another, and the index believes the search text. Deriving
-- it closes that by construction. No DDL expresses that, which is why it is
-- written down here.
--
-- ## Why `DEFAULT '[]'::jsonb NOT NULL` rather than nullable
--
-- An empty body and an absent body are the same thing for every reader of this
-- column, and a nullable jsonb array invites `coalesce` at each of them. The
-- default also makes this migration safe to apply before the backfill runs:
-- every existing row gets a valid empty document rather than a NULL that each
-- consumer would have to guard. Rows still carrying their real body in
-- `content_json.blocks` are converted by `bun run blog:portable-text:backfill`,
-- which is deliberately NOT run from here — `awcms_blog_posts` is FORCE RLS,
-- and DML inside a migration on a FORCE RLS table is green on an empty CI
-- database and breaks in production.

BEGIN;

ALTER TABLE awcms_blog_posts
  ADD COLUMN IF NOT EXISTS body_portable_text jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE awcms_blog_pages
  ADD COLUMN IF NOT EXISTS body_portable_text jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Revisions carry historical bodies, and a revision restored after the cutover
-- must restore a body the current renderer understands. Without this column a
-- restore would write a legacy envelope into a post whose reader is Portable
-- Text — the "restore revision bypasses the new path" defect this epic has
-- already hit once.
ALTER TABLE awcms_blog_revisions
  ADD COLUMN IF NOT EXISTS body_portable_text jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN awcms_blog_posts.body_portable_text IS
  'ADR-0100 — the canonical article body, Portable Text with a CLOSED vocabulary (see domain/portable-text.ts). content_json.blocks is a derived projection of this column, written only so ahliweb/awcms-astro keeps rendering until it reads this one directly; nothing in this repo reads blocks.';

COMMENT ON COLUMN awcms_blog_pages.body_portable_text IS
  'ADR-0100 — as awcms_blog_posts.body_portable_text.';

COMMENT ON COLUMN awcms_blog_revisions.body_portable_text IS
  'ADR-0100 — the Portable Text body as it stood at this revision, so restoring a revision cannot write a legacy envelope into a post whose reader expects Portable Text.';

-- No index. This column is never a search key or a sort key: full-text search
-- reads the generated `search_vector` over `content_text`, and every read of a
-- body is already by primary key or by the post's own tenant-scoped filters.
-- A GIN index on a jsonb body nobody queries by content would cost every write
-- and serve no read.
--
-- No `awcms_app` GRANT either: sql/019's ALTER DEFAULT PRIVILEGES already
-- covers the table, and a new column inherits the table's privileges.
--
-- `awcms_worker` holds SELECT + UPDATE on awcms_blog_posts (sql/035) for the
-- scheduled-publish job, which is the same grant the backfill script needs; it
-- reads and writes the same table and touches no other.

COMMIT;
