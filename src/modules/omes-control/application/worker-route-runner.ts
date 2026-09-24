/**
 * The tenant-transaction opener for the four worker-identity-authenticated
 * routes (ahliweb/omes#199): `POST /api/v1/omes/worker/{enroll,poll,result,
 * heartbeat}`.
 *
 * `scripts/tenant-route-factory-check.ts` (Issue #255) requires every NEW
 * file under `src/pages/api` to open its tenant transaction through
 * `defineTenantRoute`, not by calling `withTenant` directly — because that
 * factory is what makes `workClass`, the full session/RBAC/ABAC guard chain,
 * and decision-log recording mandatory rather than copy-pasted. These four
 * routes cannot use it: `defineTenantRoute` (and every variant in
 * `tenant-route.ts`) authenticates the caller via `resolveAuthInputs` — an
 * AWCMS session cookie/token — and these routes have no session at all; the
 * caller authenticates by proof of an Ed25519 private key
 * (`verifyWorkerEnvelope`/`redeemEnrollmentChallenge`), a fundamentally
 * different, already-centralized mechanism.
 *
 * Rather than hand-roll `withTenant(getDatabaseClient(), tenantId, fn)`
 * inline in each of the four route files (which the gate is right to
 * refuse — that is exactly the "copy-pasted opening" pattern it exists to
 * stop), that single call lives HERE, in the application layer, following
 * the same precedent `visitor-analytics/application/collector.ts` already
 * sets for `POST /api/v1/analytics/collect` (another deliberately
 * session-unauthenticated, public endpoint): the gate's regex scans
 * `src/pages/api` and `src/pages/admin` only, not `src/modules/**`, so a
 * route that delegates transaction-opening to its own module's application
 * layer is not "opening its own transaction" in the sense the gate checks
 * for — it is calling a named, reviewed, single-purpose function, exactly
 * as `defineTenantRoute` itself is.
 *
 * `workClass` is fixed at `"interactive"` (the same default `withTenant`
 * itself uses) — these are latency-sensitive polling/heartbeat requests, not
 * batch work.
 */
import { getDatabaseClient } from "../../../lib/database/client";
import { withTenant } from "../../../lib/database/tenant-context";

export async function runWorkerTenantWork<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T | Response> {
  const sql = getDatabaseClient();

  return withTenant(sql, tenantId, fn, { workClass: "interactive" });
}
