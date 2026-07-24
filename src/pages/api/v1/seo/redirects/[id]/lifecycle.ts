import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse
} from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import {
  assertUuid,
  withTenant
} from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import {
  purgeRedirect,
  restoreRedirect,
  setRedirectState
} from "../../../../../../modules/seo-distribution/application/redirect-directory";
import {
  SEO_MODULE_KEY,
  SEO_REDIRECT_ACTIVITY_CODE
} from "../../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `POST /api/v1/seo/redirects/{id}/lifecycle` (ADR-0039) — transition a rule's state
 * or delete lifecycle: `activate` | `deactivate` | `archive` | `restore` | `purge`.
 * Idempotency-keyed + audited. ABAC: `purge` needs `redirect.delete`; every other
 * action needs `redirect.update` (DYNAMIC guard).
 */

const LIFECYCLE_ACTIONS = [
  "activate",
  "deactivate",
  "archive",
  "restore",
  "purge"
] as const;
type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

const IDEMPOTENCY_SCOPE = "seo_distribution_redirect_lifecycle";

export const POST: APIRoute = async ({ request, cookies, params, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const id = params.id;
  if (!id) return fail(400, "VALIDATION_ERROR", "Redirect id is invalid.");
  try {
    assertUuid(id);
  } catch {
    return fail(400, "VALIDATION_ERROR", "Redirect id is invalid.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const body = (bodyRead.value ?? {}) as Record<string, unknown>;
  const action = body.action;
  if (
    typeof action !== "string" ||
    !LIFECYCLE_ACTIONS.includes(action as LifecycleAction)
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `action must be one of ${LIFECYCLE_ACTIONS.join(", ")}.`
    );
  }
  const lifecycleAction = action as LifecycleAction;

  const guard = {
    moduleKey: SEO_MODULE_KEY,
    activityCode: SEO_REDIRECT_ACTIVITY_CODE,
    action: (lifecycleAction === "purge" ? "delete" : "update") as
      "delete" | "update"
  };
  const requestHash = computeRequestHash({ id, action: lifecycleAction });

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
      guard
    );
    if (!auth.allowed) return auth.denied;

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
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

    const actor = auth.context.tenantUserId;
    let responseBody: unknown;
    const responseStatus = 200;

    if (lifecycleAction === "purge") {
      const purged = await purgeRedirect(tx, tenantId, id);
      if (!purged) {
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "No soft-deleted redirect rule to purge."
        );
      }
      responseBody = { success: true, data: { id, purged: true }, meta: {} };
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: actor,
        moduleKey: SEO_MODULE_KEY,
        action: "seo_distribution.redirect.purged",
        resourceType: "seo_redirect",
        resourceId: id,
        severity: "warning",
        message: "Redirect rule purged (hard delete).",
        correlationId
      });
    } else {
      const record =
        lifecycleAction === "restore"
          ? await restoreRedirect(tx, tenantId, actor, id)
          : await setRedirectState(
              tx,
              tenantId,
              actor,
              id,
              lifecycleAction === "activate"
                ? "active"
                : lifecycleAction === "deactivate"
                  ? "inactive"
                  : "archived"
            );

      if (!record) {
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "Redirect rule not found (or not in a state this action applies to)."
        );
      }

      responseBody = { success: true, data: record, meta: {} };
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: actor,
        moduleKey: SEO_MODULE_KEY,
        action: `seo_distribution.redirect.${lifecycleAction === "restore" ? "restored" : "state_changed"}`,
        resourceType: "seo_redirect",
        resourceId: id,
        severity: "info",
        message: `Redirect rule ${lifecycleAction}: ${record.normalizedSourcePath} (state=${record.state}).`,
        attributes: { action: lifecycleAction, state: record.state },
        correlationId
      });
    }

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      responseStatus,
      responseBody
    );
    return jsonResponse(responseBody, { status: responseStatus });
  });
};
