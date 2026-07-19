/**
 * Scheduled expiry job for business-scope assignments AND SoD conflict
 * exceptions (Issue #180 + #181, epic #177 Wave 2 authorization). Ported from
 * awcms-mini (`identity-access/application/business-scope-expiry-job.ts`,
 * Issue #746). #180 shipped the assignment sweep; #181 re-adds the
 * SoD-conflict-exception expiry pass (`awcms_sod_conflict_exceptions`).
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
 * when a backlog is large); every transitioned SoD exception gets one
 * `recordAuditEvent` per row (`critical` severity — exceptions are
 * low-volume, and a compliance-sensitive override losing its cover is worth
 * an individually addressable audit entry). Flipping `status` here is a
 * BACKGROUND CLEANUP, not the gate: `isSoDConflictExceptionCurrentlyValid`
 * already treats an `approved` row past its `effective_to` as ineffective at
 * decision time, so expiry takes effect IMMEDIATELY (issue #181).
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
const EXCEPTION_EXPIRY_BATCH_LIMIT = 500;

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

async function expireSoDConflictExceptionsPass(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<ExpiryPassResult> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const expiredRows = (await tx`
        UPDATE awcms_sod_conflict_exceptions
        SET status = 'expired', updated_at = now()
        WHERE id IN (
          SELECT id FROM awcms_sod_conflict_exceptions
          WHERE tenant_id = ${tenantId} AND status = 'approved' AND effective_to <= ${now}
          ORDER BY effective_to
          LIMIT ${EXCEPTION_EXPIRY_BATCH_LIMIT}
        )
        RETURNING id, rule_key
      `) as { id: string; rule_key: string }[];

      for (const row of expiredRows) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: IDENTITY_ACCESS_MODULE_KEY,
          action: "expire",
          resourceType: "sod_conflict_exception",
          resourceId: row.id,
          severity: "critical",
          message: `SoD conflict exception for rule "${row.rule_key}" expired automatically.`,
          attributes: { ruleKey: row.rule_key }
        });
      }

      if (expiredRows.length > 0) {
        recordCounter(
          "business_scope_expirations_total",
          { itemType: "exception" },
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
  exceptionsExpired: number;
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
): Promise<{ assignments: number; exceptions: number }> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT
          (SELECT count(*) FROM awcms_business_scope_assignments
            WHERE tenant_id = ${tenantId} AND status = 'active'
              AND effective_to IS NOT NULL AND effective_to <= ${now}) AS assignments,
          (SELECT count(*) FROM awcms_sod_conflict_exceptions
            WHERE tenant_id = ${tenantId} AND status = 'approved' AND effective_to <= ${now}) AS exceptions
      `) as { assignments: string; exceptions: string }[];

      return {
        assignments: Number(rows[0]?.assignments ?? 0),
        exceptions: Number(rows[0]?.exceptions ?? 0)
      };
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
    let exceptionsExpired = 0;

    for (const tenant of tenants) {
      if (ctx.signal.aborted) break;
      const counts = await countExpiredBacklogForTenant(sql, tenant.id, now);
      assignmentsExpired += counts.assignments;
      exceptionsExpired += counts.exceptions;
    }

    return {
      tenantsChecked: tenants.length,
      assignmentsExpired,
      exceptionsExpired,
      tenantsHitPassLimit: []
    };
  }

  const assignmentOutcome = await iterateTenantsInBatches(
    sql,
    (tenantId) => expireAssignmentsPass(sql, tenantId, now),
    { signal: ctx.signal }
  );

  const exceptionOutcome = await iterateTenantsInBatches(
    sql,
    (tenantId) => expireSoDConflictExceptionsPass(sql, tenantId, now),
    { signal: ctx.signal, tenants: assignmentOutcome.tenants }
  );

  for (const tenant of assignmentOutcome.tenants) {
    if (ctx.signal.aborted) break;
    await refreshAssignmentGauges(sql, tenant.id);
  }

  const tenantsHitPassLimit = new Set<string>();
  for (const [tenantId, outcome] of assignmentOutcome.perTenant) {
    if (outcome.hitPassLimit) tenantsHitPassLimit.add(tenantId);
  }
  for (const [tenantId, outcome] of exceptionOutcome.perTenant) {
    if (outcome.hitPassLimit) tenantsHitPassLimit.add(tenantId);
  }

  return {
    tenantsChecked: assignmentOutcome.tenants.length,
    assignmentsExpired: assignmentOutcome.totalCount,
    exceptionsExpired: exceptionOutcome.totalCount,
    tenantsHitPassLimit: [...tenantsHitPassLimit]
  };
}
