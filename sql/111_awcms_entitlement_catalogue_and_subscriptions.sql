-- Gelombang 5 PR 5.4 (Issue #423), ADR-0084 — the first REAL entitlement, and
-- the one thing that had to exist before it could be attached to anything.
--
-- ## Why an attachment alone would have been an outage
--
-- `sql/109` landed the machinery empty. Attaching `requiresEntitlement` to a
-- module without doing anything else would deny that module to EVERY tenant in
-- EVERY downstream installation — `resolveModuleAvailability` needs the tenant's
-- effective plan to contain the key, and nothing had ever put anything in a
-- plan. A template that ships a plan wall by default is selling a product
-- decision that is not its to make.
--
-- So the DEFAULT plan gets the entitlement, and `resolveModuleAvailability`
-- treats a tenant with NO subscription row as being on that default plan — the
-- same "missing row is not a decision" convention `awcms_tenant_modules` has
-- used since `sql/008`. Nothing here writes a tenant-scoped row at all, which is
-- also why this migration needs no `NO FORCE -> DML -> FORCE` toggle and no
-- cross-tenant backfill: there is nothing to backfill.
--
-- A downstream operator who wants to sell tiers authors a NARROWER plan and
-- assigns tenants to it. Until they do, every tenant is on `base` implicitly and
-- nobody is refused.
--
-- `bun run security:readiness` must report ZERO denied tenants after this runs.
-- That check exists (PR 5.3) precisely so the claim above is verified against a
-- real database rather than believed.
--
-- ## Why `custom_domain` is the first one
--
-- `tenant_domain` is the natural plan-tier feature — a custom domain is what
-- every SaaS charges for — and it is mechanically the cleanest attachment in the
-- registry: no module depends on it, and its whole guarded surface is domain
-- MANAGEMENT. Host resolution itself is a public read path that never reaches
-- the chokepoint, so an unentitled tenant's existing domains keep resolving; only
-- adding and changing them is gated. Losing the ability to add a domain is a
-- plan wall. Losing the domain you already have is an outage, and this cannot
-- cause one.
--
-- `site_search` and `comments` were considered and rejected for the opposite
-- reason: both carry PUBLIC unauthenticated surfaces that bypass
-- `authorizeInTransaction` entirely, so an entitlement on either would be
-- enforced on half the module and silently ignored on the other half — a control
-- whose coverage a reader cannot predict.

BEGIN;

-- 1. The catalogue row.
INSERT INTO awcms_entitlements (entitlement_key, name, description)
VALUES (
  'custom_domain',
  'Custom domain',
  'Add and manage custom domains for this tenant (the tenant_domain module''s guarded surface). Host resolution for domains already configured is a public read path and is never gated by this.'
)
ON CONFLICT (entitlement_key) DO NOTHING;

-- 2. The DEFAULT plan contains it.
--
-- This is what makes the attachment inert-in-effect while the branch becomes
-- genuinely live: every tenant is on `base` (step 3), `base` contains
-- `custom_domain`, so `resolveModuleAvailability` resolves `entitlement_held =
-- true` and the guard proceeds exactly as before. What CHANGED is that the code
-- path now executes against real rows instead of never executing at all.
--
-- A deployment selling tiers adds its own plans and moves tenants onto them.
-- Nothing here presumes to know which features are worth money.
INSERT INTO awcms_plan_entitlements (plan_code, entitlement_key)
SELECT p.plan_code, 'custom_domain'
FROM awcms_plans p
WHERE p.is_default
ON CONFLICT (plan_code, entitlement_key) DO NOTHING;

COMMENT ON TABLE awcms_plan_entitlements IS
  'Which plan contains which entitlement (ADR-0084). A tenant with NO row in awcms_tenant_subscriptions is treated as being on the is_default plan — the same "missing row is not a decision" convention awcms_tenant_modules uses — so an installation that never touches subscriptions behaves exactly as it did before entitlements existed. A tenant WITH a row that is not in an entitling status is NOT given that fallback: that case is a lapse, and falling back would quietly undo it.';

COMMIT;
