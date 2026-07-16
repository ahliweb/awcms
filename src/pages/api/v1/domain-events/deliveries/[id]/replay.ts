import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { readJsonBody } from "../../../../../../lib/security/request-body-limit";
import {
  DeliveryNotDeadLetteredError,
  ReplaySchemaIncompatibleError,
  UnknownReplayConsumerError,
  replayDomainEventDelivery
} from "../../../../../../modules/domain-event-runtime/application/delivery-replay";

const REPLAY_GUARD = {
  moduleKey: "domain_event_runtime",
  activityCode: "deliveries",
  action: "replay" as const
};

const IDEMPOTENCY_SCOPE = "domain_event_runtime_delivery_replay";
const MAX_REASON_LENGTH = 500;

type ReplayRequestBody = { reason?: unknown };

/**
 * `POST /api/v1/domain-events/deliveries/{id}/replay` — permission-gated
 * (`deliveries.replay`), reason-required, idempotent (`Idempotency-Key`),
 * and audited (`recordAuditEvent`, inside `replayDomainEventDelivery`).
 * Only valid from a `dead_letter` delivery; refuses (409) if the registered
 * consumer no longer supports the delivery's `event_version` — "cannot
 * replay an incompatible schema silently".
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Delivery id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody<ReplayRequestBody>(request);

  if (bodyRead.tooLarge) {
    return fail(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }

  const reason =
    typeof bodyRead.value?.reason === "string"
      ? bodyRead.value.reason.trim()
      : "";

  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `reason is required and must be 1-${MAX_REASON_LENGTH} characters.`
    );
  }

  const requestHash = computeRequestHash({ id, action: "replay", reason });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      REPLAY_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    let replayed;

    try {
      replayed = await replayDomainEventDelivery(
        tx,
        tenantId,
        auth.context.tenantUserId,
        id,
        reason,
        correlationId
      );
    } catch (error) {
      if (error instanceof DeliveryNotDeadLetteredError) {
        return fail(409, "INVALID_STATUS_TRANSITION", error.message);
      }

      if (
        error instanceof ReplaySchemaIncompatibleError ||
        error instanceof UnknownReplayConsumerError
      ) {
        return fail(409, "DOMAIN_EVENT_SCHEMA_INCOMPATIBLE", error.message);
      }

      throw error;
    }

    if (!replayed) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Domain event delivery not found."
      );
    }

    const successResponse = ok({ delivery: replayed });
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      successBody
    );

    return successResponse;
  });
};
