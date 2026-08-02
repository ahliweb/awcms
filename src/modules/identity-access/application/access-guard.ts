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
import {
  evaluateAccess,
  isHighRiskAction,
  permissionKey
} from "../domain/access-control";
import { isPlatformScopedPermissionKey } from "../domain/platform-scope";
import { resolvePlatformTenant } from "../../../lib/tenant/platform-tenant";
import type { BusinessScopeHierarchyPort } from "../../_shared/ports/business-scope-hierarchy-port";
import type { SoDRuleDescriptor } from "../../_shared/module-contract";
import { resolveBusinessScopeFacts } from "./business-scope-facts";
import { checkHighRiskSoDConflicts } from "./high-risk-sod-guard";
import {
  fetchGrantedPermissionKeys,
  resolveModuleEnabled,
  resolveTenantContext,
  resolveTenantContextForTenantUser
} from "./auth-context";
import { recordDecisionLog } from "./decision-log";
import { loadActivePolicies } from "./policy-cache";
import { extractBearerToken } from "./session-lookup";
import { resolveActiveMachineCredential } from "./machine-credential-lookup";
import {
  isMachineCredentialAllowedAction,
  narrowPermissionKeys
} from "../domain/machine-credential";
import {
  isMachineCredentialHash,
  isMachineCredentialToken,
  parseMachineCredentialToken
} from "../../../lib/auth/machine-credential-token";

/**
 * Resolves the tenant id + bearer token an endpoint should authenticate with,
 * accepting EITHER the bearer/tenant headers (API clients) OR the httpOnly SSR
 * cookies (the admin UI). Headers take priority; cookies are the fallback.
 *
 * ## Machine credentials carry their own tenant (ADR-0049 §4)
 *
 * A machine credential token embeds the tenant it belongs to, so a caller that
 * presents one needs no tenant header at all — the single-env-var build client
 * ADR-0047 found impossible. When such a token is present, the TOKEN wins and
 * any tenant header is ignored: the header is unauthenticated input, and the
 * credential is only ever valid for its own tenant, so ignoring it cannot raise
 * any privilege. A malformed machine token resolves to a null tenant and is
 * refused — never silently retried as a session token.
 *
 * The canonical header for human sessions stays `x-awcms-tenant-id`. No alias
 * is accepted: every future route would have to honour every spelling, and an
 * alias missed in one route is a confusing 400 rather than an obvious failure.
 */
export function resolveAuthInputs(
  request: Request,
  cookies: AstroCookies
): { tenantId: string | null; token: string | null } {
  const token =
    extractBearerToken(request.headers.get("authorization")) ??
    cookies.get(SESSION_COOKIE_NAME)?.value ??
    null;

  if (token !== null && isMachineCredentialToken(token)) {
    return {
      tenantId: parseMachineCredentialToken(token)?.tenantId ?? null,
      token
    };
  }

  const tenantId =
    request.headers.get("x-awcms-tenant-id") ??
    cookies.get(TENANT_COOKIE_NAME)?.value ??
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
 *
 * `options.sodRules` (Issue #181) is OPTIONAL — segregation-of-duties conflict
 * enforcement for HIGH-RISK actions runs at this chokepoint (deny-overrides-
 * allow, ACTION-TIME) using the composed registry's rules by default. Every
 * pre-existing call site is unaffected: the base registry declares no SoD
 * rules, so the guard short-circuits at zero cost. A test/composition root may
 * inject a rule set here to exercise enforcement.
 */
export async function authorizeInTransaction(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date,
  guard: AccessRequest,
  options?: {
    hierarchyPort?: BusinessScopeHierarchyPort;
    sodRules?: readonly SoDRuleDescriptor[];
  }
): Promise<AuthorizeResult> {
  // ADR-0049 — the bearer's KIND is carried by the hash namespace, so exactly
  // one table is consulted and neither kind is ever searched in the other's.
  // Everything after this block is identical for both: a machine credential
  // AUTHENTICATES, it never AUTHORIZES.
  const machine = isMachineCredentialHash(tokenHash)
    ? await resolveActiveMachineCredential(tx, tenantId, tokenHash, now)
    : null;

  const context = machine
    ? await resolveTenantContextForTenantUser(
        tx,
        tenantId,
        machine.tenantUserId
      )
    : await resolveTenantContext(tx, tenantId, tokenHash, now);

  if (!context) {
    // One shape for every failure — unknown, expired, revoked, and "machine
    // credential whose service account no longer exists" are indistinguishable.
    return {
      allowed: false,
      denied: fail(401, "AUTH_REQUIRED", "Session is invalid or expired.")
    };
  }

  // READ-ONLY, decided before any permission is looked up and independent of
  // what the service account holds (ADR-0049 §3). A leaked build token cannot
  // mutate anything even if it was pointed at an `owner`.
  if (machine && !isMachineCredentialAllowedAction(guard.action)) {
    const decision = {
      allowed: false,
      reason: "Machine credentials may only perform read-only actions.",
      matchedPolicy: "machine_credential_readonly"
    };

    await recordDecisionLog(
      tx,
      tenantId,
      context.tenantUserId,
      guard,
      decision,
      machine.id
    );

    return {
      allowed: false,
      denied: fail(403, "ACCESS_DENIED", decision.reason)
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
      decision,
      machine?.id
    );

    return {
      allowed: false,
      denied: fail(403, "MODULE_DISABLED", decision.reason)
    };
  }

  // ADR-0053 — a PLATFORM-scoped permission may only be exercised by the
  // platform tenant. Decided BEFORE permissions are looked up, like the
  // machine-credential read-only refusal above, so the answer cannot depend on
  // what the caller happens to hold: a grant row that reached the wrong tenant
  // (a restored backup, a hand-written INSERT, a future provisioning path that
  // forgets `WHERE scope = 'tenant'`) is inert rather than sufficient.
  //
  // Fail-closed twice over: an unresolvable platform tenant — no setup state, a
  // `PLATFORM_TENANT_ID` naming a tenant that is absent or inactive — denies.
  // "Nobody is the platform" must never read as "everybody is".
  if (
    isPlatformScopedPermissionKey(
      permissionKey(guard.moduleKey, guard.activityCode, guard.action)
    )
  ) {
    const platformTenant = await resolvePlatformTenant(tx);

    if (!platformTenant || platformTenant.tenantId !== tenantId) {
      const decision = {
        allowed: false,
        reason: "This action may only be performed by the platform tenant.",
        matchedPolicy: "platform_scope_required"
      };

      await recordDecisionLog(
        tx,
        tenantId,
        context.tenantUserId,
        guard,
        decision,
        machine?.id
      );

      return {
        allowed: false,
        denied: fail(403, "ACCESS_DENIED", decision.reason)
      };
    }
  }

  const accountPermissionKeys = await fetchGrantedPermissionKeys(
    tx,
    tenantId,
    context.tenantUserId
  );

  // ADR-0049 §2 — a credential NARROWS, it can never widen. The effective set
  // is the intersection with the credential's allow-list, so adding a role to
  // the service account leaves already-issued credentials exactly where they
  // were, and an allow-list naming a permission nobody holds grants nothing.
  const grantedPermissionKeys = machine
    ? narrowPermissionKeys(accountPermissionKeys, machine.allowedPermissionKeys)
    : accountPermissionKeys;

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

  // Issue #179 — load the tenant's active, compiled ABAC policies (tenant-keyed
  // cache, deterministically invalidated on any policy mutation) and evaluate
  // them at this single chokepoint, AFTER session/tenant/module-enabled/RBAC
  // resolution. An empty policy set (the default for every tenant that has
  // authored none) makes ABAC a no-op — behavior is unchanged. `ipTrusted`
  // defaults to false (fail-closed) until a deployment wires a trusted-network
  // resolver; `env.now` is the request timestamp already threaded through here.
  const policies = await loadActivePolicies(tx, tenantId);
  const decision = evaluateAccess(
    context,
    guard,
    grantedPermissionKeys,
    businessScopeFacts,
    { policies, env: { now, ipTrusted: false } }
  );

  await recordDecisionLog(
    tx,
    tenantId,
    context.tenantUserId,
    guard,
    decision,
    machine?.id
  );

  if (!decision.allowed) {
    return {
      allowed: false,
      denied: fail(403, "ACCESS_DENIED", decision.reason)
    };
  }

  // Issue #181 — segregation-of-duties conflict enforcement, additive to the
  // ordinary ABAC decision above (deny-overrides-allow: this can only turn an
  // already-`allowed` HIGH-RISK decision into a deny, never the reverse). This
  // is ACTION-TIME enforcement — a subject holding both halves of a registered
  // conflict is denied at execution, not only at assignment. See
  // `high-risk-sod-guard.ts`'s header (it reasons about permissions held via
  // BOTH the business-scope-assignment path AND ordinary RBAC role grants, and
  // short-circuits at zero cost when no rule references the requested key).
  if (isHighRiskAction(guard.action)) {
    const sodCheck = await checkHighRiskSoDConflicts(
      tx,
      tenantId,
      context,
      guard,
      now,
      { hierarchyPort: options?.hierarchyPort, rules: options?.sodRules }
    );

    if (sodCheck.blocked) {
      return {
        allowed: false,
        denied: fail(403, "SOD_CONFLICT", sodCheck.reason)
      };
    }
  }

  return { allowed: true, context, grantedPermissionKeys };
}

/**
 * Secondary FIELD-level access check, reusing a context already authorized by
 * `authorizeInTransaction`.
 *
 * The primary guard decides whether a caller may reach an endpoint at all; some
 * endpoints then expose extra DE-ANONYMIZING fields behind a SEPARATE permission
 * (e.g. `visitor_analytics.raw_detail.read`). Gating those on
 * `grantedPermissionKeys.has(fieldKey)` alone checks only RBAC membership and
 * silently ignores the ABAC layer — so a `deny` DSL policy on the field key would
 * NOT be honored (deny-overrides-allow bypassed for the field). This routes the
 * field decision through the SAME `evaluateAccess` used for the primary action,
 * so RBAC grant AND no applicable ABAC deny are both required. Returns a plain
 * boolean (never a Response): a denied field is omitted from the response, not an
 * endpoint-level 403.
 *
 * Reuses the caller's already-resolved `context`/`grantedPermissionKeys` and the
 * tenant's active policies (tenant-keyed cache — no extra session/permission
 * round-trips). It deliberately records NO decision log: this is a projection
 * refinement of an already-logged allowed decision, not a separate
 * resource-access decision. `fieldGuard.action` must be a read-only action (this
 * never runs the high-risk SoD chokepoint).
 */
export async function evaluateFieldAccessInTransaction(
  tx: Bun.SQL,
  tenantId: string,
  context: TenantContext,
  grantedPermissionKeys: ReadonlySet<string>,
  fieldGuard: AccessRequest,
  now: Date
): Promise<boolean> {
  const policies = await loadActivePolicies(tx, tenantId);
  const decision = evaluateAccess(
    context,
    fieldGuard,
    grantedPermissionKeys,
    undefined,
    { policies, env: { now, ipTrusted: false } }
  );

  return decision.allowed;
}
