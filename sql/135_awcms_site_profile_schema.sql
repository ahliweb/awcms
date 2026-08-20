-- `site_profile` — a tenant states who it is (Issue #596, PRD §25/§26.2,
-- FR-TEN-004, ADR-0102).
--
-- Today a footer, a masthead, a contact page and an `Organization` JSON-LD node
-- all have to HARD-CODE the site's identity in frontend source: there is no
-- logo, favicon, editorial address, contact email, WhatsApp number, copyright
-- line, tagline or social profile link anywhere in `blog_content`, `theming` or
-- `seo_distribution`. That directly violates PRD §25 ("tanpa edit source code")
-- and makes a second tenant impossible without a fork.
--
-- ## Why a new module rather than more columns on `awcms_seo_tenant_settings`
--
-- ADR-0102 records the decision and its cost. The short form: `theming`'s
-- charter is PRESENTATION and its token values are validated against a strict
-- CSS grammar — an editorial address is not a design token, and putting it
-- there abuses the module whose entire value is that strictness.
-- `seo_tenant_settings` is closer, but its charter is what CRAWLERS see.
--
-- ## The boundary this table draws, and why it is not arbitrary
--
-- `awcms_seo_tenant_settings` keeps the four identity-looking fields it already
-- owns — `site_name`, `organization_name`, `organization_logo_media_id`,
-- `default_social_media_id` — because each is an SEO OUTPUT: `og:site_name`,
-- the JSON-LD `Organization` node, the default `og:image`. They are consumed by
-- a renderer that emits meta tags.
--
-- This table owns SITE CHROME: what a human reads in a masthead, a footer or a
-- contact page. Nothing here is duplicated from there, so there is no second
-- copy of any value to drift.
--
-- Consumers are not asked to know that split. `GET /api/v1/site-profile/public`
-- COMPOSES both halves into one answer, so a build client asks one place. The
-- split is an ownership boundary, not a lookup problem.
--
-- ## Everything is nullable, on purpose
--
-- A tenant that has filled in nothing is a valid tenant, and the renderer's job
-- is to omit what is absent rather than print a placeholder. There is no
-- `NOT NULL` here beyond the key and the timestamps: requiring a WhatsApp
-- number to save an editorial address would make the screen unusable for the
-- half of tenants that have one and not the other.

CREATE TABLE IF NOT EXISTS awcms_site_profile (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),

  -- Masthead/footer identity. `tagline` is the short line under a masthead;
  -- `copyright_notice` is the footer line, stored as text rather than
  -- generated, because "© 2026 Nama Media" and "© Nama Media. Hak cipta
  -- dilindungi undang-undang." are both legitimate and neither is derivable.
  tagline text,
  copyright_notice text,

  -- Media object ids, resolved through `media_library`'s port at render time —
  -- never a raw URL, so managed-media enforcement keeps working. No FK: the
  -- media registry is per-tenant and a hard reference would make deleting an
  -- object impossible while a profile pointed at it; the port already reports
  -- an unresolvable id, and a masthead with no logo is a better failure than a
  -- delete that cannot proceed.
  logo_media_id uuid,
  -- Distinct from the logo: a favicon is square, tiny, and usually a different
  -- crop. One field for both would force every tenant to accept whichever
  -- compromise the renderer picked.
  favicon_media_id uuid,

  -- Editorial identity (PRD §25). `editorial_address` is free text and
  -- multi-line on purpose — Indonesian addresses do not decompose into
  -- street/city/postcode reliably, and forcing them to would produce a form
  -- nobody can fill in correctly.
  editorial_address text,
  contact_email text,
  contact_phone text,
  -- Kept separate from `contact_phone`: a newsroom's WhatsApp tip line is
  -- frequently NOT its switchboard number, and merging them loses that.
  whatsapp_number text,

  -- Social profile links, `[{ "platform": "...", "url": "..." }]`. jsonb rather
  -- than columns because the set of platforms is not ours to close — a
  -- `tiktok_url` column added per platform is a migration per fashion cycle.
  -- Validated in the domain layer against an allow-list of http(s) URLs; the
  -- CHECK below only holds the SHAPE, because a CHECK cannot express "every
  -- element has a safe URL" without a function this table should not own.
  social_links jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,

  CONSTRAINT awcms_site_profile_tagline_len
    CHECK (tagline IS NULL OR char_length(tagline) <= 200),
  CONSTRAINT awcms_site_profile_copyright_len
    CHECK (copyright_notice IS NULL OR char_length(copyright_notice) <= 300),
  CONSTRAINT awcms_site_profile_address_len
    CHECK (editorial_address IS NULL OR char_length(editorial_address) <= 1000),
  CONSTRAINT awcms_site_profile_email_len
    CHECK (contact_email IS NULL OR char_length(contact_email) <= 320),
  CONSTRAINT awcms_site_profile_phone_len
    CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 50),
  CONSTRAINT awcms_site_profile_whatsapp_len
    CHECK (whatsapp_number IS NULL OR char_length(whatsapp_number) <= 50),
  -- An ARRAY, not an object or a scalar. Without this a malformed write could
  -- store `{}` and every consumer's `.map` would throw at render time, on the
  -- public surface, long after the write that caused it.
  CONSTRAINT awcms_site_profile_social_links_is_array
    CHECK (jsonb_typeof(social_links) = 'array'),
  -- Bounded so one tenant cannot store a megabyte of links that every public
  -- page render then has to read.
  CONSTRAINT awcms_site_profile_social_links_bounded
    CHECK (jsonb_array_length(social_links) <= 20)
);

COMMENT ON TABLE awcms_site_profile IS
  'Issue #596 / ADR-0102 — per-tenant SITE CHROME: masthead, footer, editorial and contact identity. SEO defaults (og:site_name, JSON-LD Organization, default og:image) stay in awcms_seo_tenant_settings; GET /api/v1/site-profile/public composes both so consumers ask one place.';

ALTER TABLE awcms_site_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_site_profile FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_site_profile_tenant_isolation
  ON awcms_site_profile
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- No `awcms_app` GRANT: sql/019's `ALTER DEFAULT PRIVILEGES IN SCHEMA public`
-- already covers tables created afterwards. No `awcms_worker` GRANT either —
-- no job reads or writes this table.

-- Permission catalog seed. Verbatim match to the constants in
-- `src/modules/site-profile/domain/site-profile-permissions.ts` and to
-- `module.ts`'s `permissions` array.
--
-- ONLY tenants created AFTER this migration runs pick these up automatically,
-- via the setup bootstrap's `INSERT INTO awcms_role_permissions ... SELECT ...
-- FROM awcms_permissions` — the same limitation every prior permission-seed
-- migration in this repo carries, stated rather than quietly worked around. An
-- EXISTING tenant will 403 until an operator grants them.
--
-- `read` and `update` are split for the reason sql/058 gives for splitting
-- `seo_distribution.config.*`: changing what every public page's footer and
-- contact details say is a different power from reading them, and an
-- organisation that lets a contributor read its own address does not thereby
-- want that contributor changing the newsroom's published phone number.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('site_profile', 'profile', 'read',
   'Read this tenant''s site identity — masthead, footer, editorial address and contact details'),
  ('site_profile', 'profile', 'update',
   'Change this tenant''s site identity, including the contact details and social links every public page renders')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
