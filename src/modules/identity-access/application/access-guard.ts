import type { AstroCookies } from "astro";

import { fail } from "../../_shared/api-response";
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME
} from "../../../lib/auth/ssr-session";
import type { AccessRequest, TenantContext } from "../domain/access-control";
import { evaluateAccess } from "../domain/access-control";
import {
  fetchGrantedPermissionKeys,
  resolveTenantContext
} from "./auth-context";
import { recordDecisionLog } from "./decision-log";
import { extractBearerToken } from "./session-lookup";

/**
 * Resolves the tenant id + session token an endpoint should authenticate
 * with, accepting EITHER the bearer/tenant headers (API clients) OR the
 * httpOnly SSR cookies (the admin UI). Headers take priority; cookies are
 * the fallback.
 */
export function resolveAuthInputs(
  request: Request,
  cookies: AstroCookies
): { tenantId: string | null; token: string | null } {
  const tenantId =
    request.headers.get("x-awcms-tenant-id") ??
    cookies.get(TENANT_COOKIE_NAME)?.value ??
    null;
  const token =
    extractBearerToken(request.headers.get("authorization")) ??
    cookies.get(SESSION_COOKIE_NAME)?.value ??
    null;

  return { tenantId, token };
}

export type AuthorizeResult =
  | {
      allowed: true;
      context: TenantContext;
      grantedPermissionKeys: Set<string>;
    }
  | { allowed: false; denied: Response };

/**
 * Runs the full guard chain inside an existing tenant transaction: resolve
 * session -> fetch granted permission keys -> evaluate ABAC (default deny,
 * deny overrides allow) -> record the decision log. Returns the authorized
 * context on allow, or a ready-to-return `fail()` Response (401/403) on
 * deny. Every guarded endpoint should call this instead of inlining the
 * chain itself.
 */
export async function authorizeInTransaction(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date,
  guard: AccessRequest
): Promise<AuthorizeResult> {
  const context = await resolveTenantContext(tx, tenantId, tokenHash, now);

  if (!context) {
    return {
      allowed: false,
      denied: fail(401, "AUTH_REQUIRED", "Session is invalid or expired.")
    };
  }

  const grantedPermissionKeys = await fetchGrantedPermissionKeys(
    tx,
    tenantId,
    context.tenantUserId
  );
  const decision = evaluateAccess(context, guard, grantedPermissionKeys);

  await recordDecisionLog(tx, tenantId, context.tenantUserId, guard, decision);

  if (!decision.allowed) {
    return {
      allowed: false,
      denied: fail(403, "ACCESS_DENIED", decision.reason)
    };
  }

  return { allowed: true, context, grantedPermissionKeys };
}
