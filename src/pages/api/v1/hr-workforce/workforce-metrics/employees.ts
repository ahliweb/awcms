import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordSensitiveRead } from "../../../../../modules/logging/application/sensitive-read-audit";
import {
  employmentWithinMetricsBasis,
  listEmployeeFacts,
  type MetricsBasis
} from "../../../../../modules/hr-workforce/application/hr-workforce-metrics-directory";
import {
  asUuid,
  badId
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  parseMetricsWindow,
  WORKFORCE_GOVERNANCE_NOTICE,
  WORKFORCE_METRICS_CONTRACT_VERSION,
  type MetricsQuery
} from "../../../../../modules/hr-workforce/domain/hr-workforce-metrics";

type Prepared = {
  window: MetricsQuery;
  employmentId?: string;
  after: string | null;
  mine: boolean;
  reports: boolean;
};

function flag(url: URL, name: string): boolean | Response {
  const value = url.searchParams.get(name);

  if (value && value !== "true" && value !== "false") {
    return fail(400, "VALIDATION_ERROR", `${name} must be true or false.`);
  }

  return value === "true";
}

/**
 * `GET /api/v1/hr-workforce/workforce-metrics/employees` -- the transparent
 * attendance, hours, shift-coverage and productivity FACTS of employees over a
 * window (`from` inclusive, `to` exclusive, UTC instants, at most 31 days).
 *
 * Three ways in, never combined:
 *   * `?mine=true`    -- your OWN facts; needs no permission beyond being linked
 *                        to an employment (an ownership grant, ADR-0063);
 *   * `?reports=true` -- your DIRECT reports' facts (one level, unlike the
 *                        attendance list's chain); the same grant;
 *   * neither         -- every employee's facts; needs
 *                        `hr_workforce.workforce_metrics.read` (HR).
 * An `employmentId` outside the chosen basis is 403, the same as one that does not
 * exist. There is NO composite score, ranking or flag: every figure is a count,
 * minutes, or a ratio defined in docs/awcms/workforce-metrics.md. No photo,
 * biometric, device or location data is read (there is none to read).
 * Never cached.
 */
export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const window = parseMetricsWindow(url.searchParams);

    if (!window.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Query is invalid.",
        {},
        window.errors
      );
    }

    const employmentId = url.searchParams.get("employmentId");
    const after = url.searchParams.get("cursor");

    if (employmentId && !asUuid(employmentId)) {
      return badId("employmentId");
    }

    if (after && !asUuid(after)) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    const mine = flag(url, "mine");
    const reports = flag(url, "reports");

    for (const parsed of [mine, reports]) {
      if (parsed instanceof Response) {
        return parsed;
      }
    }

    if (mine === true && reports === true) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "mine and reports cannot be combined."
      );
    }

    return {
      window: window.value,
      employmentId: employmentId ? asUuid(employmentId)! : undefined,
      after: after ? asUuid(after) : null,
      mine: mine === true,
      reports: reports === true
    };
  },
  ownershipGrant: async ({ prepared }) => ({
    granted: prepared.mine || prepared.reports,
    reason: prepared.mine
      ? "employee reads their own workforce metrics"
      : "supervisor reads their direct reports' workforce metrics"
  }),
  authorize: HR_WORKFORCE_GUARDS.workforceMetrics.read,
  handler: async ({ tx, tenantId, prepared, auth, now, locals }) => {
    const tenantUserId = auth.context.tenantUserId;
    const basis: MetricsBasis = prepared.mine
      ? { mode: "mine", tenantUserId }
      : prepared.reports
        ? { mode: "reports", tenantUserId }
        : { mode: "all" };

    if (
      prepared.employmentId &&
      !(await employmentWithinMetricsBasis(
        tx,
        tenantId,
        prepared.employmentId,
        basis
      ))
    ) {
      return fail(
        403,
        "ACCESS_DENIED",
        "That employment is outside what you may read."
      );
    }

    const page = await listEmployeeFacts(tx, tenantId, basis, prepared.window, {
      employmentId: prepared.employmentId,
      after: prepared.after,
      now
    });

    // PS-18 / Issue #1083 M3: HR reading EVERY employee's attendance, hours and
    // worked-to-scheduled ratio is an event somebody may later need to explain,
    // and the decision log does not say which employments were read. Ids and a
    // count only, coalesced per actor and window. A supervisor's reports read
    // is recorded too, with mode "reports" (Issue #1083 M-2): the manager chain
    // can make a director with no HR permission a reader of everyone. Only the
    // employee's OWN read is unrecorded (reading yourself is not an event to
    // explain); the decision log still holds it.
    if (basis.mode !== "mine") {
      await recordSensitiveRead(tx, {
        mode: basis.mode,
        tenantId,
        actorTenantUserId: tenantUserId,
        permission: "hr_workforce.workforce_metrics.read",
        itemCount: page.employees.length,
        resourceIds: page.employees.map((row) => row.employmentId),
        correlationId: locals.correlationId
      });
    }

    return ok(
      {
        contractVersion: WORKFORCE_METRICS_CONTRACT_VERSION,
        window: {
          from: prepared.window.from.toISOString(),
          to: prepared.window.to.toISOString()
        },
        governance: WORKFORCE_GOVERNANCE_NOTICE,
        employees: page.employees,
        nextCursor: page.nextCursor
      },
      {},
      { "cache-control": "private, no-store" }
    );
  }
});
