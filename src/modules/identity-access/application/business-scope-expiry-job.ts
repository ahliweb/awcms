/**
 * Scheduled expiry job for business-scope assignments (Issue #180, epic #177
 * Wave 2 authorization). Ported from awcms-mini
 * (`identity-access/application/business-scope-expiry-job.ts`, Issue #746)
 * but with the SoD-conflict-exception expiry pass STRIPPED — that table
 * (`awcms_mini_sod_conflict_exceptions`) belongs to #181, not #180, so this
 * job only sweeps `awcms_business_scope_assignments`.
 *
 * Built on the shared worker runner (`src/lib/jobs/job-runner.ts`'s `runJob`)
 * and `iterateTenantsInBatches` (`src/lib/jobs/batching.ts`), same shape as
 * `data-lifecycle`'s archive-purge job in mini: bounded per-tenant passes,
 * `withTenant` for RLS-scoped access even on the worker connection, resumable
 * after interruption (a later run simply finds the same still-`active`-but-
 * expired backlog again).
 *
 * "Temporary assignments automatically expire and are audited" (issue #180):
 * every transitioned assignment gets an
 * `awcms_business_scope_assignment_events` row (`event_type: "expired"`,
 * `actor_tenant_user_id: null` — a system/scheduled transition, not a human
 * action) PLUS one aggregate `recordAuditEvent` per tenant per pass
 * (count-only, avoiding one `awcms_audit_events` row per expired assignment
 * when a backlog is large).
 *
 * Flipping `status` to `expired` here is a BACKGROUND CLEANUP, not the
 * authorization gate: `isBusinessScopeAssignmentCurrentlyActive` already
 * treats an `active` row past its `effective_to` as not-in-force at decision
 * time (`business-scope-facts.ts`), so revocation/expiry takes effect
 * immediately regardless of when this job runs.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import { withTenant } from "../../../lib/database/tenant-context";
import {
  recordCounter,
  recordGauge
} from "../../../lib/observability/metrics-port";
import {
  iterateTenantsInBatches,
  fetchActiveTenants,
  type BatchPassResult
} from "../../../lib/jobs/batching";
import type { JobContext } from "../../../lib/jobs/job-runner";

const IDENTITY_ACCESS_MODULE_KEY = "identity_access";
const ASSIGNMENT_EXPIRY_BATCH_LIMIT = 500;

type ExpiryPassResult = BatchPassResult;

async function expireAssignmentsPass(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<ExpiryPassResult> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const expiredRows = (await tx`
        UPDATE awcms_business_scope_assignments
        SET status = 'expired', updated_at = now()
        WHERE id IN (
          SELECT id FROM awcms_business_scope_assignments
          WHERE tenant_id = ${tenantId} AND status = 'active'
            AND effective_to IS NOT NULL AND effective_to <= ${now}
          ORDER BY effective_to
          LIMIT ${ASSIGNMENT_EXPIRY_BATCH_LIMIT}
        )
        RETURNING id
      `) as { id: string }[];

      for (const row of expiredRows) {
        await tx`
          INSERT INTO awcms_business_scope_assignment_events
            (tenant_id, assignment_id, event_type, reason)
          VALUES (${tenantId}, ${row.id}, 'expired', 'Automatic expiry (effective_to elapsed)')
        `;
      }

      if (expiredRows.length > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: IDENTITY_ACCESS_MODULE_KEY,
          action: "expire",
          resourceType: "business_scope_assignment",
          severity: "warning",
          message: `${expiredRows.length} business-scope assignment(s) expired automatically.`,
          attributes: { expiredCount: expiredRows.length }
        });

        recordCounter(
          "business_scope_expirations_total",
          { itemType: "assignment" },
          expiredRows.length
        );
      }

      return { count: expiredRows.length };
    },
    { workClass: "maintenance" }
  );
}

export type BusinessScopeExpiryResult = {
  tenantsChecked: number;
  assignmentsExpired: number;
  tenantsHitPassLimit: string[];
};

/**
 * Refreshes the `business_scope_assignments_active`/`_temporary` gauges for
 * one tenant, by `scopeType` — a snapshot as of NOW, recomputed once per
 * tenant per job run (not per bounded pass) since these are point-in-time
 * gauges, not cumulative counters.
 */
async function refreshAssignmentGauges(
  sql: Bun.SQL,
  tenantId: string
): Promise<void> {
  await withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT scope_type, count(*) FILTER (WHERE true) AS active_count,
          count(*) FILTER (WHERE is_temporary) AS temporary_count
        FROM awcms_business_scope_assignments
        WHERE tenant_id = ${tenantId} AND status = 'active'
        GROUP BY scope_type
      `) as {
        scope_type: string;
        active_count: string;
        temporary_count: string;
      }[];

      for (const row of rows) {
        recordGauge(
          "business_scope_assignments_active",
          Number(row.active_count),
          { scopeType: row.scope_type }
        );
        recordGauge(
          "business_scope_assignments_temporary",
          Number(row.temporary_count),
          { scopeType: row.scope_type }
        );
      }
    },
    { workClass: "maintenance" }
  );
}

/**
 * Read-only per-tenant backlog count for `--dry-run`. Iterates real tenants
 * and sums a `withTenant`-scoped count per tenant (both tables are FORCE
 * ROW LEVEL SECURITY'd and `awcms_worker`'s session GUC defaults to the
 * all-zero UUID, so an un-`withTenant`-scoped count would always be zero) —
 * this function only reads, never mutates.
 */
async function countExpiredBacklogForTenant(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<number> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT count(*) AS assignments
        FROM awcms_business_scope_assignments
        WHERE tenant_id = ${tenantId} AND status = 'active'
          AND effective_to IS NOT NULL AND effective_to <= ${now}
      `) as { assignments: string }[];

      return Number(rows[0]?.assignments ?? 0);
    },
    { workClass: "maintenance" }
  );
}

export async function runBusinessScopeExpiry(
  sql: Bun.SQL,
  ctx: JobContext
): Promise<BusinessScopeExpiryResult> {
  const now = new Date();

  if (ctx.dryRun) {
    const tenants = await fetchActiveTenants(sql);
    let assignmentsExpired = 0;

    for (const tenant of tenants) {
      if (ctx.signal.aborted) break;
      assignmentsExpired += await countExpiredBacklogForTenant(
        sql,
        tenant.id,
        now
      );
    }

    return {
      tenantsChecked: tenants.length,
      assignmentsExpired,
      tenantsHitPassLimit: []
    };
  }

  const assignmentOutcome = await iterateTenantsInBatches(
    sql,
    (tenantId) => expireAssignmentsPass(sql, tenantId, now),
    { signal: ctx.signal }
  );

  for (const tenant of assignmentOutcome.tenants) {
    if (ctx.signal.aborted) break;
    await refreshAssignmentGauges(sql, tenant.id);
  }

  const tenantsHitPassLimit = new Set<string>();
  for (const [tenantId, outcome] of assignmentOutcome.perTenant) {
    if (outcome.hitPassLimit) tenantsHitPassLimit.add(tenantId);
  }

  return {
    tenantsChecked: assignmentOutcome.tenants.length,
    assignmentsExpired: assignmentOutcome.totalCount,
    tenantsHitPassLimit: [...tenantsHitPassLimit]
  };
}
