-- PRD LenteraKalteng v1.0.0 §8.5/§12/FR-CNT-007/FR-CNT-008 — channel,
-- institution, region, and topic become FOUR SEPARATE DIMENSIONS.
--
-- The legacy portal this requirement comes from carried one string column
-- (`berita_red.jenis_rubrik`) doing all four jobs at once, which is why its
-- archive cannot answer "every article about DPRD Kotawaringin Barat" without
-- a `LIKE`. `awcms_blog_terms` today is closer but still only knows
-- `category` and `tag`, so the same collapse would happen here the first time
-- an editor filed a legislative story: "Legislatif" (a channel), "DPRD
-- Kotawaringin Barat" (an institution), "Kabupaten Kotawaringin Barat" (a
-- region) and "APBD" (a topic) would all land in one flat vocabulary and stop
-- being distinguishable afterwards.
--
-- ## Why channel and topic are TERMS but institution is a TABLE
--
-- A channel and a topic are exactly what a term already is: a tenant-scoped,
-- named, sluggable label with nothing else attached. Adding them to the
-- existing CHECK reuses the whole terms surface — the dedup index, the RLS
-- policy, the soft delete, `awcms_blog_post_terms`, the admin screen, the
-- endpoints — and costs one constraint.
--
-- An institution is NOT that. It carries a branch (legislative/executive), it
-- points at a region in the national master dataset, and it owns a landing
-- page with its own SEO metadata (PRD §12.2). Modelling it as a term would
-- mean either widening `awcms_blog_terms` with four columns that are NULL for
-- every category, tag, channel and topic, or storing those attributes as
-- convention inside `description` — the second of which is precisely the
-- untyped-string collapse this migration exists to end.
--
-- ## Why region is a CODE and not a term either
--
-- PRD §12.3 requires region to reference the `idn_admin_regions` master
-- (ADR-0046) rather than a per-tenant string. `region_code` therefore holds a
-- dotted upstream code (`62`, `62.71`, `62.71.01`) resolvable through
-- `GET /api/v1/idn-regions/regions/{code}`.
--
-- It is deliberately NOT a foreign key. `awcms_idn_admin_regions` is
-- DATASET-VERSIONED: its primary key is per-import, and the same Palangka Raya
-- appears with a different `id` in every dataset generation. An FK would pin
-- each article to one import of the Kepmendagri list and break the next time a
-- dataset is activated — the exact failure ADR-0046's activation/rollback path
-- is built to survive. The code is the stable identifier across generations,
-- so the code is what is stored.
--
-- The consequence is stated plainly: this column can hold a code that no
-- ACTIVE dataset resolves (a region dissolved by a later Kepmendagri, or a
-- typo from an importer). The application layer resolves it and renders the
-- article without a region label rather than failing — the same
-- "unresolvable reference degrades, never throws" shape `theming` uses for a
-- media slot whose object is gone.
--
-- ## Why `topic` joins `tag` in the no-parent rule but `channel` does not
--
-- PRD §12.4 defines a topic as a cross-channel issue label (APBD,
-- Infrastruktur, Korupsi). Cross-cutting labels do not nest — a hierarchy
-- would immediately raise "is Korupsi under Hukum or under Politik", a
-- question with no editorial answer, and every consumer would then have to
-- decide whether to roll children up. Channels are primary navigation and a
-- second level is a real editorial possibility (Olahraga -> Sepak Bola), so
-- the door is left open there.

BEGIN;

-- Both CHECKs are DROPped and re-ADDed rather than altered in place: Postgres
-- has no `ALTER CONSTRAINT ... CHECK`, and `IF EXISTS` keeps this idempotent
-- on a database where a previous run got half-way.
ALTER TABLE awcms_blog_terms
  DROP CONSTRAINT IF EXISTS awcms_blog_terms_taxonomy_type_check;

ALTER TABLE awcms_blog_terms
  ADD CONSTRAINT awcms_blog_terms_taxonomy_type_check
    CHECK (taxonomy_type IN ('category', 'tag', 'channel', 'topic'));

-- Renamed from `..._tag_no_parent_check`: it now governs two flat
-- vocabularies, and a constraint whose name says `tag` while it also refuses a
-- topic parent is a constraint the next reader will misdiagnose. The old name
-- is dropped explicitly so a re-run does not leave both installed, which would
-- silently keep enforcing the narrower rule under a name nobody greps for.
ALTER TABLE awcms_blog_terms
  DROP CONSTRAINT IF EXISTS awcms_blog_terms_tag_no_parent_check;

ALTER TABLE awcms_blog_terms
  DROP CONSTRAINT IF EXISTS awcms_blog_terms_flat_taxonomy_no_parent_check;

ALTER TABLE awcms_blog_terms
  ADD CONSTRAINT awcms_blog_terms_flat_taxonomy_no_parent_check
    CHECK (taxonomy_type NOT IN ('tag', 'topic') OR parent_id IS NULL);

COMMENT ON COLUMN awcms_blog_terms.taxonomy_type IS
  'PRD §8.5 — one of category, tag, channel, topic. `channel` is primary navigation and MAY nest; `tag` and `topic` are flat (see awcms_blog_terms_flat_taxonomy_no_parent_check). Institution is deliberately NOT here: it is awcms_blog_institutions, because it carries a branch, a region code and its own landing SEO.';

-- Region on the article itself, not through a join table: PRD §8.5 gives an
-- article ONE region ("Kabupaten Kotawaringin Barat -> Kecamatan Kumai" is a
-- single path, not a set), in contrast with institutions and topics which are
-- explicitly many (FR-CNT-007).
ALTER TABLE awcms_blog_posts
  ADD COLUMN IF NOT EXISTS region_code text;

ALTER TABLE awcms_blog_posts
  DROP CONSTRAINT IF EXISTS awcms_blog_posts_region_code_check;

-- Shape only, for the same reason sql/130's time-zone CHECK is shape-only: the
-- authority on which codes exist is a table (`awcms_idn_admin_regions`), and a
-- CHECK may not read one. Dotted numeric segments, 2 to 4 levels deep, which
-- is the entire grammar `wilayah-dump-parser.ts` emits.
ALTER TABLE awcms_blog_posts
  ADD CONSTRAINT awcms_blog_posts_region_code_check
    CHECK (
      region_code IS NULL
      OR region_code ~ '^[0-9]{2}(\.[0-9]{2}){0,2}(\.[0-9]{4})?$'
    );

COMMENT ON COLUMN awcms_blog_posts.region_code IS
  'PRD §12.3 — dotted idn_admin_regions code (62, 62.71, 62.71.01, 62.71.01.2001). NOT a foreign key: that table is dataset-versioned and its ids change every import, so the code is the only stable identifier across dataset generations. An unresolvable code degrades to "no region label" on render.';

CREATE INDEX IF NOT EXISTS awcms_blog_posts_region_idx
  ON awcms_blog_posts (tenant_id, region_code)
  WHERE region_code IS NOT NULL AND deleted_at IS NULL;

-- PRD §12.2 — the institution entity. Tenant-scoped like everything else in
-- this module: the fifteen DPRDs and fifteen regional governments Lentera
-- covers are that tenant's editorial vocabulary, not platform master data.
-- SeputarBorneo as tenant two will carry its own list (PRD §41), and neither
-- can see the other's.
CREATE TABLE IF NOT EXISTS awcms_blog_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- `legislative` | `executive`. The two mega menus of PRD §8.3/§8.4 are
  -- built by filtering on this, so it is a column rather than a convention in
  -- the slug. Left as a CHECK-constrained text (repo convention) instead of an
  -- enum type, which cannot be extended inside a transaction on older servers.
  branch text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  -- Dotted idn_admin_regions code, same contract and same reasoning as
  -- `awcms_blog_posts.region_code` above: an institution belongs to a region
  -- ("DPRD Kapuas" -> Kabupaten Kapuas), and PRD §12.2 renders it on the
  -- landing page.
  region_code text,
  description text,
  -- Landing-page SEO (PRD §12.2 "SEO metadata unik"). Kept on the institution
  -- rather than derived from `name`, because "DPRD Kotawaringin Barat" is the
  -- editorial label while the title tag wants "Berita DPRD Kotawaringin Barat
  -- Terbaru Hari Ini".
  seo_title text,
  seo_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_blog_institutions_branch_check
    CHECK (branch IN ('legislative', 'executive')),
  CONSTRAINT awcms_blog_institutions_region_code_check
    CHECK (
      region_code IS NULL
      OR region_code ~ '^[0-9]{2}(\.[0-9]{2}){0,2}(\.[0-9]{4})?$'
    )
);

-- Same partial-unique shape as `awcms_blog_terms_slug_dedup`: a soft-deleted
-- institution releases its slug, so an institution deleted by mistake can be
-- re-created under the URL its old articles already link to.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_blog_institutions_slug_dedup
  ON awcms_blog_institutions (tenant_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_blog_institutions_tenant_branch_idx
  ON awcms_blog_institutions (tenant_id, branch)
  WHERE deleted_at IS NULL;

-- `db:fk-index:check` requires an index leading with each foreign key column.
CREATE INDEX IF NOT EXISTS awcms_blog_institutions_tenant_idx
  ON awcms_blog_institutions (tenant_id);

ALTER TABLE awcms_blog_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_institutions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_institutions_tenant_isolation
  ON awcms_blog_institutions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- FR-CNT-007 — an article may name several institutions, because a single
-- event routinely involves more than one ("DPRD Kobar and Pemkab Kobar agree
-- the APBD-P"). Join table carries its own `tenant_id` rather than deriving it
-- through the FKs, the same convention `awcms_blog_post_terms` uses, so RLS
-- isolates it directly instead of transitively.
CREATE TABLE IF NOT EXISTS awcms_blog_post_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  post_id uuid NOT NULL REFERENCES awcms_blog_posts (id),
  institution_id uuid NOT NULL REFERENCES awcms_blog_institutions (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_blog_post_institutions_unique UNIQUE (post_id, institution_id)
);

CREATE INDEX IF NOT EXISTS awcms_blog_post_institutions_tenant_idx
  ON awcms_blog_post_institutions (tenant_id);

-- The index the institution landing page reads: "every post filed under this
-- institution". `awcms_blog_post_institutions_unique` already leads with
-- `post_id`, so the reverse direction needs its own.
CREATE INDEX IF NOT EXISTS awcms_blog_post_institutions_institution_idx
  ON awcms_blog_post_institutions (institution_id);

CREATE INDEX IF NOT EXISTS awcms_blog_post_institutions_post_idx
  ON awcms_blog_post_institutions (post_id);

ALTER TABLE awcms_blog_post_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_post_institutions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_blog_post_institutions_tenant_isolation
  ON awcms_blog_post_institutions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- No `awcms_app` GRANT: sql/019's `ALTER DEFAULT PRIVILEGES IN SCHEMA public`
-- already covers every table the owning role creates afterwards, and repeating
-- it here would drift the moment the two statements disagreed.
--
-- No `awcms_worker` GRANT either. The scheduled-publish job
-- (`blog:publish:scheduled`) reads posts, their term ids and tenant settings;
-- it has no reason to see institutions, and granting "while we are here" is
-- how a worker role accumulates a surface nobody can justify later.

COMMIT;
