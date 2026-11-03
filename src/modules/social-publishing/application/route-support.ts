/**
 * Shared plumbing for the `/api/v1/social-publishing/*` route files (Issue
 * #1145): the deployment switch, body parsing, `Idempotency-Key` handling, the
 * audit row and the per-account access check. Kept here so the route files stay
 * thin and cannot drift into different spellings of the same refusal.
 */
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../_shared/idempotency";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  SOCIAL_PUBLISHING_MODULE_KEY,
  isSocialPublishingEnabled
} from "../domain/social-publishing-constants";
import { isUuid, type Validated } from "../domain/social-publishing-validation";
import type { ChannelPublisherPort } from "../../_shared/ports/channel-account-port";
import {
  loadAccountAccess,
  type AccountAccessContext,
  type AccountAccessGuard
} from "../infrastructure/channel-account-access-loader";
import { loadChannelPublisherPort } from "../infrastructure/channel-account-port-loader";

/** The deployment switch. Checked AFTER authorization so an unauthorized caller learns nothing about it. */
export function disabledResponse(): Response | null {
  return isSocialPublishingEnabled()
    ? null
    : fail(
        503,
        "SOCIAL_PUBLISHING_DISABLED",
        "Social publishing is not enabled for this deployment."
      );
}

/**
 * After authorization, before any work, for a MUTATION: the deployment switch
 * and a refusal of a machine credential. Publishing speaks for the tenant on a
 * public platform; it is done by accountable people, and per-account access and
 * the maker/checker rule are filed per person.
 */
export function mutationRefusal(auth: {
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

/** Parses a JSON body, answering the right 4xx without touching the database. Field validation runs later, with the clock. */
export async function readJson(request: Request): Promise<unknown | Response> {
  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  if (bodyRead.malformed) {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  return bodyRead.value;
}

export function validationFailure(
  errors: Extract<Validated<unknown>, { valid: false }>["errors"]
): Response {
  return fail(400, "VALIDATION_ERROR", "Request is invalid.", {}, errors);
}

export function asUuid(value: string | undefined | null): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export function badId(field = "id"): Response {
  return fail(400, "VALIDATION_ERROR", `${field} must be a UUID.`);
}

/** One uniform answer for "no such publication" and "not yours". */
export function notFound(what: string): Response {
  return fail(404, "RESOURCE_NOT_FOUND", `${what} not found.`);
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key, acting user)`: same
 * key + same request -> the STORED response; same key + different request ->
 * `409 IDEMPOTENCY_CONFLICT`; unseen key -> `produce()`, and a SUCCESS is
 * stored. Refusals are not stored: the caller fixes something and retries.
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

/**
 * One audit row. `attributes` carries ids, fixed codes and counts ONLY: never a
 * caption, a title, a URL or a credential, so the audit log (read by more people
 * than the screen) cannot become a second copy of them.
 */
export async function auditPublishing(
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
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
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

/**
 * Whether the caller may act on EVERY listed account (assignment rule, business
 * scope, the `assignments.assign` bypass) by the rules of `channel_accounts`.
 * Default-deny: when the channel module cannot be loaded the answer is `false`.
 * An unknown id, another tenant's account and an account the caller cannot use
 * are ONE answer, so the check is not an existence oracle.
 */
export async function canUseAllAccounts(
  context: AccountAccessContext,
  guard: AccountAccessGuard,
  accountIds: readonly string[]
): Promise<boolean> {
  const access = await loadAccountAccess();

  if (!access) return false;

  for (const accountId of accountIds) {
    if (!(await access.canUseAccount(context, guard, accountId, "operator"))) {
      return false;
    }
  }

  return true;
}

/** The enqueue-side port, or `null` when the channel module cannot be loaded (every account is then refused). */
export async function loadPublishersOrNull(): Promise<ChannelPublisherPort | null> {
  try {
    return await loadChannelPublisherPort();
  } catch {
    // A module import, not a query.
    return null;
  }
}
