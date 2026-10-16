import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
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
 * recovered by subtraction. No composite score. Never cached.
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
  handler: async ({ tx, tenantId, prepared, now }) => {
    const result = await listGroupFigures(tx, tenantId, prepared, now);

    if (result.tooLarge) {
      return fail(
        422,
        "WORKFORCE_METRICS_SCOPE_TOO_LARGE",
        "The tenant has too many employments for one aggregate request."
      );
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
        groups: result.groups.map((figure) =>
          figure.suppressed
            ? {
                officeId: figure.group.officeId,
                suppressed: true as const,
                reason: figure.reason
              }
            : {
                officeId: figure.group.officeId,
                suppressed: false as const,
                contributorsBand: figure.contributorsBand,
                facts: figure.facts
              }
        )
      },
      {},
      { "cache-control": "private, no-store" }
    );
  }
});
