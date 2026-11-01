/**
 * Shared plumbing for the `/api/v1/channel-accounts/*` route files (Issue #1140):
 * the deployment switch, body parsing, `Idempotency-Key` handling, and the
 * per-account access check. Kept here so the route files stay thin and cannot
 * drift into different spellings of the same refusal.
 */
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../_shared/idempotency";
import type { TenantRouteHandlerContext } from "../../_shared/tenant-route";
import { resolveChannelSecretsRing } from "../domain/channel-accounts-config";
import { resolveClientIp } from "../../../lib/security/rate-limit";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../lib/security/request-body-limit";
import { authorizeInTransaction } from "../../identity-access/application/access-guard";
import { officeScopeHierarchyPortAdapter } from "../../tenant-admin/application/office-scope-hierarchy-port-adapter";
import type { AccessRequest } from "../../identity-access/domain/access-control";
import {
  CHANNEL_ACCOUNTS_GUARDS,
  CHANNEL_ACCOUNTS_MODULE_KEY,
  isChannelAccountsEnabled,
  type ChannelAssignmentKind
} from "../domain/channel-accounts-constants";
import { isUuid, type Validated } from "../domain/channel-accounts-validation";
import {
  fetchAccountRecord,
  isAccountVisibleTo,
  listConnectionAccountBindings,
  type AccountRecord
} from "./account-directory";

/** The deployment switch. Checked AFTER authorization so an unauthorized caller learns nothing about it. */
export function disabledResponse(): Response | null {
  return isChannelAccountsEnabled()
    ? null
    : fail(
        503,
        "CHANNEL_ACCOUNTS_DISABLED",
        "Channel accounts are not enabled for this deployment."
      );
}

/**
 * After authorization, before any work: the deployment switch, and a refusal of
 * a machine credential. The control plane is operated by accountable people:
 * assignments, step-up and idempotency records are all filed per person, and the
 * authorised context does not carry a credential's own id.
 */
export function commonRefusal(auth: {
  context: { viaMachineCredential?: boolean };
}): Response | null {
  const disabled = disabledResponse();

  if (disabled) return disabled;

  if (auth.context.viaMachineCredential === true) {
    return fail(
      403,
      "INTERACTIVE_SESSION_REQUIRED",
      "This action needs a signed-in person; a machine credential cannot do it."
    );
  }

  return null;
}

/**
 * Fail closed BEFORE any work when a route would have to store a credential and
 * the key ring is not a valid ring: no plaintext fallback, no half-written grant.
 */
export function secretStoreUnavailable(): Response | null {
  return resolveChannelSecretsRing().ok
    ? null
    : fail(
        503,
        "SECRET_STORE_UNAVAILABLE",
        "Credentials cannot be stored on this deployment."
      );
}

export function readIdempotencyKey(request: Request): string | Response {
  const key = request.headers.get("idempotency-key");

  if (!key || key.length > 255) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required (at most 255 characters)."
    );
  }

  return key;
}

/** Parses + validates a JSON body, answering the right 4xx without touching the database. Error text never echoes the value. */
export async function readValidatedBody<T>(
  request: Request,
  validate: (raw: unknown) => Validated<T>
): Promise<T | Response> {
  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  if (bodyRead.malformed) {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const validation = validate(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Request is invalid.",
      {},
      validation.errors
    );
  }

  return validation.value;
}

/**
 * One audit row. `attributes` carries ids, fixed codes and counts ONLY: never a
 * credential, a token, a provider message or an external identifier, so the audit
 * log (read by more people than the screen) cannot become a second copy of them.
 * `recordAuditEvent` redacts defensively on top of this.
 */
export async function auditChannelAccounts(
  context: {
    tx: Bun.SQL;
    tenantId: string;
    auth: { context: { tenantUserId: string } };
    locals: { correlationId?: string };
  },
  input: {
    action: string;
    resourceType: string;
    resourceId: string | null;
    severity: "info" | "warning";
    message: string;
    attributes?: Record<string, unknown>;
  }
): Promise<void> {
  await recordAuditEvent(context.tx, {
    tenantId: context.tenantId,
    actorTenantUserId: context.auth.context.tenantUserId,
    moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    severity: input.severity,
    message: input.message,
    ...(input.attributes ? { attributes: input.attributes } : {}),
    ...(context.locals.correlationId
      ? { correlationId: context.locals.correlationId }
      : {})
  });
}

export function asUuid(value: string | undefined | null): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export function badId(field = "id"): Response {
  return fail(400, "VALIDATION_ERROR", `${field} must be a UUID.`);
}

/** One uniform answer for "no such account" and "not yours": an account id must not be enumerable (IDOR). */
export function accountNotFound(): Response {
  return fail(404, "RESOURCE_NOT_FOUND", "Channel account not found.");
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key, acting user)`:
 * same key + same request -> the STORED response; same key + different request
 * -> `409 IDEMPOTENCY_CONFLICT`; unseen key -> `produce()`, and a SUCCESS is
 * stored. Refusals are not stored: the caller fixes something and retries. The
 * stored response is built from the already-redacted view, so it can never
 * contain a credential.
 */
export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actorTenantUserId: string,
  requestPayload: unknown,
  produce: () => Promise<{ status: number; body: unknown } | Response>
): Promise<Response> {
  // The credential is part of `requestPayload` for the write endpoint; the hash
  // is a KEYED HMAC (`computeRequestHash`), so it is not recoverable from the table.
  const requestHash = computeRequestHash({
    actor: actorTenantUserId,
    request: requestPayload
  });
  const existing = await findIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    userIdempotencyActor(actorTenantUserId)
  );

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different request."
      );
    }

    return jsonResponse(existing.responseBody, {
      status: existing.responseStatus
    });
  }

  const produced = await produce();

  if (produced instanceof Response) return produced;

  const body = { success: true as const, data: produced.body, meta: {} };

  await saveIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    userIdempotencyActor(actorTenantUserId),
    requestHash,
    produced.status,
    body
  );

  return jsonResponse(body, { status: produced.status });
}

type AccountRouteContext = Pick<
  TenantRouteHandlerContext<unknown>,
  "tx" | "tenantId" | "tokenHash" | "auth" | "now" | "request" | "clientAddress"
>;

/** Whether the caller may see EVERY account regardless of assignments: holders of `assignments.manage`. */
export function canSeeAllAccounts(context: AccountRouteContext): boolean {
  const { moduleKey, activityCode, action } =
    CHANNEL_ACCOUNTS_GUARDS.manageAssignments;

  return context.auth.grantedPermissionKeys.has(
    `${moduleKey}.${activityCode}.${action}`
  );
}

/**
 * The scope resolver the business-scope check consults. Without a port the
 * chokepoint resolves NO facts and denies every scoped request, so a scoped
 * account would be unreachable by anyone; this is the composition root's wiring
 * (ADR-0011, ADR-0060), the same adapter the business-scope assignment API uses.
 */
const HIERARCHY_PORT = officeScopeHierarchyPortAdapter;

type ScopeRef = { type: string; id: string };
type AccountGuard = Pick<
  AccessRequest,
  "moduleKey" | "activityCode" | "action"
>;

/**
 * Whether the caller holds `scope`, re-evaluated through the SAME chokepoint
 * with the route's own guard, so a deny policy and the decision log both apply.
 */
export async function scopeCoveredFor(
  context: AccountRouteContext,
  guard: AccountGuard,
  scope: ScopeRef,
  resource: { type: string; id?: string } = { type: "channel_account" }
): Promise<boolean> {
  const decision = await authorizeInTransaction(
    context.tx,
    context.tenantId,
    context.tokenHash,
    context.now,
    {
      ...guard,
      resourceType: resource.type,
      ...(resource.id ? { resourceId: resource.id } : {}),
      resourceAttributes: {
        requiredScopeType: scope.type,
        requiredScopeId: scope.id
      }
    },
    {
      clientIp: resolveClientIp(context.request, context.clientAddress),
      hierarchyPort: HIERARCHY_PORT
    }
  );

  return decision.allowed;
}

/**
 * A caller whose access is CONFINED to business scopes (holds at least one
 * currently-effective, non-tenant-wide scope assignment). Such a caller must
 * name a scope they hold when creating an account: "no scope" means tenant-wide,
 * and a confined operator is not allowed to mint a tenant-wide account that
 * escapes the confinement they were given (ADR-0148 review M3).
 */
export async function callerIsScopeConfined(
  context: AccountRouteContext
): Promise<boolean> {
  const rows = (await context.tx`
    SELECT 1 FROM awcms_business_scope_assignments
    WHERE tenant_id = ${context.tenantId}
      AND tenant_user_id = ${context.auth.context.tenantUserId}
      AND status = 'active'
      AND scope_type <> 'tenant'
      AND effective_from <= ${context.now}
      AND (effective_to IS NULL OR effective_to > ${context.now})
    LIMIT 1
  `) as unknown[];

  return rows.length > 0;
}

/**
 * The business scope a CLIENT asks an account to carry is not a fact: it is
 * authorised as the required scope (the caller must hold it), and it must
 * resolve to a real scope of THIS tenant. Absent = tenant-wide, which a
 * scope-confined caller may not create. Returns the refusal, or null to go on.
 */
export async function authorizeRequestedScope(
  context: AccountRouteContext,
  guard: AccountGuard,
  scope: ScopeRef | null
): Promise<Response | null> {
  const denied = () => fail(403, "ACCESS_DENIED", "Access denied.");

  if (!scope) {
    return (await callerIsScopeConfined(context)) ? denied() : null;
  }

  if (!(await scopeCoveredFor(context, guard, scope))) return denied();

  const resolution = await HIERARCHY_PORT.resolveScope(
    context.tx,
    context.tenantId,
    scope.type,
    scope.id
  );

  return resolution.resolved
    ? null
    : fail(
        422,
        "SCOPE_UNRESOLVED",
        "The business scope does not exist in this tenant."
      );
}

/**
 * How many of each connection's accounts the caller may act on (assignment of at
 * least `minimumKind` AND the business scope), so a connection is never wider
 * than the accounts behind it: `revoke` needs ALL of them, a list needs ANY.
 * A connection with no accounts has no entry.
 */
export async function connectionAccountAccess(
  context: AccountRouteContext,
  guard: AccountGuard,
  minimumKind: ChannelAssignmentKind,
  filter: { connectionId: string | null; provider: string | null }
): Promise<Map<string, { accounts: number; allowed: number }>> {
  const bindings = await listConnectionAccountBindings(
    context.tx,
    context.tenantId,
    {
      tenantUserId: context.auth.context.tenantUserId,
      bypass: canSeeAllAccounts(context)
    },
    minimumKind,
    filter
  );
  const decided = new Map<string, boolean>();
  const result = new Map<string, { accounts: number; allowed: number }>();

  for (const binding of bindings) {
    let ok = binding.assignable;

    if (ok && binding.businessScope) {
      const key = `${binding.businessScope.type}:${binding.businessScope.id}`;
      let covered = decided.get(key);

      if (covered === undefined) {
        covered = await scopeCoveredFor(context, guard, binding.businessScope);
        decided.set(key, covered);
      }

      ok = covered;
    }

    const entry = result.get(binding.connectionId) ?? {
      accounts: 0,
      allowed: 0
    };

    entry.accounts += 1;
    if (ok) entry.allowed += 1;
    result.set(binding.connectionId, entry);
  }

  return result;
}

/**
 * Loads an account and applies the two PER-ACCOUNT gates that sit on top of the
 * route's tenant-wide permission (ADR-0148 I1, pack 2.1 `channel_account_assignment`):
 *
 *   1. assignments: an account with assignees is restricted to them (at least
 *      `minimumKind`), plus holders of `assignments.manage`;
 *   2. business scope (ABAC): an account bound to a business scope requires the
 *      caller to hold that scope, re-evaluated through the SAME chokepoint with
 *      the route's own guard, so a deny policy and the decision log both apply.
 *
 * Every failure is the uniform 404 (see {@link accountNotFound}).
 */
export async function loadAuthorizedAccount(
  context: AccountRouteContext,
  accountId: string,
  guard: AccountGuard,
  minimumKind: ChannelAssignmentKind = "viewer"
): Promise<{ account: AccountRecord } | { denied: Response }> {
  const account = await fetchAccountRecord(
    context.tx,
    context.tenantId,
    accountId
  );

  if (!account) return { denied: accountNotFound() };

  const visible = await isAccountVisibleTo(
    context.tx,
    context.tenantId,
    accountId,
    context.auth.context.tenantUserId,
    canSeeAllAccounts(context),
    minimumKind
  );

  if (!visible) return { denied: accountNotFound() };

  if (
    account.businessScope &&
    !(await scopeCoveredFor(context, guard, account.businessScope, {
      type: "channel_account",
      id: accountId
    }))
  ) {
    return { denied: accountNotFound() };
  }

  return { account };
}

export { CHANNEL_ACCOUNTS_GUARDS, CHANNEL_ACCOUNTS_MODULE_KEY };
