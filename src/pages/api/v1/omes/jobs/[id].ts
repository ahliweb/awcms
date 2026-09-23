import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import { fetchJobDetail } from "../../../../../modules/omes-control/application/job-directory";

/** `GET /api/v1/omes/jobs/{id}` (Issue ahliweb/omes#198) — `{id}` is `awcms_omes_jobs.id`. */
export const GET = defineTenantRoute<undefined>({
  workClass: "interactive",
  authorize: OMES_GUARDS.jobs.read,
  handler: async ({ tx, tenantId, params }) => {
    const id = params.id;

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "Job id is required.");
    }

    const job = await fetchJobDetail(tx, tenantId, id);

    if (!job) {
      return fail(404, "RESOURCE_NOT_FOUND", "Job not found.");
    }

    return ok({ job });
  }
});
