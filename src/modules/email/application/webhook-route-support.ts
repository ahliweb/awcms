/**
 * Shared pieces of the Mailketing webhook ADMIN routes (Issue #1161):
 * `/api/v1/email/webhook-callbacks*` and `/api/v1/email/provider-events*`.
 * The public callback route does not use this file.
 */
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../_shared/idempotency";

export const EMAIL_WEBHOOK_GUARDS = {
  read: { moduleKey: "email", activityCode: "webhook", action: "read" },
  configure: {
    moduleKey: "email",
    activityCode: "webhook",
    action: "configure"
  },
  approve: {
    moduleKey: "email",
    activityCode: "provider_events",
    action: "approve"
  }
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
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

/** A decision a person must make; a machine credential cannot. */
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

/**
 * Idempotent execution. `reveal` is returned to the FIRST caller only and is
 * never stored: a callback token is shown once, so a replay answers the stored
 * body WITHOUT it and with `revealed: false` (a lost URL is recovered by
 * rotating again with a new key, never by reading it back). Refusals are not
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
    data: {
      ...produced.body,
      ...(produced.reveal ? { revealed: false } : {})
    },
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
