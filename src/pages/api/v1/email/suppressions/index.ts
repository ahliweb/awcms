import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createSuppression,
  listSuppressions
} from "../../../../../modules/email/application/suppression-directory";
import { validateSuppressionInput } from "../../../../../modules/email/domain/suppression-validation";

const READ_GUARD = {
  moduleKey: "email",
  activityCode: "suppression",
  action: "read" as const
};

const CREATE_GUARD = {
  moduleKey: "email",
  activityCode: "suppression",
  action: "create" as const
};

/** `GET /api/v1/email/suppressions` (Issue #499) — never returns a raw recipient address, only `recipientMasked`. */
export const GET: APIRoute = async ({ request, cookies }) => {
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

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const entries = await listSuppressions(tx, tenantId);

    return ok({ entries });
  });
};

/**
 * `POST /api/v1/email/suppressions` (Issue #499) — manual suppression
 * (`reason: "manual"` most commonly, but any of the 4 seeded reasons is
 * accepted — bounce/complaint handling from a provider webhook is a future
 * fast-follow, out of scope here per the issue's own text: "manual
 * suppression" is the only write path this issue adds). Not idempotency-
 * wrapped: `ON CONFLICT ... DO NOTHING` in `createSuppression` already makes
 * a retry with the same recipient a safe no-op (`already_suppressed`).
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateSuppressionInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Suppression request is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
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
      CREATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await createSuppression(
      tx,
      tenantId,
      auth.context.tenantUserId,
      input.recipient,
      input.reason
    );

    if (result.outcome === "already_suppressed") {
      return ok({ alreadySuppressed: true });
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "suppression_created",
      resourceType: "email_suppression",
      resourceId: result.entry.id,
      severity: "warning",
      message: `Recipient suppressed: reason=${input.reason}.`,
      attributes: { reason: input.reason },
      correlationId
    });

    return ok(result.entry);
  });
};
