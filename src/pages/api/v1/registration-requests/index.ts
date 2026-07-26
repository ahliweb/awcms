import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { listPendingRegistrations } from "../../../../modules/identity-access/application/self-registration";

/**
 * `GET /api/v1/registration-requests` (Wave 2 delta auth) — the pending
 * self-registration queue for the caller's tenant, oldest first.
 *
 * Identifiers come back MASKED. A reviewer decides on a display name and a
 * domain, not on a full address, and this list is the one place a whole
 * tenant's applicant addresses would otherwise be exposed in one response.
 *
 * `workClass: "interactive"` — an admin-screen read whose only work beyond the
 * guard chain is one bounded, indexed query.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "identity_access",
    activityCode: "registration_requests",
    action: "read"
  },
  handler: async ({ tx, tenantId }) =>
    ok({ items: await listPendingRegistrations(tx, tenantId) })
});
