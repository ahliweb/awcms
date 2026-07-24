import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import {
  createLegalHold,
  listLegalHolds
} from "../../../../modules/data-lifecycle/application/legal-hold-service";

const IDEMPOTENCY_SCOPE = "data_lifecycle_legal_hold_create";

/** `GET /api/v1/data-lifecycle/legal-holds` (ADR-0037) — list legal holds for the caller's tenant, optionally filtered by `status`/`descriptorKey`. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const statusParam = url.searchParams.get("status");
  const descriptorKeyParam = url.searchParams.get("descriptorKey");

  if (statusParam && statusParam !== "active" && statusParam !== "released") {
    return fail(
      400,
      "VALIDATION_ERROR",
      'status must be "active" or "released".'
    );
  }

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "data_lifecycle",
      activityCode: "legal_hold",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const holds = await listLegalHolds(tx, tenantId, {
      status: statusParam as "active" | "released" | undefined,
      descriptorKey: descriptorKeyParam ?? undefined
    });

    return ok({ legalHolds: holds });
  });
};

type CreateLegalHoldBody = {
  descriptorKey?: string | null;
  scopeDescription?: unknown;
  reason?: unknown;
  authorityReference?: unknown;
  endsAt?: unknown;
};

/** `POST /api/v1/data-lifecycle/legal-holds` (ADR-0037) — create a legal hold. High-risk mutation: requires `Idempotency-Key`, permission-gated (`data_lifecycle.legal_hold.create`), reason-required, audited `critical`. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
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

  let body: CreateLegalHoldBody;
  try {
    body = (await request.json()) as CreateLegalHoldBody;
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const descriptorKey =
    typeof body.descriptorKey === "string" ? body.descriptorKey : null;
  const scopeDescription =
    typeof body.scopeDescription === "string" ? body.scopeDescription : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const authorityReference =
    typeof body.authorityReference === "string" ? body.authorityReference : "";
  const endsAt =
    typeof body.endsAt === "string" && body.endsAt.length > 0
      ? new Date(body.endsAt)
      : null;

  const requestHash = computeRequestHash(body);
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "data_lifecycle",
      activityCode: "legal_hold",
      action: "create"
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

    const result = await createLegalHold(
      tx,
      tenantId,
      auth.context.tenantUserId,
      { descriptorKey, scopeDescription, reason, authorityReference, endsAt },
      correlationId
    );

    if (!result.ok) {
      return fail(
        400,
        "VALIDATION_ERROR",
        result.errors
          .map((error) => `${error.field}: ${error.message}`)
          .join("; ")
      );
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
