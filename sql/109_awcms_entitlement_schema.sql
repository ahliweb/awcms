-- Gelombang 5 PR 5.1 (Issue #423), ADR-0084 — an entitlement is a structural
-- deny, never a grant.
--
-- Five tables. Three GLOBAL and read-only at runtime (the operator's catalogue,
-- shaped exactly like `awcms_permissions`), two tenant-scoped under FORCE RLS
-- (what a particular customer actually holds).
--
--   awcms_entitlements        global   the names that may be required at all
--   awcms_plans               global   the packages an operator sells
--   awcms_plan_entitlements   global   which package contains which name
--   awcms_tenant_subscriptions tenant  which package this customer is on
--   awcms_tenant_entitlements  tenant  what this customer holds regardless
--
-- ## Why the catalogue is global AND unwritable at runtime
--
-- `awcms_permissions` is the precedent for a global catalogue, and it is a
-- precedent with a specific property worth copying: `GLOBAL_TABLE_FORBIDDEN_
-- PRIVILEGES` forbids `awcms_app` every write verb on it, so no request path can
-- invent a permission. The same reasoning applies here with more force. A plan
-- is the thing that decides what a customer may reach; a request path able to
-- INSERT a row into `awcms_plan_entitlements` is a request path able to award
-- itself a feature, and no RLS policy would object because these tables have no
-- tenant column to police. Making them read-only at runtime removes that class
-- entirely rather than defending against it.
--
-- The cost is stated rather than hidden: creating or repricing a plan is a
-- MIGRATION, not an admin screen. That is the right shape for this repo — a
-- template whose plan catalogue is a deployment artefact — and it is the reason
-- `/admin/subscriptions` (PR 5.4) will assign a tenant to a plan without ever
-- being able to change what a plan contains.
--
-- ## Why the tenant side is two tables and not one
--
-- `awcms_tenant_subscriptions` answers "what is this customer paying for"; it
-- moves on a billing clock and PR 5.2's transition engine is its only writer.
-- `awcms_tenant_entitlements` answers "what does this customer hold" and moves
-- for reasons that are not billing at all: a grandfathered feature, a migration
-- promise, a support concession.
--
-- Collapsing them would make grandfathering (PR 5.3) indistinguishable from
-- paying, so a plan downgrade would silently revoke a promise nobody recorded
-- making. Keeping them apart means the union is what the chokepoint reads, and
-- each half keeps its own reason for existing.
--
-- ## The union is resolved at request time, not materialized
--
-- A cached "effective entitlements" column was considered and rejected. A
-- downgrade that takes effect on the next cache refresh is a control with a
-- window, and the window is exactly when someone notices they can still reach
-- what they stopped paying for. The read is one round trip either way — see
-- `resolveModuleAvailability`, which folds the whole question into the
-- `awcms_tenant_modules` query the chokepoint ALREADY runs — so the cache would
-- buy staleness for nothing.
--
-- ## No `deleted_at` anywhere here
--
-- A subscription is CANCELLED (a status), and an entitlement is EXPIRED (a
-- timestamp). Both are states the row keeps carrying, because "was this customer
-- entitled last March" is the question this schema exists to answer and a
-- soft-delete flag answers it worse than a status does.
--
-- ## Bounded by design, all five
--
-- None is a log. The catalogue is bounded by what the operator authored; the
-- tenant side is bounded at one subscription per tenant (unique index) and one
-- row per (tenant, entitlement). They are registered in `BOUNDED_BY_DESIGN`
-- rather than given `dataLifecycle` descriptors, and the reason is the same one
-- `awcms_access_policies` states: an age-based purge here would delete LIVE
-- entitlements, which is not retention but an outage.
--
-- Pure DDL plus catalogue seed rows on the three GLOBAL tables — no tenant-scoped
-- row is written, so the `NO FORCE -> DML -> FORCE` toggle `sql/103` needed does
-- not apply.

BEGIN;

-- 1. awcms_entitlements — the names that may be required at all.
--
-- `entitlement_key` is the text key rather than a uuid FK target for the same
-- reason `awcms_tenant_modules.module_key` references `awcms_modules
-- (module_key)`: the key is what code declares (`ModuleDescriptor
-- .requiresEntitlement`), so a join on it is readable in a log and a mismatch is
-- a foreign-key error rather than a silently empty result.
CREATE TABLE IF NOT EXISTS awcms_entitlements (
  entitlement_key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Same shape rule the module registry uses for `module_key`. A key with a
  -- capital letter or a dot would still join correctly and would still read
  -- wrong in every decision-log row that quotes it.
  CONSTRAINT awcms_entitlements_key_format_check
    CHECK (entitlement_key ~ '^[a-z][a-z0-9_]*$')
);

-- 2. awcms_plans — the packages an operator sells.
CREATE TABLE IF NOT EXISTS awcms_plans (
  plan_code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  -- The plan a tenant lands on when nothing else says otherwise. PR 5.3's
  -- backfill reads it; nothing at request time does.
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_plans_code_format_check
    CHECK (plan_code ~ '^[a-z][a-z0-9_]*$')
);

-- At most one default. Without this the backfill's "the default plan" is
-- whatever the sort happened to do that day, and two deployments of the same
-- migration set could grandfather two different tenants onto two different
-- plans. The `((true))` expression index is the standard single-row form.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_plans_single_default_key
  ON awcms_plans ((true))
  WHERE is_default;

-- 3. awcms_plan_entitlements — which package contains which name.
CREATE TABLE IF NOT EXISTS awcms_plan_entitlements (
  plan_code text NOT NULL REFERENCES awcms_plans (plan_code),
  entitlement_key text NOT NULL REFERENCES awcms_entitlements (entitlement_key),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_code, entitlement_key)
);

-- ADR-0064. The primary key indexes `plan_code` (leading column); the second FK
-- column needs its own reachable index, and the chokepoint's read starts from
-- `entitlement_key` rather than from the plan.
CREATE INDEX IF NOT EXISTS awcms_plan_entitlements_entitlement_idx
  ON awcms_plan_entitlements (entitlement_key);

-- 4. awcms_tenant_subscriptions — which package this customer is on.
--
-- One row per tenant, enforced. A subscription HISTORY was considered and
-- rejected: it would be an unbounded table pretending to be configuration, and
-- the history that matters (who moved this tenant to which plan, and when) is
-- already an audit event with its own retention.
CREATE TABLE IF NOT EXISTS awcms_tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  plan_code text NOT NULL REFERENCES awcms_plans (plan_code),
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  grace_ends_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The ladder PR 5.2's `evaluateSubscriptionTransition` walks. Written as a
  -- DATABASE constraint and not only a TypeScript union for the reason `sql/106`
  -- gives for `resend_count`: this is the one that still holds when a second
  -- writer forgets.
  CONSTRAINT awcms_tenant_subscriptions_status_check
    CHECK (status IN (
      'trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled'
    )),
  CONSTRAINT awcms_tenant_subscriptions_period_check
    CHECK (current_period_end IS NULL
      OR current_period_end > current_period_start),
  -- A cancelled subscription names when, and a live one names nothing. Without
  -- this pair a row could read `active` while carrying a cancellation date, and
  -- the two readers of this table would disagree about which field wins.
  CONSTRAINT awcms_tenant_subscriptions_cancelled_consistency_check
    CHECK (
      (status <> 'cancelled' AND cancelled_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
    ),
  CONSTRAINT awcms_tenant_subscriptions_trialing_consistency_check
    CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL),
  CONSTRAINT awcms_tenant_subscriptions_grace_consistency_check
    CHECK (status <> 'grace' OR grace_ends_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_tenant_subscriptions_tenant_key
  ON awcms_tenant_subscriptions (tenant_id);

-- ADR-0064 — `plan_code` is an FK column and the unique index above leads with
-- `tenant_id`, so it does not reach this one.
CREATE INDEX IF NOT EXISTS awcms_tenant_subscriptions_plan_idx
  ON awcms_tenant_subscriptions (plan_code);

ALTER TABLE awcms_tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_tenant_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_tenant_subscriptions_tenant_isolation
  ON awcms_tenant_subscriptions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 5. awcms_tenant_entitlements — what this customer holds regardless of plan.
CREATE TABLE IF NOT EXISTS awcms_tenant_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  entitlement_key text NOT NULL REFERENCES awcms_entitlements (entitlement_key),
  -- Why this row exists, in words, because a grandfathered entitlement with no
  -- stated reason is indistinguishable from a mistake three years later.
  grant_reason text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  -- NULL means "until revoked". An expiry in the past makes the row inert
  -- without deleting it, which is what keeps "was this tenant entitled in March"
  -- answerable.
  expires_at timestamptz,
  -- NULL for every row a JOB writes (the PR 5.3 backfill), non-null when a human
  -- granted it. Deliberately nullable rather than defaulted to a sentinel: "no
  -- human did this" is a fact worth being able to read back.
  granted_by_tenant_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_tenant_entitlements_expiry_check
    CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT awcms_tenant_entitlements_reason_check
    CHECK (btrim(grant_reason) <> ''),
  CONSTRAINT awcms_tenant_entitlements_granted_by_tenant_fkey
    FOREIGN KEY (tenant_id, granted_by_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_tenant_entitlements_key
  ON awcms_tenant_entitlements (tenant_id, entitlement_key);

-- ADR-0064 — the FK column `entitlement_key` is not the leading column of the
-- unique index above.
CREATE INDEX IF NOT EXISTS awcms_tenant_entitlements_entitlement_idx
  ON awcms_tenant_entitlements (entitlement_key);

CREATE INDEX IF NOT EXISTS awcms_tenant_entitlements_granted_by_idx
  ON awcms_tenant_entitlements (tenant_id, granted_by_tenant_user_id)
  WHERE granted_by_tenant_user_id IS NOT NULL;

ALTER TABLE awcms_tenant_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_tenant_entitlements FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_tenant_entitlements_tenant_isolation
  ON awcms_tenant_entitlements
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 6. The baseline catalogue.
--
-- One plan and zero entitlements, and both halves of that are deliberate.
--
-- `base` exists so PR 5.3's backfill has something to grandfather every existing
-- tenant onto — a backfill whose target does not exist is a migration that
-- cannot run. It is `is_default` for the same reason.
--
-- Zero entitlement rows is what makes this wave INERT: `requiredEntitlementFor
-- Module` returns null for every module in the registry, the chokepoint never
-- reaches the entitlement branch, and `awcms_plan_entitlements` is empty. A
-- deployment that wants to sell something adds the rows in its own migration —
-- and PR 5.3's blast-radius report is what tells it who stops being served the
-- moment it does.
INSERT INTO awcms_plans (plan_code, name, description, is_default)
VALUES (
  'base',
  'Base',
  'Everything this template ships. The plan every tenant is on until an operator authors another.',
  true
)
ON CONFLICT (plan_code) DO NOTHING;

COMMENT ON TABLE awcms_entitlements IS
  'Global catalogue of entitlement names (Gelombang 5, ADR-0084). Shaped after awcms_permissions and read-only at runtime for the same reason: a request path that can write this table can award itself a feature, and no RLS policy would object because there is no tenant column to police.';

COMMENT ON TABLE awcms_plans IS
  'Global catalogue of the packages an operator sells (ADR-0084). Read-only at runtime — creating or repricing a plan is a migration. /admin/subscriptions assigns a tenant to a plan; it can never change what a plan contains.';

COMMENT ON TABLE awcms_tenant_subscriptions IS
  'Which plan a tenant is on, and where it sits on the billing ladder (ADR-0084). At most one row per tenant. PR 5.2 evaluateSubscriptionTransition is its only status writer.';

COMMENT ON TABLE awcms_tenant_entitlements IS
  'What a tenant holds regardless of plan (ADR-0084) — grandfathering, migration promises, support concessions. Kept apart from the subscription so a plan downgrade cannot silently revoke a promise nobody recorded making.';

COMMENT ON COLUMN awcms_tenant_entitlements.granted_by_tenant_user_id IS
  'NULL for every row a JOB wrote (the PR 5.3 backfill), non-null when a human granted it. Nullable rather than sentinel-defaulted: "no human did this" is a fact worth reading back.';

COMMIT;
