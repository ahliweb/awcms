-- tenant_domain — database foundation for mapping a public hostname/domain/
-- subdomain to a tenant. Ported from awcms-micro migrations 031 (schema).
-- Adapted to this base: every `awcms_micro_` identifier renamed to `awcms_`
-- (table name, tenant FK, constraint/index names), and the awcms-micro
-- worker-role grant model does not apply here — no explicit GRANT block is
-- needed (see §RLS / GRANT below).
--
-- This table is the input the host-based public tenant resolver reads to
-- answer "hostname -> tenant_id" without requiring a `tenantCode` in the path
-- (ADR-0009's existing `/blog/{tenantCode}` model stays intact; host-based
-- routing is an additive path). The narrow SECURITY DEFINER bootstrap read
-- for that anonymous, pre-tenant-context lookup lands in migration 048; the
-- authenticated tenant-scoped management API reads/writes this table only
-- inside `withTenant(...)` (RLS FORCE'd below).
--
-- Column design notes:
--   - `hostname` is the raw value as entered/observed (case preserved for
--     display); `normalized_hostname` is a separate stored column (not a
--     functional index on `lower(hostname)`) holding the lowercase+trimmed
--     form used for uniqueness and resolver lookups. A CHECK constraint keeps
--     the two in sync at the DB layer as defense-in-depth (application code is
--     still responsible for populating both correctly on insert/update).
--   - `domain_type`: `subdomain` (under the operator's platform root domain)
--     vs `custom_domain` (tenant-owned external domain requiring its own DNS
--     verification).
--   - `route_mode`: which public route family this domain resolves into —
--     `canonical` (host-resolved public routes) vs `legacy_blog` (the existing
--     `/blog/{tenantCode}` routes, ADR-0009, documented as legacy but not
--     removed). Not consumed by any resolver yet — this column is laid down
--     for forward compatibility.
--   - `status`: `pending_verification` (default; newly added, not yet
--     proven), `active` (verified and eligible to resolve tenant traffic),
--     `suspended` (operator/tenant paused it), `failed` (verification failed
--     or repeatedly errors on recheck). Soft delete
--     (`deleted_at`/`deleted_by`/`delete_reason`) is the fourth "does not
--     resolve traffic" state, not folded into this enum. Binding rule on
--     whoever builds a public host resolver on top of this: suspended/failed/
--     deleted rows must never resolve public tenant traffic, and an
--     unknown/inactive host must look identical to any other non-resolving
--     host, never revealing which case it is.
--   - `is_primary` + `redirect_to_primary`: exactly one primary domain per
--     tenant among non-deleted rows (enforced below by a partial unique index on
--     `WHERE is_primary = true AND deleted_at IS NULL`; the application layer
--     additionally requires `status = 'active'` before a domain may be set
--     primary) is where canonical
--     URLs/redirects point; non-primary active domains can optionally redirect
--     to it (`redirect_to_primary`), enforcement of the actual HTTP redirect
--     is application-layer, not this migration's concern.
--   - `verification_method`: how ownership is being/was proven —
--     `dns_txt`/`dns_cname` (public DNS record, `verification_record_name`/
--     `verification_record_value` hold the record the tenant must publish,
--     never a secret), `file` (well-known file upload), or `manual`
--     (operator-attested, no automated check).
--   - `verification_token_hash`: sha256 hex, `sha256:`-prefixed — same
--     construction as `lib/auth/password-reset-token.ts`'s `hashResetToken`
--     (a CSPRNG-generated verification token is high-entropy, so a fast hash
--     is correct — no bcrypt/argon2 needed). The raw token itself is never
--     persisted; token generation/hashing/comparison is application code for a
--     later enhancement, out of scope here. `verification_record_value` is
--     intentionally distinct: it is the PUBLIC DNS record value the tenant
--     publishes (not a secret). Neither column, nor any other column on this
--     table, ever stores a DNS provider API credential/secret — those belong
--     only in env/secret manager (the optional Cloudflare adapter reads its
--     token/zone only from `TENANT_DOMAIN_CLOUDFLARE_*` env vars).
--
-- ## RLS / GRANT
--
-- `ENABLE`+`FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation`
-- policy (`awcms_app` connects as a non-owner role since sql/019, so `ENABLE`
-- alone would be inert — `FORCE` is required). No explicit `GRANT` for
-- `awcms_app`: sql/019's `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES TO
-- awcms_app` already covers every table the migration owner creates from here
-- on (same reasoning sql/041 relied on). No `awcms_worker` grant is added —
-- this module ships no background job that touches this table.
--
-- FORCE RLS creates a bootstrap gap the host resolver must handle: a query
-- against this table with no `app.current_tenant_id` GUC set (awcms_app's
-- fail-closed default, sql/019) returns zero rows. That is correct for
-- tenant-authenticated access (the management API must never see another
-- tenant's domains), but the public host resolver must discover tenant_id
-- from a hostname BEFORE any tenant context exists. That gap is closed by the
-- narrow SECURITY DEFINER function in migration 048, NOT by removing FORCE RLS
-- here. Do not remove FORCE RLS from this table to work around it.

CREATE TABLE IF NOT EXISTS awcms_tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  hostname text NOT NULL,
  normalized_hostname text NOT NULL,
  domain_type text NOT NULL DEFAULT 'custom_domain',
  route_mode text NOT NULL DEFAULT 'canonical',
  status text NOT NULL DEFAULT 'pending_verification',
  is_primary boolean NOT NULL DEFAULT false,
  redirect_to_primary boolean NOT NULL DEFAULT false,
  verification_method text,
  verification_token_hash text,
  verification_record_name text,
  verification_record_value text,
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_tenant_domains_domain_type_check
    CHECK (domain_type IN ('subdomain', 'custom_domain')),
  CONSTRAINT awcms_tenant_domains_route_mode_check
    CHECK (route_mode IN ('canonical', 'legacy_blog')),
  CONSTRAINT awcms_tenant_domains_status_check
    CHECK (status IN ('pending_verification', 'active', 'suspended', 'failed')),
  CONSTRAINT awcms_tenant_domains_verification_method_check
    CHECK (verification_method IS NULL
      OR verification_method IN ('dns_txt', 'dns_cname', 'file', 'manual')),
  CONSTRAINT awcms_tenant_domains_hostname_not_blank_check
    CHECK (btrim(hostname) <> ''),
  CONSTRAINT awcms_tenant_domains_normalized_hostname_matches_check
    CHECK (normalized_hostname = lower(btrim(hostname)))
);

-- Case-insensitive global uniqueness among active (non-deleted) rows — a
-- hostname can only ever map to one tenant, so this is intentionally NOT
-- scoped by tenant_id. Soft-deleting a row frees its normalized_hostname for
-- reuse (e.g. a domain moved off this platform, then re-added later).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_tenant_domains_normalized_hostname_dedup
  ON awcms_tenant_domains (normalized_hostname)
  WHERE deleted_at IS NULL;

-- At most one active primary domain per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_tenant_domains_primary_dedup
  ON awcms_tenant_domains (tenant_id)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_tenant_domains_tenant_idx
  ON awcms_tenant_domains (tenant_id);

CREATE INDEX IF NOT EXISTS awcms_tenant_domains_tenant_status_idx
  ON awcms_tenant_domains (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_tenant_domains_tenant_deleted_idx
  ON awcms_tenant_domains (tenant_id, deleted_at);

ALTER TABLE awcms_tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_tenant_domains FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_tenant_domains_tenant_isolation
  ON awcms_tenant_domains
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
