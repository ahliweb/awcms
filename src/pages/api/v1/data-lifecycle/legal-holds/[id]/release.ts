import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { releaseLegalHold } from "../../../../../../modules/data-lifecycle/application/legal-hold-service";

const IDEMPOTENCY_SCOPE = "data_lifecycle_legal_hold_release";

type ReleaseLegalHoldBody = {
  releaseReason?: unknown;
};

/**
 * `POST /api/v1/data-lifecycle/legal-holds/{id}/release` (ADR-0037) — end an
 * active legal hold. Deliberately a DISTINCT permission
 * (`data_lifecycle.legal_hold.release`) from `.create` — "default-deny release":
 * holding `create` does not imply the ability to `release`. High-risk mutation:
 * requires `Idempotency-Key`, reason-required, audited `critical`.
 */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const holdId = params.id;
  if (!holdId) {
    return fail(400, "VALIDATION_ERROR", "Legal hold id is required.");
  }

  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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

  let body: ReleaseLegalHoldBody;
  try {
    body = (await request.json()) as ReleaseLegalHoldBody;
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const releaseReason =
    typeof body.releaseReason === "string" ? body.releaseReason : "";
  const requestHash = computeRequestHash({
    ...body,
    id: holdId,
    action: "release"
  });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "data_lifecycle",
      activityCode: "legal_hold",
      action: "release"
    });

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

    const result = await releaseLegalHold(
      tx,
      tenantId,
      auth.context.tenantUserId,
      holdId,
      { releaseReason },
      correlationId
    );

    if (!result.ok) {
      if (result.reason === "validation") {
        return fail(
          400,
          "VALIDATION_ERROR",
          result.errors
            .map((error) => `${error.field}: ${error.message}`)
            .join("; ")
        );
      }
      if (result.reason === "not_found") {
        return fail(404, "NOT_FOUND", "Legal hold not found.");
      }
      return fail(409, "ALREADY_RELEASED", "Legal hold is already released.");
    }

    const successResponse = ok({ legalHold: result.hold });
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
