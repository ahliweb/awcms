import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { employmentIsCallers } from "../../../../../modules/hr-workforce/application/hr-attendance-directory";
import { readNoticeStatus } from "../../../../../modules/hr-workforce/application/hr-location-evidence";
import {
  asUuid,
  badId
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";

type Prepared = { employmentId: string };

/**
 * `GET /api/v1/hr-workforce/geolocation/notice?employmentId=` — what the
 * employee's clock client needs BEFORE it offers a position: whether the tenant
 * has the feature on, the accuracy ceiling, the current notice (every locale) and
 * whether this employee has acknowledged it. Needs `hr_workforce.clock.create`
 * and an employment linked to the caller's login (anything else is 403). When
 * the feature is off, `enabled` is false and no notice is returned: the client
 * must not ask for a position. `no-store`.
 */
export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const employmentId = asUuid(url.searchParams.get("employmentId"));

    return employmentId ? { employmentId } : badId("employmentId");
  },
  authorize: HR_WORKFORCE_GUARDS.clock.create,
  handler: async ({ tx, tenantId, auth, prepared }) => {
    if (
      !(await employmentIsCallers(
        tx,
        tenantId,
        prepared.employmentId,
        auth.context.tenantUserId
      ))
    ) {
      return fail(
        403,
        "ACCESS_DENIED",
        "The notice status is available only for your own employment."
      );
    }

    return ok(
      await readNoticeStatus(tx, tenantId, prepared.employmentId),
      {},
      { "cache-control": "no-store" }
    );
  }
});
