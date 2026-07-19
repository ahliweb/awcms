-- Issue #179 (epic #177, Wave 2 authorization) — dynamic ABAC policy
-- evaluator. Extends the existing `awcms_abac_policies` table (sql/005) with a
-- bounded, deterministic, versioned condition DSL so the authorization
-- chokepoint (`evaluateAccess`/`authorizeInTransaction`) can finally CONSUME
-- stored policies. Ported from awcms-mini migration 081
-- (`081_awcms_mini_abac_policy_dsl_schema.sql`, same issue). Until this
-- migration the table had only `effect`/`is_active` (authored by #171's flat
-- CRUD) and was never read by the evaluator.
--
-- Pure additive ALTER: every new column has a DEFAULT so applying this to an
-- already-populated table backfills existing rows harmlessly. The backfill is a
-- NO-OP for authorization: pre-existing rows (all authored by #171's flat CRUD,
-- which writes only effect/description/is_active) default to
-- `is_dsl_managed = false` and are therefore NEVER read by the evaluator (see
-- the discriminator column below + ADR-0033 §3). Their `conditions` default
-- (`{"allOf":[]}`) and NULL applicability are inert because the evaluator never
-- loads them. No existing tenant's authorization behavior changes on migrate:
-- the evaluator is a no-op for any tenant with no DSL-managed active policy.
--
-- Discriminator (`is_dsl_managed`, added below): flat #171 rows stay
-- `is_dsl_managed = false` and are NEVER consumed by the evaluator; ONLY the DSL
-- surface (`/api/v1/access/policies`) sets `is_dsl_managed = true`. So a flat
-- policy (which cannot be scoped or conditioned) stays inert regardless of
-- effect/is_active, and this migration is deploy-safe: a pre-existing inert flat
-- `deny` is NOT activated by adding the DSL columns. See ADR-0033 + the
-- identity-access README.
--
-- RLS: `awcms_abac_policies` and `awcms_abac_decision_logs` already `ENABLE`
-- (sql/005) + `FORCE ROW LEVEL SECURITY` (sql/017) with a
-- `tenant_id = current_setting('app.current_tenant_id')` isolation policy.
-- `ALTER TABLE ADD COLUMN` inherits the table's existing RLS and the
-- table-level DML grant `awcms_app` holds (sql/019 granted DML on ALL TABLES;
-- sql/021 kept SELECT/INSERT/UPDATE on `awcms_abac_policies`), so new columns
-- need no re-grant.

-- 1. Applicability columns (all nullable = wildcard). A policy matches a
--    request when each non-null column equals the request's corresponding
--    field; a NULL column matches any value. So a policy with all four NULL is
--    tenant-wide, and a fully-specified policy targets exactly one
--    (module_key, activity_code, action, resource_type) tuple.
ALTER TABLE awcms_abac_policies
  ADD COLUMN IF NOT EXISTS module_key text,
  ADD COLUMN IF NOT EXISTS activity_code text,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS resource_type text;

-- 2. Versioned, bounded condition AST. `dsl_version` lets the parser reject a
--    stored condition authored under a future grammar it does not understand
--    (fail-closed). `conditions` is a jsonb AST of composition nodes
--    (`allOf`/`anyOf`/`not`) and leaves (`{attr, op, value|valueAttr}`) over a
--    server-side attribute allow-list — never arbitrary code or SQL (see
--    `src/modules/identity-access/domain/abac-policy.ts`). `priority` orders
--    policies for deterministic, stable evaluation/reporting (lower first).
ALTER TABLE awcms_abac_policies
  ADD COLUMN IF NOT EXISTS dsl_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{"allOf":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100;

-- 2b. Discriminator: is a row a DSL-authored policy the evaluator should CONSUME?
--     The flat #171 CRUD (`/api/v1/abac/policies`) writes only
--     effect/description/is_active — it CANNOT scope or condition a policy, so a
--     flat row would otherwise present to the evaluator as a wildcard,
--     vacuously-true policy (a flat `deny` = deny EVERY request = full-tenant
--     lockout with no in-band recovery). Guard against that structurally: only
--     the DSL surface (`/api/v1/access/policies`) sets `is_dsl_managed = true`,
--     and the evaluator's cache loads ONLY `is_dsl_managed = true` rows. Default
--     `false` keeps every pre-existing and future flat row INERT (its exact
--     pre-#179 behavior — never consumed). See ADR-0033 §3.
ALTER TABLE awcms_abac_policies
  ADD COLUMN IF NOT EXISTS is_dsl_managed boolean NOT NULL DEFAULT false;

-- 3. `conditions` must be a JSON object (an AST node), never a scalar/array/
--    null. Defense-in-depth against a raw INSERT that bypasses the
--    application-layer validator; the validator is still the authority on the
--    AST's internal shape.
ALTER TABLE awcms_abac_policies
  DROP CONSTRAINT IF EXISTS awcms_abac_policies_conditions_object_check;
ALTER TABLE awcms_abac_policies
  ADD CONSTRAINT awcms_abac_policies_conditions_object_check
    CHECK (jsonb_typeof(conditions) = 'object');

-- 4. `dsl_version` must be a positive integer.
ALTER TABLE awcms_abac_policies
  DROP CONSTRAINT IF EXISTS awcms_abac_policies_dsl_version_check;
ALTER TABLE awcms_abac_policies
  ADD CONSTRAINT awcms_abac_policies_dsl_version_check
    CHECK (dsl_version >= 1);

-- 5. Hot-path index for the per-tenant active-policy load the evaluator's cache
--    issues on a cache miss
--    (`WHERE tenant_id = $1 AND is_active AND is_dsl_managed`). Partial on BOTH
--    `is_active` AND `is_dsl_managed` because the evaluator only ever loads
--    active, DSL-managed policies (flat #171 rows are never consumed); ordered
--    by priority/policy_code for a deterministic scan.
CREATE INDEX IF NOT EXISTS awcms_abac_policies_active_idx
  ON awcms_abac_policies (tenant_id, priority, policy_code)
  WHERE is_active AND is_dsl_managed;

-- 6. Record which policy VERSION produced a logged decision, alongside the
--    already-present `matched_policy` (code). Nullable: built-in guards
--    (tenant_isolation/self_approval/business_scope/default_deny/role_permission)
--    have no versioned policy behind them, and pre-existing decision-log rows
--    have none either.
ALTER TABLE awcms_abac_decision_logs
  ADD COLUMN IF NOT EXISTS matched_policy_version integer;
