/**
 * Grandfathering, decided purely — ADR-0084, Gelombang 5 PR 5.3 of Issue #423.
 *
 * ## Why this may be a blanket migration when the permission backfill may not
 *
 * `owner-permission-backfill.ts` refuses to re-grant anything OLDER than the
 * owner role, because a missing older permission may have been REVOKED
 * deliberately, and a backfill that cannot tell "never granted" from "taken
 * away" would silently undo a security decision.
 *
 * Entitlements have no such history, and that asymmetry is the whole argument:
 * this schema landed empty (`sql/109`), so no entitlement has ever existed to be
 * revoked. An absent row therefore cannot mean a decision — it can only mean
 * "before entitlements". Grandfathering every existing tenant is not overriding
 * anybody; it is stating what was already true.
 *
 * That stops being true the moment the first revocation happens, which is why
 * `planEntitlementBackfill` grandfathers only tenants that predate the
 * entitlement's own catalogue row, and reports — never silently re-grants — a
 * tenant that is NEWER and still lacks it. From then on the same
 * "never-granted vs taken-away" discipline the permission backfill uses applies
 * here too.
 *
 * Pure: the caller reads the rows, this decides what they mean.
 */

export type EntitlementBackfillInput = {
  /** Every entitlement key some registered module currently requires. */
  requiredEntitlementKeys: readonly string[];
  /** `entitlement_key -> awcms_entitlements.created_at`. Absent = no catalogue row. */
  catalogueCreatedAt: ReadonlyMap<string, Date>;
  tenants: readonly { tenantId: string; tenantCode: string; createdAt: Date }[];
  /** Keys each tenant already holds directly (`awcms_tenant_entitlements`). */
  heldByTenant: ReadonlyMap<string, ReadonlySet<string>>;
};

export type EntitlementBackfillGrant = {
  tenantId: string;
  tenantCode: string;
  entitlementKey: string;
};

export type EntitlementBackfillSkip = {
  tenantId: string;
  tenantCode: string;
  entitlementKey: string;
  reason: "already_held" | "no_catalogue_row" | "tenant_newer_than_entitlement";
};

export type EntitlementBackfillPlan = {
  grants: EntitlementBackfillGrant[];
  skipped: EntitlementBackfillSkip[];
};

/**
 * The reason string written to `awcms_tenant_entitlements.grant_reason`.
 *
 * Fixed, and a constant rather than a literal at the call site: a support
 * engineer three years from now reading "why does this tenant have this" needs
 * the answer to be the same sentence for every row this job ever wrote, so it
 * can be grepped and so a hand-granted row is distinguishable at a glance.
 */
export const GRANDFATHER_GRANT_REASON =
  "Grandfathered: the tenant predates this entitlement (ADR-0084 backfill).";

export function planEntitlementBackfill(
  input: EntitlementBackfillInput
): EntitlementBackfillPlan {
  const grants: EntitlementBackfillGrant[] = [];
  const skipped: EntitlementBackfillSkip[] = [];

  for (const tenant of input.tenants) {
    const held = input.heldByTenant.get(tenant.tenantId) ?? new Set<string>();

    for (const entitlementKey of input.requiredEntitlementKeys) {
      const base = {
        tenantId: tenant.tenantId,
        tenantCode: tenant.tenantCode,
        entitlementKey
      };

      if (held.has(entitlementKey)) {
        skipped.push({ ...base, reason: "already_held" });
        continue;
      }

      const catalogued = input.catalogueCreatedAt.get(entitlementKey);

      if (catalogued === undefined) {
        // A module declares it, the catalogue has never heard of it. Grandfathering
        // would need a row this job may not create — `awcms_entitlements` is
        // migration-only (ADR-0084) — and inventing one here would put a request
        // path's worth of authority in a cron script.
        skipped.push({ ...base, reason: "no_catalogue_row" });
        continue;
      }

      if (tenant.createdAt.getTime() >= catalogued.getTime()) {
        // Newer than the entitlement, so its absence is a fact about THIS
        // tenant rather than about the feature not existing yet — possibly a
        // revocation, possibly a plan it was never sold. Reported, never
        // re-granted: the discipline `owner-permission-backfill.ts` established.
        skipped.push({ ...base, reason: "tenant_newer_than_entitlement" });
        continue;
      }

      grants.push(base);
    }
  }

  return { grants, skipped };
}

/**
 * The question `bun run security:readiness` must be able to answer BEFORE a
 * descriptor declaring `requiresEntitlement` is merged: who stops being served
 * the moment it lands.
 *
 * Deliberately computed from the SAME plan the backfill produces, rather than by
 * a second query written to look similar. Two derivations of "who is missing
 * this" is two chances to answer the question differently, and the whole value
 * of this report is that it is trustworthy on the day it says zero.
 */
export type EntitlementBlastRadius = {
  entitlementKey: string;
  deniedTenantCount: number;
  deniedTenantCodes: string[];
};

export function summarizeBlastRadius(
  plan: EntitlementBackfillPlan
): EntitlementBlastRadius[] {
  const byKey = new Map<string, Set<string>>();

  const record = (entitlementKey: string, tenantCode: string): void => {
    const codes = byKey.get(entitlementKey) ?? new Set<string>();
    codes.add(tenantCode);
    byKey.set(entitlementKey, codes);
  };

  // A tenant is denied if it does not hold the key — which is every planned
  // grant (not yet applied) plus every skip that is NOT `already_held`.
  for (const grant of plan.grants) {
    record(grant.entitlementKey, grant.tenantCode);
  }

  for (const skip of plan.skipped) {
    if (skip.reason === "already_held") continue;
    record(skip.entitlementKey, skip.tenantCode);
  }

  return [...byKey.entries()]
    .map(([entitlementKey, codes]) => ({
      entitlementKey,
      deniedTenantCount: codes.size,
      deniedTenantCodes: [...codes].sort()
    }))
    .sort((a, b) => a.entitlementKey.localeCompare(b.entitlementKey));
}
