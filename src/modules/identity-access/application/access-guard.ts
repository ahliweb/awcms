import type { AstroCookies } from "astro";

import { fail } from "../../_shared/api-response";
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME
} from "../../../lib/auth/ssr-session";
import type {
  AccessRequest,
  BusinessScopeFact,
  TenantContext
} from "../domain/access-control";
import { evaluateAccess } from "../domain/access-control";
import type { BusinessScopeHierarchyPort } from "../../_shared/ports/business-scope-hierarchy-port";
import { resolveBusinessScopeFacts } from "./business-scope-facts";
import {
  fetchGrantedPermissionKeys,
  resolveModuleEnabled,
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
 *
 * `options.hierarchyPort` (Issue #180) is OPTIONAL and forwarded to the
 * business-scope layer: when the `guard` opts into a required-scope check
 * (`resourceAttributes.requiredScopeType`/`.requiredScopeId`) AND a hierarchy
 * port is supplied, this resolves the subject's `businessScopeFacts` and
 * passes them to `evaluateAccess` for exact/descendant/ancestor/tenant-wide
 * coverage. If the guard opts in but NO port is supplied, `evaluateAccess`
 * default-denies (empty fact set) — fail-closed. Every existing 5-argument
 * call site (none of which sets a required scope) is completely unaffected.
 * The base ships only a no-op hierarchy adapter; a derived application passes
 * its own real resolver here.
 */
export async function authorizeInTransaction(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date,
  guard: AccessRequest,
  options?: { hierarchyPort?: BusinessScopeHierarchyPort }
): Promise<AuthorizeResult> {
  const context = await resolveTenantContext(tx, tenantId, tokenHash, now);

  if (!context) {
    return {
      allowed: false,
      denied: fail(401, "AUTH_REQUIRED", "Session is invalid or expired.")
    };
  }

  // Disabling a module must block its endpoints server-side, not just hide
  // them from the navigation — checked here, before permissions are even
  // looked up, so a disabled module is refused no matter what the actor was
  // granted. `module_management` is `isCore` and cannot be disabled, so its
  // own lifecycle endpoints can never lock a tenant out of re-enabling.
  const moduleEnabled = await resolveModuleEnabled(
    tx,
    tenantId,
    guard.moduleKey
  );

  if (!moduleEnabled) {
    const decision = {
      allowed: false,
      reason: "Module is disabled for this tenant.",
      matchedPolicy: "module_disabled"
    };

    await recordDecisionLog(
      tx,
      tenantId,
      context.tenantUserId,
      guard,
      decision
    );

    return {
      allowed: false,
      denied: fail(403, "MODULE_DISABLED", decision.reason)
    };
  }

  const grantedPermissionKeys = await fetchGrantedPermissionKeys(
    tx,
    tenantId,
    context.tenantUserId
  );

  // Issue #180 — resolve the subject's business-scope facts only when the
  // guard opts into a required-scope check AND a hierarchy port is available.
  // A guard that opts in without a port available resolves to `undefined`
  // here, which `evaluateAccess` treats as an empty fact set -> default-deny
  // (fail-closed).
  let businessScopeFacts: readonly BusinessScopeFact[] | undefined;
  if (
    options?.hierarchyPort &&
    typeof guard.resourceAttributes?.requiredScopeType === "string" &&
    typeof guard.resourceAttributes?.requiredScopeId === "string"
  ) {
    businessScopeFacts = await resolveBusinessScopeFacts(
      tx,
      tenantId,
      context.tenantUserId,
      now,
      options.hierarchyPort
    );
  }

  const decision = evaluateAccess(
    context,
    guard,
    grantedPermissionKeys,
    businessScopeFacts
  );

  await recordDecisionLog(tx, tenantId, context.tenantUserId, guard, decision);

  if (!decision.allowed) {
    return {
      allowed: false,
      denied: fail(403, "ACCESS_DENIED", decision.reason)
    };
  }

  return { allowed: true, context, grantedPermissionKeys };
}
