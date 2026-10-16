/**
 * Per-panel authorisation and read audit for the HR self-service screens
 * (Issue #952, security audit H-1 and M-1).
 *
 * ## Why a screen cannot authorise on its entry key alone
 *
 * The entry key (`hr_workforce.self_service.read`) opens the PAGE. The data on it
 * is the data of routes that each run the full chokepoint with an ownership
 * grant (ADR-0063): a tenant ABAC `deny` on `attendance.read` makes
 * `GET /attendance-events?mine=true` answer 403, because deny-overrides-allow
 * runs BEFORE the ownership widening. A page that called the directory function
 * directly would keep showing the events, a second, weaker door to the same data.
 * So every panel asks the SAME question the route asks -- the route's own guard
 * with the route's own ownership grant -- through `can`, and renders nothing for
 * a panel that is denied. The reasons below are the routes' reasons verbatim, so
 * the decision log reads the same whichever door was used.
 *
 * ## Audit
 *
 * Outside the employee's own basis (`reports`, `all`) the routes record a
 * sensitive read (ids and a count, never a value). A page that reads in those
 * bases records it the same way, in the same transaction, fail-closed: if the
 * audit cannot be written the page load fails and shows nothing.
 */
import type { AccessRequest } from "../modules/identity-access/domain/access-control";
import type { OwnershipGrant } from "../modules/identity-access/application/access-guard";
import { HR_WORKFORCE_GUARDS } from "../modules/hr-workforce/domain/hr-workforce-permissions";
import { recordSensitiveRead } from "../modules/logging/application/sensitive-read-audit";

export type HrBasis = "mine" | "reports" | "all";

type CanFn = (
  request: AccessRequest,
  options?: { ownershipGrant?: OwnershipGrant }
) => Promise<boolean>;

/** The ownership grants of the routes, reason for reason. */
const GRANTS = {
  employmentsMine: "employee lists their own employment",
  shiftsMine: "employee lists their own published schedule",
  attendanceMine: "employee lists their own attendance",
  attendanceReports: "supervisor lists their reports' attendance",
  correctionsMine: "employee lists their own attendance corrections",
  correctionsReports: "supervisor lists their reports' attendance corrections",
  metricsMine: "employee reads their own workforce metrics",
  metricsReports: "supervisor reads their direct reports' workforce metrics"
} as const;

export type HrPanel =
  | "employmentsMine"
  | "shiftsMine"
  | "attendanceMine"
  | "attendanceReports"
  | "correctionsMine"
  | "correctionsReports"
  | "metricsMine"
  | "metricsReports";

const GUARD_OF: Record<HrPanel, AccessRequest> = {
  employmentsMine: HR_WORKFORCE_GUARDS.employments.read,
  shiftsMine: HR_WORKFORCE_GUARDS.shifts.read,
  attendanceMine: HR_WORKFORCE_GUARDS.attendance.read,
  attendanceReports: HR_WORKFORCE_GUARDS.attendance.read,
  correctionsMine: HR_WORKFORCE_GUARDS.corrections.read,
  correctionsReports: HR_WORKFORCE_GUARDS.corrections.read,
  metricsMine: HR_WORKFORCE_GUARDS.workforceMetrics.read,
  metricsReports: HR_WORKFORCE_GUARDS.workforceMetrics.read
};

/**
 * May this caller read this panel's data in the employee's or supervisor's
 * basis? The route's guard plus the route's ownership grant, through the full
 * chokepoint (so an ABAC deny wins and the decision is logged).
 */
export function canReadPanel(can: CanFn, panel: HrPanel): Promise<boolean> {
  return can(GUARD_OF[panel], {
    ownershipGrant: { granted: true, reason: GRANTS[panel] }
  });
}

type AuditedPermission =
  | "hr_workforce.attendance.read"
  | "hr_workforce.corrections.read"
  | "hr_workforce.workforce_metrics.read";

/**
 * Records the sensitive read a route would record, for a page that read in a
 * non-own basis. Ids de-duplicated, a count, never a time or a value. A no-op
 * for the employee's own basis (reading yourself is not an event to explain).
 */
export async function auditPanelRead(
  tx: Bun.SQL,
  input: {
    basis: HrBasis;
    tenantId: string;
    actorTenantUserId: string;
    permission: AuditedPermission;
    employmentIds: readonly string[];
    itemCount: number;
    correlationId?: string;
  }
): Promise<void> {
  // The employee's own basis is not an event to explain, and a read that
  // returned no one discloses no one (audit N-3).
  if (input.basis === "mine" || input.employmentIds.length === 0) {
    return;
  }

  await recordSensitiveRead(tx, {
    mode: input.basis,
    tenantId: input.tenantId,
    actorTenantUserId: input.actorTenantUserId,
    permission: input.permission,
    itemCount: input.itemCount,
    resourceIds: [...new Set(input.employmentIds)],
    correlationId: input.correlationId
  });
}
