-- ADR-0039 (redirect-governance scope of seo_distribution; adapts awcms-micro
-- ADR-0028 §8 + the ADR-0010 legacy-blog deferral) — the redirect-governance half
-- of `seo_distribution`, the companion to ADR-0038's discovery half (sql/057-059):
-- controlled, tenant-contained redirect management, URL-change capture, chain/loop
-- prevention, and privacy-minimized 404 governance. This migration lays down THREE
-- tenant-scoped tables, all ENABLE + FORCE ROW LEVEL SECURITY with the standard
-- `tenant_isolation` policy (same convention as sql/057). Tenant A's rows can NEVER
-- be read or resolved on tenant B's domains — RLS is the structural floor under the
-- explicit `tenant_id` filter every query here also carries.
--
-- ## Security posture this schema encodes (the primary design constraint)
--
-- Redirects are the most abuse-prone SEO surface: unrestricted targets are open
-- redirects, pattern rules are ReDoS, and admin/API/auth paths are hijack targets.
-- The schema itself is built to make the safe path the only path:
--
--  1. **EXACT-PATH rules ONLY** — `normalized_source_path` is a stored, already-
--     normalized literal path, matched by equality. There is NO pattern/regex/
--     rewrite column anywhere in this table. Prefix/pattern rules are deferred to a
--     future ADR precisely because they would introduce a pattern engine (ReDoS
--     surface) and a much larger hijack surface. This table cannot express a
--     pattern, so it cannot ReDoS.
--  2. **Targets are same-tenant-internal, re-validated at resolve time** — a target
--     is either a relative same-origin path (`relative_same_tenant`) or an absolute
--     URL to one of THIS tenant's own verified registered domains
--     (`verified_external`). Every target — on write AND on every resolve — is run
--     through the FROZEN `classifyRedirectTarget`/`assertSafeRedirectTarget` guards
--     (re-homed in `seo-distribution/domain/redirect-target-classification.ts`):
--     only `same_tenant_internal` is ever emitted. `//`, `/\`, `javascript:`,
--     `data:`, cross-host, and C0/DEL-control bypasses are all rejected there. This
--     table stores the string; the guard — not a DB constraint — is the
--     open-redirect defense. The CHECK below is only a coarse shape floor.
--  3. **Server-derived scope keys** — `domain_scope_host` is a `normalized_hostname`
--     from `awcms_tenant_domains` (server-derived, never a raw `Host`); `locale_scope`
--     is a BCP-47 tag. Both are OPTIONAL narrowing filters (NULL = applies to all of
--     this tenant's hosts / locales).
--  4. **Bounded, non-recursive resolution** — chain following is done iteratively in
--     application code with a hop cap (`domain/redirect-chain.ts`), NEVER a recursive
--     SQL CTE. This table has no self-referential FK and no trigger; it is inert data
--     the resolver walks a bounded number of times.
--
-- Additive + non-destructive: every object is `IF NOT EXISTS`; migrations are
-- appended sequentially and never edited once shipped (AGENTS.md). 060 = schema,
-- 061 = permission seed (same schema-then-permissions split sql/057+058 used).

-- ===========================================================================
-- 1. awcms_seo_redirects — the exact-path redirect rules
-- ===========================================================================
CREATE TABLE IF NOT EXISTS awcms_seo_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Raw source path as entered (display); `normalized_source_path` is the canonical
  -- form used for matching + uniqueness. Application code
  -- (`domain/redirect-path.ts`) populates both; the CHECK below keeps the normalized
  -- column path-shaped as a DB-layer floor.
  source_path text NOT NULL,
  normalized_source_path text NOT NULL,
  -- Optional scope narrowing (NULL = all). `locale_scope` matches the request's
  -- resolved locale; `domain_scope_host` matches the server-derived host the request
  -- was served on (a `normalized_hostname`).
  locale_scope text,
  domain_scope_host text,
  -- 'relative_same_tenant' (target is a relative path) | 'verified_external' (target
  -- is an absolute URL to one of this tenant's own verified domains). Both classify
  -- as `same_tenant_internal` through the frozen guard — the only class ever emitted.
  -- There is NO "arbitrary external" target type.
  target_type text NOT NULL,
  -- The target string (relative path OR absolute same-tenant URL). Never a pattern;
  -- re-validated through the frozen guard on every resolve.
  target text NOT NULL,
  -- Status-code policy: 301 permanent (default), 308 permanent method-preserving,
  -- 302 temporary, 307 temporary method-preserving.
  status_code smallint NOT NULL DEFAULT 301,
  -- 'active' (resolves) | 'inactive' (kept but does not resolve) | 'archived'
  -- (historical, excluded from source-uniqueness so a new rule may reuse the path).
  state text NOT NULL DEFAULT 'active',
  -- Effective window (NULL = unbounded). A rule resolves only when
  -- effective_from <= now < effective_until.
  effective_from timestamptz,
  effective_until timestamptz,
  -- Explicit query policy: when true, the incoming request's query string is
  -- appended to a relative target that carries none of its own. Default false —
  -- query params are DROPPED unless a rule opts in.
  preserve_query boolean NOT NULL DEFAULT false,
  reason text,
  -- Provenance: 'manual' | 'slug_change' | 'domain_change' | 'locale_change' |
  -- 'import' | 'legacy_blog' — for audit/reconciliation, never trusted for logic.
  origin text NOT NULL DEFAULT 'manual',
  -- Hit projection (best-effort, incremented on resolve; a CDN-cached 301 makes this
  -- a lower bound).
  hit_count bigint NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_seo_redirects_target_type_check
    CHECK (target_type IN ('relative_same_tenant', 'verified_external')),
  CONSTRAINT awcms_seo_redirects_status_code_check
    CHECK (status_code IN (301, 302, 307, 308)),
  CONSTRAINT awcms_seo_redirects_state_check
    CHECK (state IN ('active', 'inactive', 'archived')),
  CONSTRAINT awcms_seo_redirects_origin_check
    CHECK (origin IN ('manual', 'slug_change', 'domain_change', 'locale_change', 'import', 'legacy_blog')),
  -- Normalized source must be a non-blank path-absolute reference. Coarse floor; the
  -- real normalization/validation is `domain/redirect-path.ts`.
  CONSTRAINT awcms_seo_redirects_normalized_source_shape_check
    CHECK (normalized_source_path <> '' AND left(normalized_source_path, 1) = '/'),
  -- Target coarse shape by type. The frozen guard is the real check; this only stops
  -- an obviously-wrong type/target pairing from ever landing.
  CONSTRAINT awcms_seo_redirects_target_shape_check
    CHECK (
      (target_type = 'relative_same_tenant' AND left(target, 1) = '/')
      OR (target_type = 'verified_external' AND (target LIKE 'http://%' OR target LIKE 'https://%'))
    ),
  -- Effective window must be a real interval when both bounds are set.
  CONSTRAINT awcms_seo_redirects_effective_range_check
    CHECK (effective_from IS NULL OR effective_until IS NULL OR effective_from < effective_until),
  -- Length caps (defense in depth under the application validation).
  CONSTRAINT awcms_seo_redirects_source_len_check
    CHECK (char_length(source_path) <= 2048 AND char_length(normalized_source_path) <= 2048),
  CONSTRAINT awcms_seo_redirects_target_len_check
    CHECK (char_length(target) <= 2048),
  CONSTRAINT awcms_seo_redirects_reason_len_check
    CHECK (reason IS NULL OR char_length(reason) <= 500),
  CONSTRAINT awcms_seo_redirects_locale_scope_len_check
    CHECK (locale_scope IS NULL OR char_length(locale_scope) <= 35),
  CONSTRAINT awcms_seo_redirects_domain_scope_len_check
    CHECK (domain_scope_host IS NULL OR char_length(domain_scope_host) <= 253)
);

-- Source-path uniqueness per tenant + scope (conflict prevention). A source path may
-- have at most ONE live (non-deleted, non-archived) rule per (locale_scope,
-- domain_scope_host) combination, regardless of active/inactive state. Archived and
-- soft-deleted rules are excluded so a path can be re-governed after retiring an old
-- rule. COALESCE maps NULL scope to '' so the "all locales/hosts" rule occupies
-- exactly one slot.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_seo_redirects_source_scope_dedup
  ON awcms_seo_redirects (
    tenant_id,
    normalized_source_path,
    COALESCE(locale_scope, ''),
    COALESCE(domain_scope_host, '')
  )
  WHERE deleted_at IS NULL AND state <> 'archived';

-- Resolve-time point lookup: match an ACTIVE rule for a tenant + exact source path.
-- Partial index keeps it tiny and index-only-ish.
CREATE INDEX IF NOT EXISTS awcms_seo_redirects_resolve_idx
  ON awcms_seo_redirects (tenant_id, normalized_source_path)
  WHERE deleted_at IS NULL AND state = 'active';

-- Admin list/filter (by state) + keyset pagination (created_at, id).
CREATE INDEX IF NOT EXISTS awcms_seo_redirects_tenant_state_idx
  ON awcms_seo_redirects (tenant_id, state, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_seo_redirects_tenant_deleted_idx
  ON awcms_seo_redirects (tenant_id, deleted_at);

ALTER TABLE awcms_seo_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_seo_redirects FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_seo_redirects_tenant_isolation
  ON awcms_seo_redirects
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ===========================================================================
-- 2. awcms_seo_not_found_observations — privacy-minimized 404 governance
-- ===========================================================================
-- One AGGREGATE row per (tenant, normalized path, referrer domain, locale, host) —
-- NOT one row per hit. Upsert-increments `hit_count`/`last_seen_at`, so a bot probing
-- the same 404 a million times is one row, not a million. Only a sanitized path
-- (query DROPPED entirely) and a bare referrer DOMAIN (never the full referrer URL)
-- are stored — the path via seo-distribution's own `normalizeRedirectPath` (query
-- dropped by normalization) and the referrer via `visitor-analytics`'s
-- `extractReferrerDomain` privacy helper. A full sensitive query string or secret can
-- never land here (ADR-0039 privacy requirement). Bounded retention is enforced by
-- the data_lifecycle registry (this table is declared as an analytics_telemetry
-- descriptor in `seo-distribution/module.ts`).
CREATE TABLE IF NOT EXISTS awcms_seo_not_found_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Sanitized, normalized request path (query dropped). The aggregation key.
  normalized_path text NOT NULL,
  -- Bare referrer hostname only (never path/query/fragment); NULL = no/opaque referrer.
  referrer_domain text,
  -- Resolved request locale + server-derived host at 404 time (NULL = unknown).
  locale text,
  domain_host text,
  hit_count bigint NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Operator remediation: an optional suggested redirect and a resolved flag.
  suggested_redirect_id uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  CONSTRAINT awcms_seo_not_found_path_shape_check
    CHECK (normalized_path <> '' AND left(normalized_path, 1) = '/'),
  CONSTRAINT awcms_seo_not_found_path_len_check
    CHECK (char_length(normalized_path) <= 2048),
  CONSTRAINT awcms_seo_not_found_referrer_len_check
    CHECK (referrer_domain IS NULL OR char_length(referrer_domain) <= 253),
  CONSTRAINT awcms_seo_not_found_locale_len_check
    CHECK (locale IS NULL OR char_length(locale) <= 35),
  CONSTRAINT awcms_seo_not_found_host_len_check
    CHECK (domain_host IS NULL OR char_length(domain_host) <= 253)
);

-- Aggregation upsert key: one row per distinct (tenant, path, referrer, locale, host).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_seo_not_found_dedup
  ON awcms_seo_not_found_observations (
    tenant_id,
    normalized_path,
    COALESCE(referrer_domain, ''),
    COALESCE(locale, ''),
    COALESCE(domain_host, '')
  );

-- Retention purge cursor + operator "recent 404s" listing (tenant + last_seen_at).
-- Required by the data_lifecycle generic engine (tenant + cursor composite) — this
-- exact name is referenced by the `dataLifecycle` descriptor's `requiredIndexes` in
-- `seo-distribution/module.ts` and validated by `bun run data-lifecycle:registry:check`.
CREATE INDEX IF NOT EXISTS awcms_seo_not_found_tenant_last_seen_idx
  ON awcms_seo_not_found_observations (tenant_id, last_seen_at DESC);

-- "Top unresolved 404s" operator dashboard ordering.
CREATE INDEX IF NOT EXISTS awcms_seo_not_found_tenant_hits_idx
  ON awcms_seo_not_found_observations (tenant_id, hit_count DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE awcms_seo_not_found_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_seo_not_found_observations FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_seo_not_found_tenant_isolation
  ON awcms_seo_not_found_observations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- `awcms_worker` grant (sql/022 role split): this table is registered as a
-- `generic`-execution analytics_telemetry descriptor in `seo-distribution/module.ts`,
-- so the data_lifecycle purge engine — which runs as the least-privilege worker role —
-- must be able to SELECT (read stale rows) and DELETE (hard-delete them) here. Same
-- pattern as the data_lifecycle worker grants (sql/055). The app role needs no
-- explicit grant (sql/013's ALTER DEFAULT PRIVILEGES already covers it). RLS still
-- applies to the worker role, so it only ever sees the tenant its transaction is
-- scoped to.
GRANT SELECT, DELETE ON awcms_seo_not_found_observations TO awcms_worker;

-- ===========================================================================
-- 3. awcms_seo_redirect_settings — per-tenant redirect governance policy
-- ===========================================================================
-- One upsert-shaped row per tenant. Kept SEPARATE from `awcms_seo_tenant_settings`
-- (sql/057/059) deliberately: redirect governance is its own concern with its own
-- permission (`redirect.*`), and folding these columns into the shipped SEO-config
-- table would churn the ADR-0038 config read/write/OpenAPI surface for no benefit.
CREATE TABLE IF NOT EXISTS awcms_seo_redirect_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  -- When true AND the tenant has a verified primary host, `/blog/{tenantCode}...`
  -- 301-redirects to the canonical `/news...` equivalent. **INERT in awcms**: this
  -- base ships no `/news` route family (ADR-0039), so even when enabled the legacy
  -- rewrite has no destination — the column is retained for schema/behavioral parity
  -- with awcms-micro and a future `/news` port. Default false = behavior unchanged.
  legacy_blog_redirect_enabled boolean NOT NULL DEFAULT false,
  -- Default action when a URL change is captured (slug/domain/locale change):
  -- 'skip' (do nothing) | 'propose' (create an inactive rule for operator review) |
  -- 'create' (create an active rule immediately). Default 'propose' — never silently
  -- start redirecting live traffic without a human enabling the rule, unless the
  -- tenant opted into 'create'.
  url_change_auto_policy text NOT NULL DEFAULT 'propose',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT awcms_seo_redirect_settings_auto_policy_check
    CHECK (url_change_auto_policy IN ('skip', 'propose', 'create'))
);

ALTER TABLE awcms_seo_redirect_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_seo_redirect_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_seo_redirect_settings_tenant_isolation
  ON awcms_seo_redirect_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
