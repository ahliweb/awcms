-- news_portal — tenant-scoped, R2-only media object metadata registry for
-- news images (used by blog_content featured/gallery images, homepage
-- sections, ads, SEO share images, and video thumbnails). Ported from
-- awcms-mini (epic `news_portal` #631-#642/#649; mini migrations 041 schema +
-- 046 orphan-lifecycle column, consolidated here into one coherent fresh-DB
-- CREATE TABLE). Metadata only — no binary column exists or will ever be
-- added here; the actual image bytes live in Cloudflare R2 (bucket configured
-- via `NEWS_MEDIA_R2_*`, `news-portal/domain/news-media-r2-config.ts` —
-- deliberately a separate bucket/credentials from `sync-storage`'s own `R2_*`).
--
-- ## Status enum
--
-- 7-state (`pending_upload|uploaded|verified|attached|orphaned|deleted|
-- failed`): `pending_upload` = created, no bytes yet; `uploaded` = R2 PUT
-- succeeded; `verified` = MIME/checksum/dimensions verified server-side;
-- `attached` = actually referenced by an owning resource; `orphaned` =
-- flagged for cleanup; `deleted` = soft-deleted status marker; `failed` =
-- upload/verification failed. Soft delete (`deleted_at`) is ORTHOGONAL to
-- `status` (same convention as `awcms_blog_posts`): deleting/restoring a row
-- never rewrites `status`, only toggles `deleted_at`/`deleted_by`/
-- `delete_reason`/`restored_at`/`restored_by`.
--
-- ## `owner_resource_type`/`owner_resource_id` — generic polymorphic
-- reference, no FK
--
-- A loose `(text, uuid)` pair (same PATTERN as `awcms_audit_events`/
-- `awcms_workflow_instances`'s polymorphic `resource_type`/`resource_id`),
-- CHECK-constrained to a fixed enum, so one registry serves every consumer
-- (blog post/page, homepage section, gallery item, ad, video thumbnail, SEO
-- image) without a table-specific FK per consumer and without this migration
-- depending on blog_content's schema. Both columns are NULL until a row
-- reaches `status='attached'` (enforced by the check constraint below).
--
-- ## RLS / GRANT
--
-- `ENABLE`+`FORCE` + the standard `tenant_isolation` policy (sql/019's
-- `awcms_app` connects as a non-owner role, so `ENABLE` alone would be inert
-- — `FORCE` is required). No explicit `GRANT` for `awcms_app`: sql/019's
-- `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES TO awcms_app` already
-- covers every table created by the migration owner. The `awcms_worker` grant
-- at the bottom is for the `news-media:reconcile` job (see below).
--
-- ## `orphaned_at` (folded in from mini migration 046)
--
-- Records the EXACT moment a row transitioned to `status='orphaned'` so the
-- reconciliation job (`scripts/news-media-r2-reconcile.ts`,
-- `bun run news-media:reconcile`) measures the orphan grace period
-- (`NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS`, default 30 days) from that moment, not
-- from `updated_at` (which any unrelated column update would reset). A CHECK
-- constraint (mirroring the `owner_consistency_check` idiom) keeps it non-null
-- exactly when `status='orphaned'` and null otherwise.

CREATE TABLE IF NOT EXISTS awcms_news_media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  module_key text NOT NULL DEFAULT 'news_portal',
  owner_resource_type text,
  owner_resource_id uuid,
  storage_driver text NOT NULL DEFAULT 'cloudflare_r2',
  bucket_name text NOT NULL,
  object_key text NOT NULL,
  original_filename text,
  public_url text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint,
  checksum_sha256 text,
  width integer,
  height integer,
  alt_text text,
  caption text,
  status text NOT NULL DEFAULT 'pending_upload',
  orphaned_at timestamptz,
  created_by_tenant_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_news_media_objects_module_key_check
    CHECK (module_key = 'news_portal'),
  CONSTRAINT awcms_news_media_objects_storage_driver_check
    CHECK (storage_driver = 'cloudflare_r2'),
  -- Schema-level defense in depth for the object key convention
  -- (`news-media/{tenantId}/{yyyy}/{mm}/{uuid}.{ext}`) — the application layer
  -- (`news-media-object-key.ts`) is the primary enforcement point; this CHECK
  -- rejects a row that somehow bypassed that helper. References this row's own
  -- `tenant_id`, so the prefix is verified per-row.
  CONSTRAINT awcms_news_media_objects_object_key_format_check
    CHECK (object_key ~ ('^news-media/' || tenant_id::text || '/[0-9]{4}/[0-9]{2}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-z0-9]+$')),
  CONSTRAINT awcms_news_media_objects_status_check
    CHECK (status IN (
      'pending_upload', 'uploaded', 'verified', 'attached',
      'orphaned', 'deleted', 'failed'
    )),
  CONSTRAINT awcms_news_media_objects_owner_resource_type_check
    CHECK (owner_resource_type IS NULL OR owner_resource_type IN (
      'blog_post', 'blog_page', 'homepage_section', 'gallery_item',
      'ad', 'video_thumbnail', 'seo_image'
    )),
  -- Attach requires both owner columns; anything else must leave them NULL.
  CONSTRAINT awcms_news_media_objects_owner_consistency_check
    CHECK (
      (status = 'attached'
        AND owner_resource_type IS NOT NULL AND owner_resource_id IS NOT NULL)
      OR
      (status <> 'attached'
        AND owner_resource_type IS NULL AND owner_resource_id IS NULL)
    ),
  -- `orphaned_at` is non-null exactly when `status='orphaned'`.
  CONSTRAINT awcms_news_media_objects_orphaned_at_consistency_check
    CHECK (
      (status = 'orphaned' AND orphaned_at IS NOT NULL)
      OR
      (status <> 'orphaned' AND orphaned_at IS NULL)
    ),
  CONSTRAINT awcms_news_media_objects_size_bytes_check
    CHECK (size_bytes IS NULL OR size_bytes > 0),
  CONSTRAINT awcms_news_media_objects_width_check
    CHECK (width IS NULL OR width > 0),
  CONSTRAINT awcms_news_media_objects_height_check
    CHECK (height IS NULL OR height > 0)
);

-- Object key already embeds tenant_id + a random UUID, so it can never
-- collide across tenants in practice — the unique index is still scoped
-- `(tenant_id, object_key)` per this repo's tenant-scoped-uniqueness
-- convention.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_news_media_objects_tenant_key_dedup
  ON awcms_news_media_objects (tenant_id, object_key);

CREATE INDEX IF NOT EXISTS idx_awcms_news_media_objects_tenant
  ON awcms_news_media_objects (tenant_id);

CREATE INDEX IF NOT EXISTS idx_awcms_news_media_objects_tenant_created
  ON awcms_news_media_objects (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_awcms_news_media_objects_active
  ON awcms_news_media_objects (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Also covers the reconciliation sweep prefix (`tenant_id`, `status`
-- WHERE deleted_at IS NULL) — the `status='orphaned'` filter is highly
-- selective, so no dedicated `orphaned_at` index is added.
CREATE INDEX IF NOT EXISTS idx_awcms_news_media_objects_tenant_status
  ON awcms_news_media_objects (tenant_id, status)
  WHERE deleted_at IS NULL;

-- Owner lookup ("which media objects are attached to this blog post?").
CREATE INDEX IF NOT EXISTS idx_awcms_news_media_objects_owner
  ON awcms_news_media_objects (tenant_id, owner_resource_type, owner_resource_id)
  WHERE deleted_at IS NULL AND owner_resource_type IS NOT NULL;

ALTER TABLE awcms_news_media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_news_media_objects FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_news_media_objects_tenant_isolation
  ON awcms_news_media_objects
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- `awcms_worker` least-privilege role (sql/022) — the `news-media:reconcile`
-- job (`scripts/news-media-r2-reconcile.ts`) needs SELECT (reconciliation
-- snapshot query), UPDATE (claim pending_upload/uploaded rows to `failed`,
-- soft-delete stale `orphaned` rows), and DELETE (hard-delete expired `failed`
-- rows). Its own audit INSERT reuses `awcms_audit_events` (already granted to
-- awcms_worker in sql/022). No access to any global table.
GRANT SELECT, UPDATE, DELETE ON awcms_news_media_objects TO awcms_worker;
