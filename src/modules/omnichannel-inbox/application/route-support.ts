/**
 * Shared plumbing for the `/api/v1/omnichannel-inbox/*` route files (Issue
 * #1164): the off-switch, body parsing, `Idempotency-Key`, the audit helper,
 * VISIBILITY, and the uniform refusals, so the route files stay thin and cannot
 * drift into different spellings of the same answer.
 */
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../lib/security/request-body-limit";
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../_shared/idempotency";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { isOmnichannelInboxEnabled } from "../domain/inbox-config";
import { OMNICHANNEL_INBOX_MODULE_KEY } from "../domain/inbox-constants";
import { isUuid, type Validated } from "../domain/inbox-validation";
import {
  loadInboxScopeAccess,
  type InboxAccessContext,
  type InboxGuard
} from "../infrastructure/channel-accounts-access";
import {
  scopeKey,
  type ConversationVisibility
} from "./conversation-directory";

/** Off means "not here": `404` before any database work. */
export function disabledResponse(): Response | null {
  return isOmnichannelInboxEnabled()
    ? null
    : fail(404, "NOT_FOUND", "Not found.");
}

/** Idempotency records and audit rows are filed per PERSON. */
export function personOnlyRefusal(auth: {
  context: { viaMachineCredential?: boolean };
}): Response | null {
  return auth.context.viaMachineCredential === true
    ? fail(
        403,
        "INTERACTIVE_SESSION_REQUIRED",
        "This action needs a signed-in person; a machine credential cannot do it."
      )
    : null;
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

export async function readValidatedBody<T>(
  request: Request,
  validate: (raw: unknown) => Validated<T>
): Promise<T | Response> {
  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  if (bodyRead.malformed) {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const validation = validate(bodyRead.value ?? {});

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

export function asUuid(value: string | undefined | null): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export function badId(field = "id"): Response {
  return fail(400, "VALIDATION_ERROR", `${field} must be a UUID.`);
}

/** One answer for unknown, foreign and invisible (no IDOR oracle). */
export function notFound(what: string): Response {
  return fail(404, "RESOURCE_NOT_FOUND", `${what} not found.`);
}

export function versionConflict(currentVersion: number): Response {
  return fail(
    409,
    "VERSION_CONFLICT",
    "The conversation changed since it was read; reload it and try again.",
    {},
    { currentVersion }
  );
}

export function customerUnreachable(): Response {
  return fail(
    409,
    "CUSTOMER_UNREACHABLE",
    "The customer opted out or withdrew; nothing can be answered or reopened."
  );
}

/**
 * What the caller may see (ADR-0160 section 3), decided by `channel_accounts`'
 * rules through the chokepoint. A failed load of those rules shows NOTHING
 * (an empty scope list), never everything.
 */
export async function visibilityFor(
  context: InboxAccessContext,
  guard: InboxGuard
): Promise<ConversationVisibility> {
  const access = await loadInboxScopeAccess();

  if (!access) return { unconfined: false, scopeKeys: [] };

  if (!(await access.isConfined(context))) return { unconfined: true };

  const covered = await access.coveredScopes(context, guard);

  return { unconfined: false, scopeKeys: covered.map(scopeKey) };
}

/** The caller may name this scope for a policy (or tenant-wide, when not confined). */
export async function authorizePolicyScope(
  context: InboxAccessContext,
  guard: InboxGuard,
  scope: { type: string; id: string } | null
): Promise<Response | null> {
  const access = await loadInboxScopeAccess();

  if (!access) return fail(403, "ACCESS_DENIED", "Access denied.");

  return access.authorizeScope(context, guard, scope);
}

export async function auditInbox(
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
    moduleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    severity: input.severity,
    message: input.message,
    // Ids, closed codes and counts ONLY: never a customer identifier or text.
    ...(input.attributes ? { attributes: input.attributes } : {}),
    ...(context.locals.correlationId
      ? { correlationId: context.locals.correlationId }
      : {})
  });
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key, acting person)`:
 * same key + same request -> the STORED response; same key + different request
 * -> `409 IDEMPOTENCY_CONFLICT`; unseen key -> `produce()`. Refusals are not
 * stored.
 */
export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actorTenantUserId: string,
  requestPayload: unknown,
  produce: () => Promise<
    { status: number; body: Record<string, unknown> } | Response
  >
): Promise<Response> {
  const requestHash = computeRequestHash({
    actor: actorTenantUserId,
    request: requestPayload
  });
  const actor = userIdempotencyActor(actorTenantUserId);
  const existing = await findIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    actor
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

  const stored = { success: true as const, data: produced.body, meta: {} };

  await saveIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    actor,
    requestHash,
    produced.status,
    stored
  );

  return jsonResponse(stored, { status: produced.status });
}
