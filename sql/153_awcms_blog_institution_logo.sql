-- blog_content — Issue #806: an institution logo (a regency's emblem) that
-- renders once per institution rather than once per article.
--
-- Requested by the derived site `ahliweb/awcms-one` (its issue
-- ahliweb/awcms-one#59, epic ahliweb/awcms-one#46), which re-platforms
-- seputarborneo.com. That site attaches one reusable institutional logo to an
-- article and renders it beside the opening paragraph (seputarborneo.com
-- v2.3.0 "Logo Instansi"). Every such article is filed under that
-- institution here (`awcms_blog_institutions`, sql/131), so the logo belongs
-- on the institution row, once, rather than being retyped onto every post
-- that mentions it — the same "classification dimension owns its own
-- attributes" reasoning sql/131's header already applies to `branch`/
-- `region_code`/the landing-page SEO pair.
--
-- ## Why two columns, and why both nullable
--
-- `logo_media_id` — the media object id, resolved the same way
-- `awcms_blog_posts.featured_media_id` already is: a consumer calls
-- `GET /api/v1/media/objects?ids=` to turn it into a public URL. NULL is the
-- ordinary case — most institutions in a general-purpose tenant have no logo
-- on file, and this is optional metadata, not a required part of registering
-- one (`validateCreateInstitutionInput` does not require it).
--
-- `logo_alt` — free-text alt/caption for the logo image, independent of the
-- media object's own registry metadata (which `media_library` owns and which
-- can be reused across institutions/tenants in principle). Kept alongside
-- `logo_media_id` rather than folded into it, same split
-- `awcms_blog_posts.seo_title`/`seo_description` already keep from the media
-- object they describe.
--
-- ## Why `uuid`/`text`, `NULL`, and no FK — like every other media reference
-- here
--
-- `featured_media_id` (migration 026, Issue #538) and `seo_image_media_id`
-- (Issue #649) are both a loose `uuid` with no foreign key: `media_library`
-- (ADR-0036) is a separate module, and this base's convention is a
-- capability port (`_shared/ports/media-library-port.ts`), never a hard FK
-- across module tables, for that exact relationship. `logo_media_id` follows
-- the identical shape. Existence/ownership/verified-status is NOT enforced by
-- a CHECK — as with `featured_media_id`, that check needs a database round
-- trip against another module's table and runs at the application layer
-- (`institution-logo-reference-gate.ts`, mirroring
-- `news-media-reference-gate.ts`) only when managed-media enforcement is
-- active for the tenant (`MediaLibraryPort.isManagedMediaEnforcementActiveForTenant`)
-- — never at the database.
--
-- No RLS change: `awcms_blog_institutions` is already tenant-scoped and
-- `FORCE ROW LEVEL SECURITY` (migration 131); the existing
-- `awcms_blog_institutions_tenant_isolation` policy already covers every
-- column on the row, these two included.
--
-- No index: neither column is ever filtered or joined on — a consumer reads
-- them off a row already fetched by id/slug, exactly like
-- `awcms_blog_posts.featured_media_id`, which carries no index of its own
-- either.
--
-- GRANTS: none needed. sql/019's `ALTER DEFAULT PRIVILEGES IN SCHEMA public`
-- already covers `awcms_app` for any table the owning role created earlier,
-- and this migration adds columns, not a table.

ALTER TABLE awcms_blog_institutions
  ADD COLUMN IF NOT EXISTS logo_media_id uuid,
  ADD COLUMN IF NOT EXISTS logo_alt text;

COMMENT ON COLUMN awcms_blog_institutions.logo_media_id IS
  'Issue #806 — the institution''s reusable logo/emblem, a media_library object id resolved through GET /api/v1/media/objects?ids= (same shape as awcms_blog_posts.featured_media_id). Deliberately NOT a foreign key: media_library is a separate module reached only through MediaLibraryPort, never a hard FK. Existence/ownership/verified-status is checked at the application layer (institution-logo-reference-gate.ts), gated the same as featured_media_id: only when managed-media enforcement is active for the tenant.';

COMMENT ON COLUMN awcms_blog_institutions.logo_alt IS
  'Issue #806 — alt/caption text for logo_media_id, independent of whatever alt text the media object itself carries in the registry (an institution may want different wording than the file''s own metadata).';
