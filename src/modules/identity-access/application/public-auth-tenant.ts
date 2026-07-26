/**
 * Tenant-transaction opening for the UNAUTHENTICATED auth surfaces
 * (`POST /api/v1/auth/password/forgot`, `POST /api/v1/auth/password/reset`).
 *
 * ## Why not `defineTenantRoute`
 *
 * `_shared/tenant-route.ts` is the mandated opening for new API routes, and it
 * is the right one for every route that has a caller to authorize: it requires
 * a session token (`401 AUTH_REQUIRED`) and runs the full guard chain before
 * the handler. Password recovery has no session by definition — the whole point
 * is that the user cannot sign in — so there is nothing to authorize and the
 * factory cannot be used.
 *
 * The alternative would be calling `withTenant` inline in each route file,
 * which `bun run api:tenant-route:check` rejects for new routes (the allowlist
 * only shrinks). So the opening lives here, named, once, with the same
 * precedent the other public surfaces already set — `comments`'
 * `withCommentsTenant`, `site_search`'s `withSiteSearchTenant`,
 * `seo_distribution`'s `withSeoPublicTenant`. This is the fourth instance of
 * that shape, not a new one invented to route around a gate.
 *
 * ## What it does NOT do, deliberately
 *
 * It does not resolve the tenant from the request host. Those three public
 * surfaces are content surfaces reached by a visitor browsing a tenant's own
 * domain; this one is reached from a link in an email and continues into
 * `/login`, which resolves the tenant from `X-AWCMS-Tenant-ID` plus its own
 * tenant picker. Recovery has to land the user in exactly the tenant they will
 * then sign in to, so it follows login's resolution, not the content surfaces'.
 *
 * It also performs no module-enablement check. `identity_access` is a
 * non-disableable core module (`isCore: true`), so there is no "disabled for
 * this tenant" state for a gate to read — unlike `comments`, where the check is
 * load-bearing.
 *
 * `workClass` is REQUIRED and has no default here, for the same reason
 * `defineTenantRoute` makes it a compile error to omit: an implicit
 * `"interactive"` is a decision nobody wrote down. Callers pass the literal in
 * the ROUTE file so `bun run db:work-class:generate` records it as `explicit`
 * rather than reporting the route as an unexamined default.
 */
import { withTenant } from "../../../lib/database/tenant-context";
import type { WorkClass } from "../../../lib/database/work-class";

export type PublicAuthTenantOptions = {
  workClass: WorkClass;
  /** Forwarded verbatim to `withTenant` (which defaults to its own 2000ms). */
  queueTimeoutMs?: number;
};

/**
 * Opens a tenant-scoped transaction for a public auth route and runs `handler`.
 *
 * Returns whatever `handler` returns — EXCEPT when the database circuit breaker
 * is open or a work-class slot cannot be acquired, in which case `withTenant`
 * returns its own `503 DATABASE_BUSY` `Response` cast to `T` (see its header).
 * Pinning `T = Response` at the call site is what makes that safe, and every
 * caller of this helper is an `APIRoute` returning exactly that.
 */
export function withPublicAuthTenant(
  sql: Bun.SQL,
  tenantId: string,
  options: PublicAuthTenantOptions,
  handler: (tx: Bun.TransactionSQL) => Promise<Response>
): Promise<Response> {
  return withTenant<Response>(sql, tenantId, handler, {
    workClass: options.workClass,
    queueTimeoutMs: options.queueTimeoutMs
  });
}
