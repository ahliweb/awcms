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
  guard: Pick<AccessRequest, "moduleKey" | "activityCode" | "action">,
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

  if (account.businessScope) {
    const scoped = await authorizeInTransaction(
      context.tx,
      context.tenantId,
      context.tokenHash,
      context.now,
      {
        ...guard,
        resourceType: "channel_account",
        resourceId: accountId,
        resourceAttributes: {
          requiredScopeType: account.businessScope.type,
          requiredScopeId: account.businessScope.id
        }
      },
      {
        clientIp: resolveClientIp(context.request, context.clientAddress)
      }
    );

    if (!scoped.allowed) return { denied: accountNotFound() };
  }

  return { account };
}

export { CHANNEL_ACCOUNTS_GUARDS, CHANNEL_ACCOUNTS_MODULE_KEY };
