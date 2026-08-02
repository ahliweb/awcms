/**
 * Which tenant holds PLATFORM authority, and whether this deployment is
 * currently single- or multi-tenant.
 *
 * ## Why this file exists
 *
 * A handful of actions in this base change data that is served to EVERY tenant
 * — the Indonesia region dataset being the first (ADR-0046/ADR-0052). Those
 * actions have no sensible per-tenant subject: the tables carry no `tenant_id`
 * and no RLS, so "the tenant asking" is not the population affected.
 *
 * ADR-0051 §Keputusan made the rule normative — an action whose effect crosses
 * tenant boundaries MUST have a platform-scoped gate and MUST NOT sit in the
 * catalogue seeded to tenant roles — but the primitive that rule needs did not
 * exist. This is that primitive's first half: naming the tenant that holds
 * platform authority. The second half is `scope: "platform"` on the permission
 * itself (`_shared/module-contract.ts`) and the chokepoint check in
 * `identity-access/application/access-guard.ts`.
 *
 * ## The resolution order, and why it starts where it does
 *
 * `PLATFORM_TENANT_ID` → the public default-tenant chain
 * (`PUBLIC_DEFAULT_TENANT_ID` → `PUBLIC_DEFAULT_TENANT_CODE` →
 * `awcms_setup_state.tenant_id`).
 *
 * The default is deliberately the SAME chain the public renderer uses, because
 * in a single-tenant deployment those are the same tenant and inventing a
 * second answer would be a second thing to keep in step. `PLATFORM_TENANT_ID`
 * exists so the two can be separated the day they stop agreeing — in SaaS the
 * landing page usually belongs to a marketing tenant while platform authority
 * must stay with the operator — WITHOUT another migration or another change to
 * the authorization chokepoint.
 *
 * **Operational consequence, stated rather than buried:** while
 * `PLATFORM_TENANT_ID` is unset, `PUBLIC_DEFAULT_TENANT_ID` is a security
 * control. Repointing it repoints platform authority. `security:readiness`
 * reports which tenant currently holds that authority and warns when it is not
 * the tenant the setup wizard bootstrapped, so the condition is visible rather
 * than silent.
 *
 * ## Fail-closed asymmetry against the public resolver
 *
 * `resolveDefaultPublicTenantFromEnv` treats a malformed/unknown
 * `PUBLIC_DEFAULT_TENANT_ID` as "this step did not resolve" and falls through:
 * for RENDERING, degrading to the next candidate is graceful. For AUTHORITY it
 * is not — falling through would hand platform rights to a tenant the operator
 * did not name. So an explicitly-set-but-unresolvable `PLATFORM_TENANT_ID`
 * resolves to `null` here, and `null` denies every platform action.
 */
import { assertUuid } from "../database/tenant-context";
import type { PublicTenantResolution } from "./public-tenant-resolver";
import {
  resolveDefaultPublicTenantFromEnv,
  resolveDefaultPublicTenantFromSetupState
} from "./public-host-tenant-resolver";

/** The dedicated override. Unset = inherit the public default-tenant chain. */
export const PLATFORM_TENANT_ENV_VAR = "PLATFORM_TENANT_ID";

/**
 * Where the answer came from. Carried so operators (and
 * `security:readiness`) can tell a deliberate pin from an inherited default —
 * the difference matters, because only one of them survives someone editing
 * `PUBLIC_DEFAULT_TENANT_ID` for an unrelated reason.
 */
export type PlatformTenantSource =
  "platform_tenant_id" | "public_default_env" | "setup_state";

export type PlatformTenantResolution = {
  tenantId: string;
  tenantCode: string;
  source: PlatformTenantSource;
};

/**
 * Reads `awcms_tenants` directly on the app-role connection: that table is
 * deliberately RLS-free (it is the root table — see `sql/017`'s note), which is
 * also why the public resolver can read it before any tenant context exists.
 */
async function fetchActiveTenant(
  sql: Bun.SQL,
  tenantId: string
): Promise<{ tenantId: string; tenantCode: string } | null> {
  const rows = (await sql`
    SELECT id, tenant_code
    FROM awcms_tenants
    WHERE id = ${tenantId} AND status = 'active'
  `) as { id: string; tenant_code: string }[];

  const row = rows[0];

  return row ? { tenantId: row.id, tenantCode: row.tenant_code } : null;
}

function fromPublicResolution(
  resolution: PublicTenantResolution | null,
  source: PlatformTenantSource
): PlatformTenantResolution | null {
  return resolution
    ? {
        tenantId: resolution.tenantId,
        tenantCode: resolution.tenantCode,
        source
      }
    : null;
}

/**
 * The tenant that holds platform authority, or `null` when the deployment
 * cannot name one — in which case every platform-scoped permission is refused.
 *
 * `null` is a legitimate state, not a bug: a database whose setup wizard has
 * not run yet has no tenants at all. Denying is the only safe answer, and it is
 * the same answer an unresolvable explicit pin gets.
 */
export async function resolvePlatformTenant(
  sql: Bun.SQL,
  env: NodeJS.ProcessEnv = process.env
): Promise<PlatformTenantResolution | null> {
  const pinned = env[PLATFORM_TENANT_ENV_VAR]?.trim();

  if (pinned) {
    // Explicit pin: resolve it or deny. NEVER fall through — see the header.
    try {
      assertUuid(pinned);
    } catch {
      return null;
    }

    const tenant = await fetchActiveTenant(sql, pinned);

    return tenant ? { ...tenant, source: "platform_tenant_id" } : null;
  }

  const fromEnv = fromPublicResolution(
    await resolveDefaultPublicTenantFromEnv(sql, env),
    "public_default_env"
  );

  if (fromEnv) {
    return fromEnv;
  }

  return fromPublicResolution(
    await resolveDefaultPublicTenantFromSetupState(sql),
    "setup_state"
  );
}

/**
 * `single` while the platform tenant is the only active tenant; `multi` from
 * the moment a second one exists.
 *
 * DERIVED, never configured. A stored flag would have to be flipped by whoever
 * provisions tenant number two, and the failure mode of forgetting is that a
 * deployment keeps behaving as if its one tenant owned everything — precisely
 * the assumption that has to stop holding. Deriving it means the transition
 * cannot be missed, because there is nothing to miss.
 *
 * The mode NEVER relaxes a gate. Platform-scoped permissions are enforced
 * identically in both modes; `single` only changes what a screen explains.
 * Anything else would make the security posture depend on a row count.
 */
export type TenancyMode = "single" | "multi";

export async function resolveTenancyMode(sql: Bun.SQL): Promise<TenancyMode> {
  // Counts ACTIVE tenants only: a suspended or inactive tenant is not a party
  // this deployment is currently serving, and letting one hold the deployment
  // in `multi` forever would be a lie in the other direction.
  const rows = (await sql`
    SELECT count(*)::int AS total
    FROM awcms_tenants
    WHERE status = 'active'
  `) as { total: number }[];

  return (rows[0]?.total ?? 0) > 1 ? "multi" : "single";
}
