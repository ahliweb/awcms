import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordSensitiveRead } from "../../../../../modules/logging/application/sensitive-read-audit";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import { listGroupFigures } from "../../../../../modules/hr-workforce/application/hr-workforce-metrics-directory";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  MIN_CONTRIBUTION_MINUTES,
  parseAggregateWindow,
  SMALL_GROUP_MIN_CONTRIBUTORS,
  WORKFORCE_GOVERNANCE_NOTICE,
  WORKFORCE_METRICS_CONTRACT_VERSION,
  type AggregateBucket,
  type MetricsQuery
} from "../../../../../modules/hr-workforce/domain/hr-workforce-metrics";

/**
 * `GET /api/v1/hr-workforce/workforce-metrics/groups` -- per-OFFICE workforce
 * aggregates (the office of each employee's current terms; `officeId: null` is
 * "no office assigned") over exactly ONE CLOSED calendar bucket: a whole UTC ISO
 * week (Monday 00:00Z to the next Monday); a month or any other window is
 * 400. Any
 * other window, or a bucket still in progress, is 400: free windows let two
 * requests differing by a tail slice isolate one person.
 *
 * Gated by `hr_workforce.workforce_metrics.analyze` (or `.read`); there is no
 * ownership grant -- an aggregate is not "my own record". It returns NO
 * individual row. A group with fewer than five CONTRIBUTING employees (at
 * least four hours scheduled or worked in the bucket) is returned
 * `suppressed: true` with no number at all; a shown group reports only a
 * contributor BAND ("5-9", "10-19", "20+"), never an exact count, and
 * there is deliberately no tenant-wide total, so a suppressed group cannot be
 * recovered by subtraction. A suppressed group ALSO carries no `officeId` (Issue
 * #1083, L2): an `.analyze`-only caller must not learn which offices exist and
 * which are under the threshold. Suppressed groups are listed after the shown
 * ones, all alike, so neither the office nor its sort position is revealed. No
 * composite score. Never cached.
 *
 * The read is recorded as a sensitive read (`sensitive_read.workforce_metrics`,
 * the group count and no ids: an aggregate names no person), because this route
 * also accepts `.read`, whose exercise is audited (PS-18, Issue #1083 M3).
 */
export const GET = defineTenantRoute<
  MetricsQuery & { bucket: AggregateBucket }
>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const window = parseAggregateWindow(url.searchParams, new Date());

    return window.valid
      ? window.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, window.errors);
  },
  authorize: [
    HR_WORKFORCE_GUARDS.workforceMetrics.analyze,
    HR_WORKFORCE_GUARDS.workforceMetrics.read
  ],
  handler: async ({ tx, tenantId, prepared, now, auth, locals, tokenHash }) => {
    const result = await listGroupFigures(tx, tenantId, prepared, now);

    if (result.tooLarge) {
      return fail(
        422,
        "WORKFORCE_METRICS_SCOPE_TOO_LARGE",
        "The tenant has too many employments for one aggregate request."
      );
    }

    // The permission that ACTUALLY granted (Issue #1083 L-1): `.read` when the
    // caller holds it, otherwise `.analyze`. Both policies share one kind.
    const holdsRead = (
      await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        HR_WORKFORCE_GUARDS.workforceMetrics.read
      )
    ).allowed;

    if (holdsRead) {
      await recordSensitiveRead(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        permission: "hr_workforce.workforce_metrics.read",
        itemCount: result.groups.length,
        correlationId: locals.correlationId
      });
    } else {
      await recordSensitiveRead(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        permission: "hr_workforce.workforce_metrics.analyze",
        itemCount: result.groups.length,
        correlationId: locals.correlationId
      });
    }

    return ok(
      {
        contractVersion: WORKFORCE_METRICS_CONTRACT_VERSION,
        window: {
          from: prepared.from.toISOString(),
          to: prepared.to.toISOString(),
          bucket: prepared.bucket
        },
        governance: WORKFORCE_GOVERNANCE_NOTICE,
        suppression: {
          minContributors: SMALL_GROUP_MIN_CONTRIBUTORS,
          minContributionMinutes: MIN_CONTRIBUTION_MINUTES
        },
        groups: [
          ...result.groups.flatMap((figure) =>
            figure.suppressed
              ? []
              : [
                  {
                    officeId: figure.group.officeId,
                    suppressed: false as const,
                    contributorsBand: figure.contributorsBand,
                    facts: figure.facts
                  }
                ]
          ),
          ...result.groups.flatMap((figure) =>
            figure.suppressed
              ? [{ suppressed: true as const, reason: figure.reason }]
              : []
          )
        ]
      },
      {},
      { "cache-control": "private, no-store" }
    );
  }
});
