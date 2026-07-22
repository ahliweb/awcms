-- `blog_content` module — core content schema. Ported/consolidated from
-- awcms-mini migrations 026 (foundation schema), 028 (search_vector made a
-- GENERATED column), 029 (`translation_group_id` columns, presentation
-- schema split into 037), 050 (`seo_image_media_id`), and 051
-- (`auto_internal_tag_links_disabled`) — this is a fresh-DB consolidation:
-- every column below is created in its FINAL shape directly, with no
-- intermediate ALTER/backfill steps mini needed across its own incremental
-- issue history. Seven tables: posts, pages, terms (categories/tags),
-- post-term relations, append-only revisions, redirects, and per-tenant
-- settings. Presentation/monetization tables (templates/menus/widgets/ads/
-- theme) and the internal-tag-linking policy table are separate migrations
-- (037/039) — this one is the module's own core content model.
--
-- Every table is tenant-scoped: `tenant_id uuid NOT NULL REFERENCES
-- awcms_tenants (id)`, `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL
-- SECURITY` (sql/019's `awcms_app` connects as a non-owner role, so `ENABLE`
-- alone would be inert), one `tenant_isolation` policy each (sql/005/008/013
-- convention). No explicit `GRANT` statements are needed for `awcms_app` on
-- the tables below: sql/019's `ALTER DEFAULT PRIVILEGES IN SCHEMA public
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO awcms_app` already
-- covers every table the owning role creates from here on.
--
-- `awcms_worker` (sql/022): the `blog:publish:scheduled` job
-- (`scripts/blog-scheduled-publish.ts`, wired up by migration 036's
-- permission catalog / this module's own `jobs` descriptor) needs SELECT +
-- UPDATE on `awcms_blog_posts` (select the due batch `FOR UPDATE`, then
-- transition it to `published`), SELECT on `awcms_blog_post_terms` (term
-- count for the content quality checklist), and SELECT on
-- `awcms_blog_settings` (checklist policy + social preview fallback). Its
-- own `awcms_audit_events` INSERT is already granted globally in sql/022.
-- Granted at the bottom of this migration (same "grant exactly what the new
-- job touches, right where its tables are created" precedent sql/027 set
-- for `identity-access:business-scope:expiry`).

CREATE TABLE IF NOT EXISTS awcms_blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  author_tenant_user_id uuid NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  excerpt text,
  content_json jsonb NOT NULL,
  content_text text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  visibility text NOT NULL DEFAULT 'public',
  featured_media_id uuid,
  -- Explicit "use THIS image for og:image/twitter:image/JSON-LD image"
  -- override — takes priority over `featured_media_id` when set (mini
  -- migration 050). A plain, FK-less uuid column, same convention as
  -- `featured_media_id` itself — this module has no dependency on a media
  -- registry table (news_media capability, optional/not-yet-ported; see
  -- module.ts).
  seo_image_media_id uuid,
  seo_title text,
  meta_description text,
  canonical_url text,
  locale text NOT NULL DEFAULT 'id',
  -- Optional translation grouping (multilingual content, mini migration
  -- 029): linking two rows as translations of each other means setting the
  -- same `translation_group_id` on both — the application layer's job, no
  -- trigger needed.
  translation_group_id uuid,
  -- Per-post opt-out of automatic internal tag linking (mini migration 051)
  -- — see migration 039's header for the dedicated per-tenant policy table
  -- this pairs with.
  auto_internal_tag_links_disabled boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  version integer NOT NULL DEFAULT 1,
  -- GENERATED from the start (mini's own migration 028 converted this from
  -- a plain nullable column to a generated one after the fact; a fresh DB
  -- can just start here) — PostgreSQL keeps it in sync on every
  -- INSERT/UPDATE, no application code/trigger, no insert/update drift
  -- risk. `simple` text search config (language-agnostic): posts/pages mix
  -- locales per tenant and PostgreSQL has no built-in Indonesian config.
  -- Weighted: title ('A'), excerpt ('B'), content_text ('C').
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content_text, '')), 'C')
  ) STORED,
  CONSTRAINT awcms_blog_posts_status_check
    CHECK (status IN ('draft', 'review', 'scheduled', 'published', 'archived')),
  CONSTRAINT awcms_blog_posts_visibility_check
    CHECK (visibility IN ('public', 'private', 'unlisted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_posts_slug_dedup
  ON awcms_blog_posts (tenant_id, locale, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_blog_posts_tenant_status_published_idx
  ON awcms_blog_posts (tenant_id, status, published_at DESC);

CREATE INDEX IF NOT EXISTS awcms_blog_posts_tenant_author_idx
  ON awcms_blog_posts (tenant_id, author_tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_blog_posts_tenant_deleted_idx
  ON awcms_blog_posts (tenant_id, deleted_at);

CREATE INDEX IF NOT EXISTS awcms_blog_posts_search_vector_idx
  ON awcms_blog_posts USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS awcms_blog_posts_translation_group_idx
  ON awcms_blog_posts (tenant_id, translation_group_id)
  WHERE translation_group_id IS NOT NULL;

-- Scheduled-publish worker's due-batch scan (`status = 'scheduled' AND
-- scheduled_at <= now()`, `ORDER BY scheduled_at ASC`, bounded + `FOR UPDATE
-- SKIP LOCKED`).
CREATE INDEX IF NOT EXISTS awcms_blog_posts_scheduled_due_idx
  ON awcms_blog_posts (tenant_id, scheduled_at)
  WHERE status = 'scheduled' AND deleted_at IS NULL;

ALTER TABLE awcms_blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_posts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_posts_tenant_isolation
  ON awcms_blog_posts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Same core shape as posts, plus page_type/parent_page_id/menu_order.
CREATE TABLE IF NOT EXISTS awcms_blog_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  author_tenant_user_id uuid NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  excerpt text,
  content_json jsonb NOT NULL,
  content_text text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  visibility text NOT NULL DEFAULT 'public',
  featured_media_id uuid,
  seo_title text,
  meta_description text,
  canonical_url text,
  locale text NOT NULL DEFAULT 'id',
  translation_group_id uuid,
  published_at timestamptz,
  scheduled_at timestamptz,
  page_type text NOT NULL DEFAULT 'standard',
  parent_page_id uuid REFERENCES awcms_blog_pages (id),
  menu_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  version integer NOT NULL DEFAULT 1,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content_text, '')), 'C')
  ) STORED,
  CONSTRAINT awcms_blog_pages_status_check
    CHECK (status IN ('draft', 'review', 'scheduled', 'published', 'archived')),
  CONSTRAINT awcms_blog_pages_visibility_check
    CHECK (visibility IN ('public', 'private', 'unlisted')),
  CONSTRAINT awcms_blog_pages_page_type_check
    CHECK (page_type IN ('standard', 'landing', 'legal', 'system'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_pages_slug_dedup
  ON awcms_blog_pages (tenant_id, locale, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_blog_pages_tenant_status_published_idx
  ON awcms_blog_pages (tenant_id, status, published_at DESC);

CREATE INDEX IF NOT EXISTS awcms_blog_pages_tenant_author_idx
  ON awcms_blog_pages (tenant_id, author_tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_blog_pages_tenant_deleted_idx
  ON awcms_blog_pages (tenant_id, deleted_at);

CREATE INDEX IF NOT EXISTS awcms_blog_pages_parent_idx
  ON awcms_blog_pages (parent_page_id);

CREATE INDEX IF NOT EXISTS awcms_blog_pages_search_vector_idx
  ON awcms_blog_pages USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS awcms_blog_pages_translation_group_idx
  ON awcms_blog_pages (tenant_id, translation_group_id)
  WHERE translation_group_id IS NOT NULL;

ALTER TABLE awcms_blog_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_pages FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_pages_tenant_isolation
  ON awcms_blog_pages
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Categories and tags. A tag must never carry a parent_id (also re-checked
-- at the application layer by `domain/taxonomy-policy.ts`'s
-- `validateTermParent` before this constraint is ever reached).
CREATE TABLE IF NOT EXISTS awcms_blog_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  taxonomy_type text NOT NULL,
  parent_id uuid REFERENCES awcms_blog_terms (id),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_blog_terms_taxonomy_type_check
    CHECK (taxonomy_type IN ('category', 'tag')),
  CONSTRAINT awcms_blog_terms_tag_no_parent_check
    CHECK (taxonomy_type <> 'tag' OR parent_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_terms_slug_dedup
  ON awcms_blog_terms (tenant_id, taxonomy_type, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_blog_terms_tenant_idx
  ON awcms_blog_terms (tenant_id, taxonomy_type);

CREATE INDEX IF NOT EXISTS awcms_blog_terms_parent_idx
  ON awcms_blog_terms (parent_id);

ALTER TABLE awcms_blog_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_terms FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_terms_tenant_isolation
  ON awcms_blog_terms
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Post <-> term assignment. Join table carries its own `tenant_id` (not
-- just derivable through the FKs) so RLS can isolate it directly, same
-- convention as every other tenant-scoped table in this base.
CREATE TABLE IF NOT EXISTS awcms_blog_post_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  post_id uuid NOT NULL REFERENCES awcms_blog_posts (id),
  term_id uuid NOT NULL REFERENCES awcms_blog_terms (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_blog_post_terms_unique UNIQUE (post_id, term_id)
);

CREATE INDEX IF NOT EXISTS awcms_blog_post_terms_tenant_idx
  ON awcms_blog_post_terms (tenant_id);

CREATE INDEX IF NOT EXISTS awcms_blog_post_terms_term_idx
  ON awcms_blog_post_terms (term_id);

ALTER TABLE awcms_blog_post_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_post_terms FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_post_terms_tenant_isolation
  ON awcms_blog_post_terms
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Append-only revision history: "Revisions are append-only... Restoring a
-- revision must create a new revision." Same convention as
-- `awcms_workflow_decisions`/`awcms_audit_events`: a single tenant-isolation
-- policy, no UPDATE ever issued by application code.
CREATE TABLE IF NOT EXISTS awcms_blog_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  revision_number integer NOT NULL,
  title text NOT NULL,
  content_json jsonb NOT NULL,
  content_text text NOT NULL,
  excerpt text,
  seo_title text,
  meta_description text,
  canonical_url text,
  status text NOT NULL,
  change_note text,
  created_by_tenant_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_blog_revisions_resource_type_check
    CHECK (resource_type IN ('post', 'page')),
  CONSTRAINT awcms_blog_revisions_unique
    UNIQUE (tenant_id, resource_type, resource_id, revision_number)
);

CREATE INDEX IF NOT EXISTS awcms_blog_revisions_resource_idx
  ON awcms_blog_revisions (tenant_id, resource_type, resource_id, revision_number DESC);

ALTER TABLE awcms_blog_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_revisions_tenant_isolation
  ON awcms_blog_revisions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- URL redirects (e.g. slug changes) — soft-deletable like other
-- master/config data, not append-only.
CREATE TABLE IF NOT EXISTS awcms_blog_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  from_path text NOT NULL,
  to_path text NOT NULL,
  status_code integer NOT NULL DEFAULT 301,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_blog_redirects_status_code_check
    CHECK (status_code IN (301, 302, 307, 308))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_redirects_from_path_dedup
  ON awcms_blog_redirects (tenant_id, from_path)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_blog_redirects_tenant_idx
  ON awcms_blog_redirects (tenant_id);

ALTER TABLE awcms_blog_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_redirects FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_redirects_tenant_isolation
  ON awcms_blog_redirects
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- One row per tenant, same shape/convention as `awcms_tenant_settings`:
-- `tenant_id` itself is the primary key, no separate soft delete (a
-- settings row is configured, not deleted).
CREATE TABLE IF NOT EXISTS awcms_blog_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  default_locale text NOT NULL DEFAULT 'id',
  default_visibility text NOT NULL DEFAULT 'public',
  posts_per_page integer NOT NULL DEFAULT 10,
  seo_default_title text,
  seo_default_description text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_blog_settings_default_visibility_check
    CHECK (default_visibility IN ('public', 'private', 'unlisted'))
);

ALTER TABLE awcms_blog_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_settings_tenant_isolation
  ON awcms_blog_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- `awcms_worker` (sql/022) — exactly what `blog:publish:scheduled`
-- (`scripts/blog-scheduled-publish.ts` -> `application/blog-scheduled-
-- publish.ts`'s `publishDueScheduledPosts`) touches. No DELETE anywhere
-- (this job never removes a row, only transitions status); no grant on
-- `awcms_blog_pages`/terms/etc (the job only ever reads/writes posts +
-- their term ids + tenant settings).
GRANT SELECT, UPDATE ON awcms_blog_posts TO awcms_worker;
GRANT SELECT ON awcms_blog_post_terms TO awcms_worker;
GRANT SELECT ON awcms_blog_settings TO awcms_worker;
