/**
 * Entitlement grandfathering — ADR-0084, Gelombang 5 PR 5.3 of Issue #423.
 *
 * DRY-RUN BY DEFAULT; `--commit` writes. The accident this guards against is
 * widening what every tenant holds in one command, and that must not be
 * reachable by typing something that looks read-only —
 * `identity-access:permissions:backfill` established the convention and the
 * reason.
 *
 * The DECISION is `domain/entitlement-backfill.ts`, pure; this file reads rows
 * and applies the plan. Same split as the subscription ladder, for the same
 * reason: the interesting half gets tested without a database.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { listModules } from "../../index";
import { requiredEntitlementForModule } from "../domain/entitlement";
import {
  GRANDFATHER_GRANT_REASON,
  planEntitlementBackfill,
  summarizeBlastRadius,
  type EntitlementBackfillPlan,
  type EntitlementBlastRadius
} from "../domain/entitlement-backfill";

/**
 * Every entitlement key some registered module currently requires.
 *
 * Reads the SAME resolver the chokepoint uses, so a module whose declaration the
 * guard would ignore (an `isCore` one) is ignored here too. A backfill that
 * grandfathered a key nothing enforces would write rows nobody reads, and a
 * backfill that MISSED a key the guard enforces would leave tenants denied — the
 * two failures the shared resolver makes impossible.
 */
export function collectRequiredEntitlementKeys(): string[] {
  const modules = listModules();

  return [
    ...new Set(
      modules
        .map((module) => requiredEntitlementForModule(module.key, modules))
        .filter((key): key is string => key !== null)
    )
  ].sort();
}

export type EntitlementBackfillResult = {
  requiredEntitlementKeys: string[];
  plan: EntitlementBackfillPlan;
  blastRadius: EntitlementBlastRadius[];
  granted: number;
  committed: boolean;
};

type TenantRow = { id: string; tenant_code: string; created_at: Date };

export async function runEntitlementBackfill(
  sql: Bun.SQL,
  options: { commit: boolean; now: Date; tenantCode?: string }
): Promise<EntitlementBackfillResult> {
  const requiredEntitlementKeys = collectRequiredEntitlementKeys();

  if (requiredEntitlementKeys.length === 0) {
    // The state this base ships in. Reported as an empty plan rather than
    // short-circuited silently, so a run that finds nothing is visibly a run
    // that found nothing rather than one that failed to look.
    return {
      requiredEntitlementKeys,
      plan: { grants: [], skipped: [] },
      blastRadius: [],
      granted: 0,
      committed: options.commit
    };
  }

  const tenantRows = (await sql`
    SELECT id, tenant_code, created_at
    FROM awcms_tenants
    WHERE status <> 'deleted'
      AND (${options.tenantCode ?? null}::text IS NULL
           OR tenant_code = ${options.tenantCode ?? null})
    ORDER BY created_at
  `) as TenantRow[];

  const catalogueRows = (await sql`
    SELECT entitlement_key, created_at FROM awcms_entitlements
  `) as { entitlement_key: string; created_at: Date }[];

  const catalogueCreatedAt = new Map(
    catalogueRows.map((row) => [row.entitlement_key, row.created_at])
  );

  const heldByTenant = new Map<string, Set<string>>();

  for (const tenant of tenantRows) {
    // Per-tenant, inside `withTenantOrThrow`: `awcms_tenant_entitlements` is
    // FORCE RLS, so a single cross-tenant SELECT would return nothing at all
    // rather than everything — the failure that reads as "no tenant holds
    // anything" and grandfathers the whole installation twice.
    const held = await withTenantOrThrow(
      sql,
      tenant.id,
      async (tx) => {
        const rows = (await tx`
          SELECT entitlement_key FROM awcms_tenant_entitlements
          WHERE tenant_id = ${tenant.id}
            AND (expires_at IS NULL OR expires_at > ${options.now})
        `) as { entitlement_key: string }[];

        return new Set(rows.map((row) => row.entitlement_key));
      },
      { workClass: "maintenance" }
    );

    heldByTenant.set(tenant.id, held);
  }

  const plan = planEntitlementBackfill({
    requiredEntitlementKeys,
    catalogueCreatedAt,
    tenants: tenantRows.map((row) => ({
      tenantId: row.id,
      tenantCode: row.tenant_code,
      createdAt: row.created_at
    })),
    heldByTenant
  });

  const blastRadius = summarizeBlastRadius(plan);

  if (!options.commit) {
    return {
      requiredEntitlementKeys,
      plan,
      blastRadius,
      granted: 0,
      committed: false
    };
  }

  let granted = 0;

  for (const grant of plan.grants) {
    await withTenantOrThrow(
      sql,
      grant.tenantId,
      async (tx) => {
        // `ON CONFLICT DO NOTHING` against the (tenant, entitlement) unique
        // index: a second run, or a concurrent hand-grant, must be a no-op
        // rather than a 23505 that aborts the transaction — the shape `sql/074`
        // and `sql/106` both chose for the same reason.
        await tx`
          INSERT INTO awcms_tenant_entitlements
            (tenant_id, entitlement_key, grant_reason)
          VALUES (${grant.tenantId}, ${grant.entitlementKey},
                  ${GRANDFATHER_GRANT_REASON})
          ON CONFLICT (tenant_id, entitlement_key) DO NOTHING
        `;
      },
      { workClass: "maintenance" }
    );

    granted += 1;
  }

  return {
    requiredEntitlementKeys,
    plan,
    blastRadius,
    granted,
    committed: true
  };
}
