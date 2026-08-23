/**
 * The one credential check that runs before an API request body is parsed.
 *
 * Called from `src/middleware.ts` for every body-carrying request to a path
 * that `api-body-auth-boundary.ts` does not declare session-free. See that file
 * for what was wrong and why the boundary is here rather than in 77 routes.
 *
 * ## Authentication ONLY
 *
 * This answers "is the caller anyone at all", never "may they do this".
 * Authorization stays at `authorizeInTransaction` (ADR-0063) and is not
 * duplicated: a second place deciding what a caller may DO is the drift this
 * repo keeps paying for. A caller who passes here still faces the full
 * chokepoint inside the route, in the route's own transaction, against one
 * snapshot — unchanged.
 *
 * That also means the session is looked up TWICE for a mutating request: once
 * here, once inside the route's transaction. That is deliberate, not an
 * oversight. Handing the route a principal resolved in a different transaction
 * would split the decision from the read it guards, which is the exact hazard
 * `loadAdminScreen` documents. One extra indexed lookup on write requests only
 * — reads carry no body and never reach here — is the price of not doing that.
 *
 * ## Both credential kinds, because both reach ordinary routes
 *
 * A machine credential (ADR-0049 §4) authenticates any `defineTenantRoute`, not
 * just its own route, so checking sessions alone would have refused every
 * machine client. `isMachineCredentialHash` picks the branch, exactly as
 * `authorizeInTransaction` does.
 */
import type { AstroCookies } from "astro";

import { getDatabaseClient } from "../database/client";
import { withTenant } from "../database/tenant-context";
import { hashSessionToken } from "./session-token";
import { isMachineCredentialHash } from "./machine-credential-token";
import { fail } from "../../modules/_shared/api-response";
import { resolveAuthInputs } from "../../modules/identity-access/application/access-guard";
import { resolveActiveSession } from "../../modules/identity-access/application/session-lookup";
import { resolveActiveMachineCredential } from "../../modules/identity-access/application/machine-credential-lookup";

function tenantRequired(): Response {
  return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
}

function authRequired(): Response {
  return fail(401, "AUTH_REQUIRED", "Authentication required.");
}

/**
 * `null` when the caller holds a live credential — the request continues to its
 * route untouched. A `Response` is the refusal to return instead, and no body
 * has been read at that point.
 */
export async function refuseUnauthenticatedApiBody(
  request: Request,
  cookies: AstroCookies,
  now: Date
): Promise<Response | null> {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) return tenantRequired();
  if (!token) return authRequired();

  const tokenHash = hashSessionToken(token);
  const sql = getDatabaseClient();

  // `withTenant<Response | null>` — pinned, and the pin is load-bearing. This
  // repo's `withTenant` returns its own 503 `DATABASE_BUSY` Response on
  // breaker-open, cast to `T`. Under `withTenant<boolean>` that Response would
  // arrive as a truthy value and be read as "authenticated" — a database
  // outage would have opened the boundary. With `Response | null` the 503 is
  // simply the refusal returned to the caller, which is the honest answer.
  const outcome = await withTenant<Response | null>(
    sql,
    tenantId,
    async (tx) => {
      const authenticated = isMachineCredentialHash(tokenHash)
        ? await resolveActiveMachineCredential(tx, tenantId, tokenHash, now)
        : await resolveActiveSession(tx, tenantId, tokenHash, now);

      return authenticated ? null : authRequired();
    },
    { workClass: "interactive" }
  );

  return outcome;
}
