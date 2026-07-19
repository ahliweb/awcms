import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../../modules/identity-access/application/access-guard";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../../modules/_shared/idempotency";
import { revokeSoDConflictException } from "../../../../../../../modules/identity-access/application/sod-exception-service";

const IDEMPOTENCY_SCOPE = "identity_access_sod_conflict_exception_revoke";

type RevokeExceptionBody = {
  revokeReason?: unknown;
};

/** `POST /api/v1/identity/business-scope/exceptions/{id}/revoke` (Issue #181) — revoke a previously approved SoD conflict exception, ending the override early (immediately ineffective at the next decision). Gated on `identity_access.business_scope_exceptions.revoke`, `Idempotency-Key` required, reason-required, audited `critical`. */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const exceptionId = params.id;
  if (!exceptionId) {
    return fail(400, "VALIDATION_ERROR", "Exception id is required.");
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

  let body: RevokeExceptionBody;
  try {
    body = (await request.json()) as RevokeExceptionBody;
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const revokeReason =
    typeof body.revokeReason === "string" ? body.revokeReason : "";
  const requestHash = computeRequestHash({
    ...body,
    id: exceptionId,
    action: "revoke"
  });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "identity_access",
      activityCode: "business_scope_exceptions",
      action: "revoke"
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

    const result = await revokeSoDConflictException(
      tx,
      tenantId,
      auth.context.tenantUserId,
      exceptionId,
      { revokeReason },
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
        return fail(404, "NOT_FOUND", "SoD conflict exception not found.");
      }
      return fail(
        409,
        "INVALID_STATE",
        "SoD conflict exception is not approved."
      );
    }

    const successResponse = ok({ exception: result.exception });
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
