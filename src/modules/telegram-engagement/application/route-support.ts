/**
 * Shared plumbing for the ADMIN `/api/v1/telegram-engagement/*` route files
 * (Issue #1156): the off-switch, body parsing, `Idempotency-Key`, step-up, the
 * audit helper and the uniform refusals, so the route files stay thin and
 * cannot drift into different spellings of the same answer.
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
import type { TenantRouteHandlerContext } from "../../_shared/tenant-route";
import { getMfaStatus } from "../../identity-access/application/mfa";
import { requireStepUp } from "../../identity-access/application/mfa-session-assurance";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  isTelegramEngagementEnabled,
  resolveTelegramEngagementRing
} from "../domain/telegram-engagement-config";
import { TELEGRAM_ENGAGEMENT_MODULE_KEY } from "../domain/telegram-engagement-constants";
import type { Validated } from "../domain/telegram-engagement-validation";
import { isUuid } from "../domain/telegram-engagement-validation";
import { channelAccountsAvailable } from "../infrastructure/channel-accounts-bridge";

/**
 * Off means "not here": every admin route answers `404` (no hint that the
 * module exists) unless the deployment switch is on (ADR-0152 TG13). Checked in
 * `prepare`, before any database work.
 */
export function disabledResponse(): Response | null {
  return isTelegramEngagementEnabled()
    ? null
    : fail(404, "NOT_FOUND", "Not found.");
}

/** Fail closed BEFORE any work that would encrypt, hash or decrypt. */
export function keysUnavailable(): Response | null {
  if (!resolveTelegramEngagementRing().ok) {
    return fail(
      503,
      "KEY_RING_UNAVAILABLE",
      "Telegram engagement keys are not configured on this deployment."
    );
  }

  if (!channelAccountsAvailable()) {
    return fail(
      503,
      "CHANNEL_ACCOUNTS_UNAVAILABLE",
      "The channel account registry or its key ring is not available on this deployment."
    );
  }

  return null;
}

/**
 * A machine credential cannot do an accountable, audited act: idempotency
 * records and audit rows are filed per PERSON.
 */
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

/** Parses and validates a JSON body without touching the database. Error text never echoes a value. */
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

/** One uniform answer for unknown, foreign and invisible (T-I1). */
export function notFound(what: string): Response {
  return fail(404, "RESOURCE_NOT_FOUND", `${what} not found.`);
}

/**
 * Step-up for the high-risk bot actions (ADR-0152 section 2, ADR-0141): a
 * person with an enrolled factor must have a fresh step-up; a person without
 * one is not locked out and no enrolment is imposed (the channel-accounts rule).
 */
export async function requireConditionalStepUp(
  context: Pick<
    TenantRouteHandlerContext<unknown>,
    "tx" | "tenantId" | "tokenHash" | "auth" | "now"
  >
): Promise<Response | null> {
  const mfa = await getMfaStatus(
    context.tx,
    context.tenantId,
    context.auth.context.identityId
  );

  if (!mfa.enabled) return null;

  const stepUp = await requireStepUp(
    context.tx,
    context.tenantId,
    context.tokenHash,
    context.now
  );

  return stepUp.ok ? null : stepUp.denied;
}

export async function auditTelegramEngagement(
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
    moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    severity: input.severity,
    message: input.message,
    // Ids, fixed codes and counts ONLY: never a token, a secret, a chat id or
    // message text (ADR-0152 TG11).
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

/** One sentence per enqueue refusal code; never a value from the request. */
export const ENQUEUE_REFUSAL_MESSAGES = {
  CONTACT_NOT_STARTED:
    "The contact has not started the bot, or stopped, blocked or was ended. No message can be sent.",
  CONSENT_REQUIRED:
    "The contact has not opted in to this purpose. Marketing and transactional need the explicit opt-in.",
  CONSENT_WITHDRAWN: "The contact withdrew consent for this purpose.",
  BOT_NOT_ACTIVE: "The bot has no active verified webhook.",
  CAPABILITY_DENIED:
    "The bot account does not hold the dm capability with evidence, or is not connected."
} as const;
