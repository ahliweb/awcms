import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { listEmployments } from "../../../../modules/hr-workforce/application/hr-workforce-directory";
import { directReportIdsOf } from "../../../../modules/hr-workforce/application/hr-workforce-metrics-directory";
import { HR_WORKFORCE_GUARDS } from "../../../../modules/hr-workforce/domain/hr-workforce-permissions";

/**
 * `GET /api/v1/hr-workforce/me` -- the caller's OWN employment summary and
 * whether anyone reports to them (Issue #952). The employee and supervisor
 * screens read it to know which employment a correction request is for and
 * whether to offer the team view.
 *
 * Gated by `hr_workforce.self_service.read` (default-deny: a login that holds
 * neither the key nor a role granting it gets 403). The answer is bound to the
 * caller by the query itself, `employments.tenant_user_id = the caller`, so no
 * parameter can name another person. It returns no profile id, no name and no
 * contact: the employment id, the employee number, the dates and the current
 * terms the employee already sees on their contract. Never cached.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: HR_WORKFORCE_GUARDS.selfService.read,
  handler: async ({ tx, tenantId, auth }) => {
    const tenantUserId = auth.context.tenantUserId;
    const own = await listEmployments(tx, tenantId, {
      ownedByTenantUserId: tenantUserId
    });
    const reports = await directReportIdsOf(tx, tenantId, tenantUserId);

    return ok(
      {
        employments: own.employments.map((employment) => ({
          id: employment.id,
          employeeNo: employment.employeeNo,
          hiredOn: employment.hiredOn,
          terminatedOn: employment.terminatedOn,
          currentTerm: employment.currentTerm
            ? {
                officeId: employment.currentTerm.officeId,
                jobTitle: employment.currentTerm.jobTitle,
                employmentType: employment.currentTerm.employmentType,
                status: employment.currentTerm.status
              }
            : null
        })),
        hasDirectReports: reports.length > 0
      },
      {},
      { "cache-control": "private, no-store" }
    );
  }
});
