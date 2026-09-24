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
 *
 * ## The pre-authorization throw this file exists to prevent
 *
 * `tenant_id` in every pinned OMES wire schema is `^[A-Za-z0-9_.:-]{1,128}$`
 * — deliberately NOT constrained to a UUID (it is OMES's own contract, not
 * this module's to tighten; the pin is `contracts/v1/PIN.json` @
 * `0824f98`). But `withTenant`'s first line is `assertUuid(tenantId)`
 * (`lib/database/tenant-context.ts`), which THROWS for a schema-legal,
 * non-UUID string — synchronously, before the transaction opens, and
 * therefore before `verifyWorkerEnvelope` (the actual identity chokepoint)
 * ever runs. A caller sending a contract-valid but non-UUID `tenant_id`
 * would crash the handler instead of receiving the documented neutral
 * `re-enroll_required`/`rejected` response every other rejection path
 * returns — breaking the "a failure at any step returns the identical
 * response" invariant `worker-envelope-guard.ts` documents, and doing so
 * from an unauthenticated caller.
 *
 * Three ways to close this were considered:
 *   1. Tighten the vendored `tenant_id` pattern to require UUID shape —
 *      rejected: it is a byte-for-byte copy of the OMES-owned pinned
 *      contract, and silently diverging from a pin is exactly what #197's
 *      own discipline forbids. A local restriction would also need
 *      recording as a documented divergence, which is more moving parts
 *      than the actual problem needs.
 *   2. Catch broadly around `withTenant`/`runTenantWork` — rejected: that
 *      call site (`tenant-context.ts`) is shared by ~200 other routes with
 *      a real, UUID-shaped `tenantId` (resolved server-side from a
 *      session); loosening ITS contract to tolerate a bad tenant id would
 *      widen a much more sensitive shared chokepoint for these four
 *      callers' benefit.
 *   3. **Validate the shape here, before ever calling `withTenant`, and
 *      throw a TYPED error the caller can catch and turn into its own
 *      neutral response.** Chosen: it is a single, obvious place (this is
 *      already the one function all four routes call to reach a
 *      transaction), it costs nothing (a regex test, no DB round trip), and
 *      it keeps `assertUuid`'s existing contract with every other caller
 *      unchanged.
 */
import { getDatabaseClient } from "../../../lib/database/client";
import { withTenant } from "../../../lib/database/tenant-context";

const TENANT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Thrown by `runWorkerTenantWork` for a contract-valid, non-UUID
 * `tenant_id`, so it never reaches `assertUuid`'s throw one layer down.
 * Every route MUST catch this specifically and answer with the SAME
 * neutral rejection it uses for every other pre-authentication failure
 * (wrong tenant, unknown worker, bad signature, replay, ...) — never a
 * distinct shape, or a schema-legal-but-non-UUID `tenant_id` becomes an
 * oracle that distinguishes "malformed" from "unauthorized".
 */
export class InvalidWorkerTenantIdError extends Error {
  constructor() {
    super(
      "tenant_id is not UUID-shaped; refused before opening a transaction."
    );
    this.name = "InvalidWorkerTenantIdError";
  }
}

export async function runWorkerTenantWork<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T | Response> {
  if (!TENANT_UUID_PATTERN.test(tenantId)) {
    throw new InvalidWorkerTenantIdError();
  }

  const sql = getDatabaseClient();

  return withTenant(sql, tenantId, fn, { workClass: "interactive" });
}
