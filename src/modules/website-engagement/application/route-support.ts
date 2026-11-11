/**
 * Shared plumbing for the ADMIN `/api/v1/website-engagement/*` route files
 * (Issue #1153): body parsing, `Idempotency-Key` handling, the audit helper and
 * the refusals, so the route files stay thin and cannot drift into different
 * spellings of the same answer.
 */
import { isTurnstileRequired } from "../../../lib/security/turnstile";
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
import { resolveWebsiteEngagementRings } from "../domain/engagement-config";
import type { Validated } from "../domain/source-validation";
import { isUuid } from "../domain/source-validation";
import {
  WEBSITE_ENGAGEMENT_MODULE_KEY,
  type ChallengeMode
} from "../domain/website-engagement-constants";
import type { SourceView } from "./source-directory";

/**
 * A machine credential cannot do an accountable, audited act: assignments,
 * idempotency records and audit rows are filed per PERSON. Read endpoints do
 * not call this (the CRM consumer reads with a machine credential).
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

/** Fail closed BEFORE any work that would hash a token or touch a ciphertext. */
export function ringUnavailable(): Response | null {
  return resolveWebsiteEngagementRings().ok
    ? null
    : fail(
        503,
        "KEY_RING_UNAVAILABLE",
        "Website engagement keys are not configured on this deployment."
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

/** Parses and validates a JSON body, answering the right 4xx without touching the database. Error text never echoes a value. */
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

export function badId(field = "id"): Response {
  return fail(400, "VALIDATION_ERROR", `${field} must be a UUID.`);
}

export function asUuid(value: string | undefined | null): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

/** One uniform answer for "no such id" in this tenant: an id must not be enumerable. */
export function notFound(what: string): Response {
  return fail(404, "RESOURCE_NOT_FOUND", `${what} not found.`);
}

/**
 * The challenge a source ACTUALLY gets on this deployment, so an administrator
 * can see that a source set to `turnstile` on an offline/LAN profile is running
 * on the non-third-party controls alone (ADR-0155 section 7).
 */
export function withEffectiveChallenge(
  source: SourceView
): SourceView & { challengeEffective: ChallengeMode } {
  return {
    ...source,
    challengeEffective:
      source.challengeMode === "turnstile" && isTurnstileRequired()
        ? "turnstile"
        : "none"
  };
}

export async function auditWebsiteEngagement(
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
    moduleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
    action: input.action,
    resourceType: input.resourceType,
    ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    severity: input.severity,
    message: input.message,
    // Ids, fixed codes and counts ONLY: never a token, an address, a name or a
    // message, so the audit log cannot become a second copy of them.
    ...(input.attributes ? { attributes: input.attributes } : {}),
    ...(context.locals.correlationId
      ? { correlationId: context.locals.correlationId }
      : {})
  });
}

/**
 * Runs `produce` at most once per `(scope, Idempotency-Key, acting person)`:
 * same key + same request -> the STORED response; same key + different request
 * -> `409 IDEMPOTENCY_CONFLICT`; unseen key -> `produce()`.
 *
 * `reveal` is data returned to the FIRST caller only and never stored: a source
 * token is shown once, so a replay answers the stored body WITHOUT it and with
 * `revealed: false`. Refusals are not stored.
 */
export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  actorTenantUserId: string,
  requestPayload: unknown,
  produce: () => Promise<
    | {
        status: number;
        body: Record<string, unknown>;
        reveal?: Record<string, unknown>;
      }
    | Response
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

  const stored = {
    success: true as const,
    data: { ...produced.body, ...(produced.reveal ? { revealed: false } : {}) },
    meta: {}
  };

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

  return jsonResponse(
    {
      success: true as const,
      data: {
        ...produced.body,
        ...(produced.reveal ? { ...produced.reveal, revealed: true } : {})
      },
      meta: {}
    },
    { status: produced.status }
  );
}
