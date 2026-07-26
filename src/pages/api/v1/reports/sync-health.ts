import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { fetchSyncHealthReport } from "../../../../modules/reporting/application/sync-health-report";

/**
 * Migrated to `defineTenantRoute` (Issue #255).
 *
 * This route used to hand-roll the guard chain: `resolveTenantContext` ->
 * `fetchGrantedPermissionKeys` -> `evaluateAccess(context, GUARD, keys)` ->
 * `recordDecisionLog`. Three arguments where `evaluateAccess` takes five, and
 * two links of the real chain simply absent:
 *
 *   1. no `resolveModuleEnabled` — a tenant that disabled `reporting` was
 *      still served this endpoint;
 *   2. no `loadActivePolicies` — a dynamic ABAC `deny` authored through
 *      `/api/v1/access/policies` was silently inert here.
 *
 * Both now come from `authorizeInTransaction`, which the factory calls for
 * every route. BEHAVIOUR CHANGES, deliberately: this returns
 * `403 MODULE_DISABLED` when `reporting` is off for the tenant, and honours
 * ABAC policy. It also accepts a session cookie as well as a bearer token,
 * because `resolveAuthInputs` reads both — the same sessions, resolved the
 * same way, no longer rejected purely by where the caller put them.
 */
export const GET = defineTenantRoute({
  // Unchanged from the hand-written version's `{ workClass: "reporting" }` —
  // aggregate reads must not compete with interactive traffic for pool slots.
  workClass: "reporting",
  authorize: {
    moduleKey: "reporting",
    activityCode: "dashboard",
    action: "read"
  },
  handler: async ({ tx, tenantId }) =>
    ok(await fetchSyncHealthReport(tx, tenantId))
});
