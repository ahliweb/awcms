import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { listManagedTenants } from "../../../../../modules/identity-access/application/partner-engagement-store";

/**
 * `GET /api/v1/partner/tenants` — ADR-0089, Gelombang 8 PR 8.4 of #423.
 *
 * The partner's own view of its book: which tenants have engaged it.
 *
 * ## Why this needs a `SECURITY DEFINER` function at all
 *
 * `awcms_partner_managed_tenants` rows belong to the TARGET tenant (ADR-0089),
 * so a partner reading its own book is reading other tenants' rows — zero rows
 * under FORCE RLS, forever. The asymmetry is deliberate: the customer's view is
 * the authoritative one, and the partner's is a convenience.
 *
 * `sql/119` provides that convenience through the four-part `sql/048` pattern,
 * and this route is its only caller.
 *
 * ## The parameter comes from the CONTEXT, never from the request
 *
 * `tenantId` here is the acting tenant — resolved by the guard chain from the
 * session, not read from a query string. That is the whole safety of the
 * function: a caller cannot ask for somebody else's book, because the caller
 * never gets to name whose book it is.
 *
 * ## Guarded by `partner_access.read`
 *
 * The same permission the customer side uses, held in the PARTNER's own tenant.
 * The plan for this wave said the surface must be authorized by the engagement
 * table AND an active grant — never by a permission alone. That is true of the
 * surfaces that ACT inside a customer's tenant, and none exist: acting there
 * happens through the delegated membership, under the customer's own chokepoint,
 * with `principal_kind = 'delegated'` narrowing it (ADR-0090). This endpoint
 * touches no customer data — it lists the partner's own engagements — so there
 * is no second condition for it to carry.
 */
const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "partner_access",
  action: "read"
} as const;

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: READ_GUARD,
  handler: async ({ tx, tenantId }) =>
    ok({ managedTenants: await listManagedTenants(tx, tenantId) })
});
