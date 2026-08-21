-- Issue #633 — term facets (channel, topic, institution, region) for site search.
--
-- WHAT WAS ACTUALLY BLOCKING THEM
--
-- PRD FR-DSC-002 asks for facets on channel, institution, region, date, author
-- and content type. #632 landed content type alone, and not for want of time:
-- the other dimensions had nowhere to come from. `awcms_site_search_documents`
-- has `tags text[]`, filled from the search-source descriptor's `tagsColumn`,
-- and `tagsColumn` names ONE COLUMN ON THE SOURCE TABLE. Since sql/131,
-- channel and topic are `awcms_blog_terms` rows reached through
-- `awcms_blog_post_terms`, and institution is `awcms_blog_institutions` reached
-- through `awcms_blog_post_institutions`. A column name cannot express a join,
-- so there was no value `tagsColumn` could have been given that would have been
-- correct.
--
-- WHY A COLUMN AND NOT A SECOND TABLE
--
-- The obvious alternative — one row per (document, facet, value) in its own
-- table — buys nothing here and costs the thing that matters most. A document
-- and its facets are written by ONE upsert; splitting them means a delete/insert
-- cycle that can succeed halfway, and the failure mode is a facet count that
-- disagrees with the documents it claims to describe. The issue warns about
-- exactly that shape for the trigger-maintained variant, and it applies to any
-- design where the two are written separately. As one jsonb column they are the
-- same row, in the same statement, covered by the same checksum: they cannot
-- drift.
--
-- The GIN index makes containment (`@>`) the filter operator, which is what a
-- reader clicking "Politik" performs.
--
-- WHY NOT FOLD THESE INTO `tags`
--
-- `tags` feeds `tags_text`, which feeds the weighted `search_vector`. Putting
-- facet values there would change relevance ranking as a side effect of adding
-- a facet, and would let a reader match `politik` as free text against a value
-- that was meant to be a filter. Facets are a different question from
-- relevance, and this keeps them different columns.

BEGIN;

ALTER TABLE awcms_site_search_documents
  ADD COLUMN IF NOT EXISTS term_facets jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Shape only. WHICH facets exist is decided by the search-source registry (a
-- code-only, reviewed descriptor list validated by `site-search:sources:check`),
-- and a CHECK that tried to enumerate them would go stale the first time a
-- module contributed a new one. What the database CAN usefully refuse is a
-- non-array, because every reader here does `jsonb_array_elements`.
ALTER TABLE awcms_site_search_documents
  DROP CONSTRAINT IF EXISTS awcms_site_search_documents_term_facets_array_check;

ALTER TABLE awcms_site_search_documents
  ADD CONSTRAINT awcms_site_search_documents_term_facets_array_check
    CHECK (jsonb_typeof(term_facets) = 'array');

COMMENT ON COLUMN awcms_site_search_documents.term_facets IS
  'Issue #633 — [{"facet","value","label"}, ...] produced at index time from the owning module''s SearchSourceTermFacet declarations. `value` is what a filter matches and what a URL carries; `label` is what a reader sees. Deliberately NOT part of `tags`/`search_vector`: a facet is a different question from relevance.';

-- `jsonb_path_ops` rather than the default operator class: it supports `@>`,
-- which is the only operator the filter uses, and builds a smaller index than
-- the default (which also indexes keys for `?`/`?|` — operators nothing here
-- issues).
CREATE INDEX IF NOT EXISTS awcms_site_search_documents_term_facets_idx
  ON awcms_site_search_documents USING gin (term_facets jsonb_path_ops);

-- The indexer reads the JOINED tables through the descriptor, and it runs as
-- `awcms_worker`. Migration 013's ALTER DEFAULT PRIVILEGES covers tables this
-- role creates, not tables another migration created, so these are explicit —
-- the same gap that made `awcms_blog_pages` invisible to the indexer in #625
-- until a grant was added. `site-search:sources:check` now walks every table a
-- descriptor names, including the ones it reaches only through a facet join, so
-- the next descriptor that adds a join cannot repeat this.
GRANT SELECT ON awcms_blog_terms TO awcms_worker;
GRANT SELECT ON awcms_blog_post_terms TO awcms_worker;
GRANT SELECT ON awcms_blog_institutions TO awcms_worker;
GRANT SELECT ON awcms_blog_post_institutions TO awcms_worker;

COMMIT;
