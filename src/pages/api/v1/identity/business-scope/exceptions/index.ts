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
import {
  createSoDConflictException,
  listSoDConflictExceptions
} from "../../../../../../modules/identity-access/application/sod-exception-service";
import { collectSoDRuleDescriptors } from "../../../../../../modules/identity-access/domain/sod-rule-registry";
import { listModules } from "../../../../../../modules";

const IDEMPOTENCY_SCOPE = "identity_access_sod_conflict_exception_create";

// The composed registry's SoD rules (base + any derived application registry).
// The base declares none; a derived application (or the fixture) contributes
// them. An exception can only be created against a KNOWN rule that ALLOWS
// exceptions.
const SOD_RULES = collectSoDRuleDescriptors(listModules());

/** `GET /api/v1/identity/business-scope/exceptions` (Issue #181) — list this tenant's SoD conflict exceptions, optionally filtered by `status`/`ruleKey`. Gated on `identity_access.business_scope_exceptions.read`. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const statusParam = url.searchParams.get("status");
  const ruleKeyParam = url.searchParams.get("ruleKey");
  const validStatuses = [
    "pending",
    "approved",
    "rejected",
    "expired",
    "revoked"
  ];
  if (statusParam && !validStatuses.includes(statusParam)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `status must be one of ${validStatuses.join(", ")}.`
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "identity_access",
      activityCode: "business_scope_exceptions",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const exceptions = await listSoDConflictExceptions(tx, tenantId, {
      status: statusParam as
        "pending" | "approved" | "rejected" | "expired" | "revoked" | undefined,
      ruleKey: ruleKeyParam ?? undefined
    });

    return ok({ exceptions });
  });
};

type CreateExceptionBody = {
  ruleKey?: unknown;
  subjectTenantUserId?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
  justification?: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
};

/** `POST /api/v1/identity/business-scope/exceptions` (Issue #181) — request a SoD conflict exception (`status: "pending"`, requires separate approval). Gated on `identity_access.business_scope_exceptions.create`. High-risk mutation: requires `Idempotency-Key`. */
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

  let body: CreateExceptionBody;
  try {
    body = (await request.json()) as CreateExceptionBody;
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const ruleKey = typeof body.ruleKey === "string" ? body.ruleKey : "";
  const subjectTenantUserId =
    typeof body.subjectTenantUserId === "string"
      ? body.subjectTenantUserId
      : "";
  const scopeType = typeof body.scopeType === "string" ? body.scopeType : null;
  const scopeId = typeof body.scopeId === "string" ? body.scopeId : null;
  const justification =
    typeof body.justification === "string" ? body.justification : "";
  const effectiveFrom =
    typeof body.effectiveFrom === "string" && body.effectiveFrom.length > 0
      ? new Date(body.effectiveFrom)
      : new Date();
  const effectiveTo =
    typeof body.effectiveTo === "string" && body.effectiveTo.length > 0
      ? new Date(body.effectiveTo)
      : new Date(NaN);

  if (!subjectTenantUserId) {
    return fail(400, "VALIDATION_ERROR", "subjectTenantUserId is required.");
  }

  const requestHash = computeRequestHash(body);
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "identity_access",
      activityCode: "business_scope_exceptions",
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

    const result = await createSoDConflictException(
      tx,
      tenantId,
      auth.context.tenantUserId,
      subjectTenantUserId,
      {
        ruleKey,
        scopeType,
        scopeId,
        justification,
        effectiveFrom,
        effectiveTo
      },
      SOD_RULES,
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
      if (result.reason === "rule_not_found") {
        return fail(400, "RULE_NOT_FOUND", "Unknown SoD rule key.");
      }
      if (result.reason === "exception_not_allowed") {
        return fail(
          403,
          "EXCEPTION_NOT_ALLOWED",
          "This SoD rule does not allow exceptions."
        );
      }
      return fail(
        400,
        "EXCEEDS_MAX_DURATION",
        `Exception duration exceeds this rule's maximum of ${result.maxDurationDays} day(s).`
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
