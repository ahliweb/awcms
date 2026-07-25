-- ADR-0040 (ported from awcms-micro Issue #270, epic #261 Wave 2) — first
-- runtime schema of the `site_search` module: a tenant-scoped, cross-content
-- PostgreSQL full-text search index (projection) plus its tenant config, run
-- ledger, failed-item diagnostics, and opt-in minimized query log.
--
-- ## Why a second index (on top of blog_content's per-table search_vector)
--
-- `blog_content` already keeps a `search_vector` on `awcms_blog_posts`/
-- `awcms_blog_pages` (migration 035) for its OWN in-module search. This module
-- is the CROSS-CONTENT, one-tenant unified index: it aggregates posts, pages,
-- and any future admitted public source into ONE searchable projection with
-- suggestions, rebuild, and reconciliation, without any content module writing
-- to this table and without this module importing a content module's internals
-- (ADR-0040 §3/§4; ADR-0013 §6 — collaboration only through the declared
-- `SearchSourceDescriptor`).
--
-- ## Publication-state is enforced at the source->index boundary, NOT here
--
-- The index NEVER contains a draft/private/deleted/scheduled/unpublished
-- resource: the generic indexer only ever extracts rows that satisfy a source's
-- declarative `publicationFilter`. A `privacy_classification` CHECK pins every
-- stored document to `public` as a defense-in-depth floor, and the search
-- projection is NEVER an authorization source (ADR-0040 threat model).
--
-- ## pg_trgm is justified and narrowly scoped
--
-- The suggestion/typeahead endpoint matches partial title prefixes, which a
-- plain FTS `tsvector` cannot do well. A GIN trigram index on `title` ONLY
-- (never on body) backs that one bounded query; the main search query stays on
-- the `tsvector` GIN index via `websearch_to_tsquery`.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. The unified search index (documents)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_site_search_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The contributing `SearchSourceDescriptor.key` (e.g. `blog_content.post`).
  source_key text NOT NULL,
  -- Opaque `SearchSourceDescriptor.resourceType` (e.g. `blog_post`).
  resource_type text NOT NULL,
  -- The source row's primary key (stored as text — resource ids are generic).
  resource_id text NOT NULL,
  locale text NOT NULL,
  -- Server-derived public path for the resource (built from the descriptor's
  -- urlTemplate at index time) — never a raw tenant-supplied URL.
  url text NOT NULL,
  title text NOT NULL,
  summary text,
  -- Bounded body text kept for `ts_headline` snippet generation (not the full
  -- content — capped so the index never bloats, and snippets stay cheap).
  body_text text,
  -- Tags as an array for display/return in results.
  tags text[] NOT NULL DEFAULT '{}',
  -- Space-joined tags, populated by the indexer (a plain-text mirror of `tags`)
  -- so the generated `search_vector` stays IMMUTABLE — `array_to_string` is only
  -- STABLE, which PostgreSQL rejects inside a `GENERATED ALWAYS` expression, so
  -- the join is done in application code and stored here as plain text.
  tags_text text,
  -- Only public content is ever admitted (never private/admin business data).
  -- Pinned by the CHECK below.
  privacy_classification text NOT NULL DEFAULT 'public',
  -- Snapshot of the source's relevance multiplier (SearchSourceDescriptor.weight)
  -- applied to ts_rank at query time.
  weight numeric NOT NULL DEFAULT 1.0,
  -- The source row's own updated_at — the reconciliation staleness signal.
  source_updated_at timestamptz NOT NULL,
  -- sha256 over the extracted searchable fields — reconcile skips a document
  -- whose checksum already matches (idempotent, matches source checksums).
  source_checksum text NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- PostgreSQL maintains this on every INSERT/UPDATE — no trigger/app code
  -- writes it (same construction as migration 035). `simple` config is
  -- locale-agnostic (no built-in Indonesian config); weights title=A, summary=B,
  -- tags=C, body=D so a title match ranks above a body match.
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(tags_text, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(body_text, '')), 'D')
  ) STORED,
  CONSTRAINT awcms_site_search_documents_privacy_check
    CHECK (privacy_classification = 'public'),
  CONSTRAINT awcms_site_search_documents_title_len
    CHECK (char_length(title) <= 500),
  CONSTRAINT awcms_site_search_documents_summary_len
    CHECK (summary IS NULL OR char_length(summary) <= 2000),
  CONSTRAINT awcms_site_search_documents_body_len
    CHECK (body_text IS NULL OR char_length(body_text) <= 16384),
  CONSTRAINT awcms_site_search_documents_url_len
    CHECK (char_length(url) <= 2048),
  CONSTRAINT awcms_site_search_documents_weight_range
    CHECK (weight > 0 AND weight <= 10)
);

-- One document per resource per locale per source — the reconcile upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_site_search_documents_dedup
  ON awcms_site_search_documents (tenant_id, source_key, resource_id, locale);

-- Main FTS query path.
CREATE INDEX IF NOT EXISTS awcms_site_search_documents_search_vector_idx
  ON awcms_site_search_documents USING GIN (search_vector);

-- Suggestion/typeahead path (trigram, title only — see header).
CREATE INDEX IF NOT EXISTS awcms_site_search_documents_title_trgm_idx
  ON awcms_site_search_documents USING GIN (title gin_trgm_ops);

-- Reconciliation counts + per-source removal walk.
CREATE INDEX IF NOT EXISTS awcms_site_search_documents_tenant_source_idx
  ON awcms_site_search_documents (tenant_id, source_key);

-- Admitted-type filtering + locale-scoped queries.
CREATE INDEX IF NOT EXISTS awcms_site_search_documents_tenant_type_locale_idx
  ON awcms_site_search_documents (tenant_id, resource_type, locale);

ALTER TABLE awcms_site_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_site_search_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_site_search_documents_tenant_isolation
  ON awcms_site_search_documents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 2. Per-tenant search configuration (one row per tenant, upsert-shaped)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_site_search_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  -- Whether public search + suggestions are served for this tenant.
  enabled boolean NOT NULL DEFAULT true,
  -- Admitted resource types (NULL = every type the descriptors admit).
  enabled_resource_types text[],
  result_limit integer NOT NULL DEFAULT 20,
  min_query_length integer NOT NULL DEFAULT 2,
  suggestions_enabled boolean NOT NULL DEFAULT true,
  suggestion_limit integer NOT NULL DEFAULT 8,
  -- Opt-in, minimized query analytics (query HASH + counts only, never raw PII).
  analytics_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT awcms_site_search_settings_result_limit_range
    CHECK (result_limit BETWEEN 1 AND 100),
  CONSTRAINT awcms_site_search_settings_min_query_length_range
    CHECK (min_query_length BETWEEN 1 AND 20),
  CONSTRAINT awcms_site_search_settings_suggestion_limit_range
    CHECK (suggestion_limit BETWEEN 1 AND 20),
  CONSTRAINT awcms_site_search_settings_types_bound
    CHECK (enabled_resource_types IS NULL OR array_length(enabled_resource_types, 1) <= 50)
);

ALTER TABLE awcms_site_search_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_site_search_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_site_search_settings_tenant_isolation
  ON awcms_site_search_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 3. Index run ledger (rebuild / reconcile / reindex observability)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_site_search_index_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  -- tenant_user who triggered it (NULL for the scheduled job).
  triggered_by uuid,
  trigger text NOT NULL DEFAULT 'manual',
  documents_indexed integer NOT NULL DEFAULT 0,
  documents_updated integer NOT NULL DEFAULT 0,
  documents_removed integer NOT NULL DEFAULT 0,
  documents_unchanged integer NOT NULL DEFAULT 0,
  sources_processed integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  -- Sanitized error summary only (never a raw stack trace / secret).
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT awcms_site_search_index_runs_type_check
    CHECK (run_type IN ('rebuild', 'reconcile', 'reindex')),
  CONSTRAINT awcms_site_search_index_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT awcms_site_search_index_runs_trigger_check
    CHECK (trigger IN ('manual', 'scheduled'))
);

CREATE INDEX IF NOT EXISTS awcms_site_search_index_runs_tenant_started_idx
  ON awcms_site_search_index_runs (tenant_id, started_at DESC);

ALTER TABLE awcms_site_search_index_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_site_search_index_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_site_search_index_runs_tenant_isolation
  ON awcms_site_search_index_runs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 4. Failed-item diagnostics (aggregate, upsert-increment — bounded cardinality)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_site_search_index_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  source_key text NOT NULL,
  resource_id text NOT NULL,
  locale text NOT NULL DEFAULT '',
  error_class text NOT NULL,
  -- Sanitized detail only.
  error_detail text,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT awcms_site_search_index_failures_dedup
    UNIQUE (tenant_id, source_key, resource_id, locale)
);

CREATE INDEX IF NOT EXISTS awcms_site_search_index_failures_tenant_last_seen_idx
  ON awcms_site_search_index_failures (tenant_id, last_seen_at);

ALTER TABLE awcms_site_search_index_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_site_search_index_failures FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_site_search_index_failures_tenant_isolation
  ON awcms_site_search_index_failures
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 5. Opt-in, minimized query log (privacy-first — hash + counts only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_site_search_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- sha256 of the NORMALIZED query — the raw query is never stored, so no PII /
  -- sensitive parameter can leak (query logging is opt-in + minimized).
  query_hash text NOT NULL,
  query_length integer NOT NULL,
  locale text NOT NULL,
  result_count integer NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS awcms_site_search_query_log_tenant_occurred_idx
  ON awcms_site_search_query_log (tenant_id, occurred_at);

ALTER TABLE awcms_site_search_query_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_site_search_query_log FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_site_search_query_log_tenant_isolation
  ON awcms_site_search_query_log
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Least-privilege grants
-- ---------------------------------------------------------------------------
-- `awcms_app` gets its table privileges from the blanket grant in migration 019
-- (every table in the schema), so no explicit GRANT is needed here — RLS FORCE
-- above is what actually confines it to one tenant.
--
-- The scheduled `site-search:reconcile` job runs as the least-privilege
-- `awcms_worker` role. It must READ the contributing source tables (declared by
-- their owning module's `SearchSourceDescriptor`; `awcms_blog_posts` already has
-- SELECT from migration 035 and `awcms_tenants` from migration 022 — the latter
-- is how the indexer resolves `:tenantCode` for public URLs), UPSERT/REMOVE
-- index documents, and record run/failure rows. RLS FORCE still applies to the
-- worker role, so each withTenant-scoped pass sees only the tenant it is scoped
-- to.
--
-- `awcms_site_search_query_log` + `..._index_failures` are also registered as
-- `generic`-execution high-volume descriptors in `site-search/module.ts`, so the
-- data_lifecycle purge engine (which also runs as the worker role) needs SELECT
-- + DELETE on them (same pattern as `awcms_seo_not_found_observations`,
-- migration 060).
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_site_search_documents TO awcms_worker;
GRANT SELECT, INSERT, UPDATE ON awcms_site_search_index_runs TO awcms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_site_search_index_failures TO awcms_worker;
GRANT SELECT, DELETE ON awcms_site_search_query_log TO awcms_worker;
GRANT SELECT ON awcms_site_search_settings TO awcms_worker;
