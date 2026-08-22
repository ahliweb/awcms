/**
 * Scheduled expiry sweep for delegated-access grants — ADR-0090, finding A1 of
 * the 17 August 2026 audit round.
 *
 * ## This is CLEANUP, and saying so is not a disclaimer
 *
 * Expiry itself takes effect at the instant on the row:
 * `resolveDelegatedGrantState` carries `expires_at > now()`, so the chokepoint
 * refuses an elapsed grant whether this job has run or not. A sweep alone would
 * leave a window between the second on the row and the second the timer next
 * fires, and that window is exactly when the access should already have
 * stopped.
 *
 * What the sweep adds is the part a gate cannot do: the grant is marked
 * `revoked_at` with reason `expired`, its delegated tenant user goes
 * `inactive`, and its live sessions are revoked. Without it the customer's user
 * list keeps showing a partner's person as an active member of their tenant
 * long after the engagement ended — bookkeeping, not access, but bookkeeping a
 * customer reads as fact.
 *
 * The same shape `business-scope-expiry-job.ts` uses one file over, for the
 * same reason: `isBusinessScopeAssignmentCurrentlyActive` decides, the job
 * tidies.
 *
 * ## Why the work happens inside a database function
 *
 * The job runs as `awcms_worker`, which holds neither `UPDATE` on
 * `awcms_tenant_users` nor anything on `awcms_sessions`. Granting those plainly
 * would hand a scheduled job the ability to set a deactivated member back to
 * `active` and a stolen session's `revoked_at` back to `NULL` — escalations, in
 * the role whose whole point is that it cannot escalate. `sql/142` puts the
 * privilege in a narrow `SECURITY DEFINER` function instead, following
 * `sql/048`/`sql/119`/`sql/124`; see its header for the four safeguards and for
 * why each of its three statements can only ever REMOVE access.
 *
 * ## One audit row per tenant per pass, not one per grant
 *
 * An engagement ending is worth an audit entry, and a backlog of forty is worth
 * one entry saying forty. The per-grant evidence is already on the grant row
 * itself — `revoked_at` with `revoke_reason = 'expired'` and no actor — and
 * `listDelegatedGrants` keeps revoked grants deliberately, so "who could see
 * our data, and until when" stays answerable from the table an auditor reads.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordCounter } from "../../../lib/observability/metrics-port";
import {
  iterateTenantsInBatches,
  fetchActiveTenants,
  type BatchPassResult
} from "../../../lib/jobs/batching";
import type { JobContext } from "../../../lib/jobs/job-runner";
import {
  countExpiredDelegatedAccessGrants,
  expireDelegatedAccessGrants
} from "./delegated-access-store";

const IDENTITY_ACCESS_MODULE_KEY = "identity_access";

/**
 * Bounded per pass, and `iterateTenantsInBatches` re-runs the pass until it
 * drains or hits the pass ceiling. 200 rather than the sibling job's 500
 * because each row here can touch three tables, not one.
 */
const EXPIRY_BATCH_LIMIT = 200;

export type DelegatedAccessExpiryResult = {
  tenantsChecked: number;
  grantsExpired: number;
  tenantsHitPassLimit: string[];
  aborted: boolean;
};

async function expireGrantsPass(
  sql: Bun.SQL,
  tenantId: string
): Promise<BatchPassResult> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const { expired } = await expireDelegatedAccessGrants(
        tx,
        tenantId,
        EXPIRY_BATCH_LIMIT
      );

      if (expired > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: IDENTITY_ACCESS_MODULE_KEY,
          action: "expire",
          resourceType: "delegated_access_grant",
          severity: "warning",
          message: `${expired} delegated access grant(s) expired automatically; their memberships and sessions were ended.`,
          attributes: { expiredCount: expired }
        });

        recordCounter("delegated_access_grants_expired_total", {}, expired);
      }

      return { count: expired };
    },
    { workClass: "maintenance" }
  );
}

/**
 * Read-only backlog count for `--dry-run`. Per tenant and inside
 * `withTenant`, because the table is `FORCE ROW LEVEL SECURITY` and
 * `awcms_worker`'s session GUC defaults to the all-zero UUID — an unscoped
 * count would answer zero forever and read as "nothing to do".
 */
async function countBacklogForTenant(
  sql: Bun.SQL,
  tenantId: string
): Promise<number> {
  return withTenantOrThrow(
    sql,
    tenantId,
    (tx) => countExpiredDelegatedAccessGrants(tx, tenantId),
    { workClass: "maintenance" }
  );
}

export async function runDelegatedAccessExpiry(
  sql: Bun.SQL,
  ctx: JobContext
): Promise<DelegatedAccessExpiryResult> {
  if (ctx.dryRun) {
    const tenants = await fetchActiveTenants(sql);
    let grantsExpired = 0;
    let aborted = false;

    for (const tenant of tenants) {
      if (ctx.signal.aborted) {
        aborted = true;
        break;
      }

      grantsExpired += await countBacklogForTenant(sql, tenant.id);
    }

    return {
      tenantsChecked: tenants.length,
      grantsExpired,
      tenantsHitPassLimit: [],
      aborted
    };
  }

  const outcome = await iterateTenantsInBatches(
    sql,
    (tenantId) => expireGrantsPass(sql, tenantId),
    { signal: ctx.signal }
  );

  const tenantsHitPassLimit = [...outcome.perTenant.entries()]
    .filter(([, value]) => value.hitPassLimit)
    .map(([tenantId]) => tenantId);

  return {
    tenantsChecked: outcome.tenants.length,
    grantsExpired: outcome.totalCount,
    tenantsHitPassLimit,
    aborted: outcome.aborted
  };
}
