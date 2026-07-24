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
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { setPrimaryTenantDomain } from "../../../../../../modules/tenant-domain/application/tenant-domain-directory";

const SET_PRIMARY_GUARD = {
  moduleKey: "tenant_domain",
  activityCode: "domains",
  action: "set_primary" as const
};

const IDEMPOTENCY_SCOPE = "tenant_domain_set_primary";

/**
 * `POST /api/v1/tenant/domains/{id}/set-primary` — atomically makes `id` this
 * tenant's primary domain, clearing any previous primary. Atomicity comes from
 * `withTenant`'s single `sql.begin(...)` transaction plus
 * `setPrimaryTenantDomain`'s fixed unset-then-set statement order. Only a
 * verified (`active`) domain can become primary. Requires `Idempotency-Key`.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const domainId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!domainId) {
    return fail(400, "VALIDATION_ERROR", "Domain id is required.");
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

  const requestHash = computeRequestHash({ domainId, action: "set_primary" });
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
      SET_PRIMARY_GUARD
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

    const result = await setPrimaryTenantDomain(
      tx,
      tenantId,
      auth.context.tenantUserId,
      domainId
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Tenant domain not found.");
    }

    if (result.outcome === "not_active") {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot set a domain as primary in status "${result.currentStatus}" — verify it first.`
      );
    }

    if (result.outcome === "conflict") {
      return fail(
        409,
        "CONCURRENT_UPDATE",
        "Another request already changed this tenant's primary domain. Retry with a new Idempotency-Key."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "tenant_domain",
      action: "tenant_domain.domain.set_primary",
      resourceType: "tenant_domain",
      resourceId: domainId,
      severity: "info",
      message: `Tenant domain mapping set as primary: ${result.entry.normalizedHostname}.`,
      correlationId
    });

    const successResponse = ok(result.entry);
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
