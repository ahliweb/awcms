import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import {
  assertUuid,
  withTenant
} from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  dismissNotFoundObservation,
  resolveNotFoundObservation
} from "../../../../../modules/seo-distribution/application/not-found-directory";
import { getRedirectById } from "../../../../../modules/seo-distribution/application/redirect-directory";
import {
  SEO_MODULE_KEY,
  SEO_NOT_FOUND_ACTIVITY_CODE
} from "../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `/api/v1/seo/not-found/{id}` (ADR-0039) — POST resolves a 404 observation
 * (optionally attaching a same-tenant suggested redirect id, validated to exist);
 * DELETE dismisses (hard-deletes) it. Both ABAC `not_found.update` + audited.
 */

const UPDATE_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_NOT_FOUND_ACTIVITY_CODE,
  action: "update" as const
};

function resolveId(params: Record<string, string | undefined>): string | null {
  const id = params.id;
  if (!id) return null;
  try {
    assertUuid(id);
    return id;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request, cookies, params, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const id = resolveId(params);
  if (!id) return fail(400, "VALIDATION_ERROR", "Observation id is invalid.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);
  const body = (bodyRead.value ?? {}) as Record<string, unknown>;

  let suggestedRedirectId: string | null = null;
  if (
    body.suggestedRedirectId !== undefined &&
    body.suggestedRedirectId !== null
  ) {
    if (typeof body.suggestedRedirectId !== "string") {
      return fail(
        400,
        "VALIDATION_ERROR",
        "suggestedRedirectId must be a UUID or null."
      );
    }
    try {
      assertUuid(body.suggestedRedirectId);
    } catch {
      return fail(
        400,
        "VALIDATION_ERROR",
        "suggestedRedirectId must be a UUID or null."
      );
    }
    suggestedRedirectId = body.suggestedRedirectId;
  }

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
      UPDATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    // A suggested redirect must be one of THIS tenant's own rules (RLS-scoped read).
    if (suggestedRedirectId) {
      const rule = await getRedirectById(tx, tenantId, suggestedRedirectId);
      if (!rule) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "suggestedRedirectId does not reference a redirect rule for this tenant."
        );
      }
    }

    const observation = await resolveNotFoundObservation(
      tx,
      tenantId,
      auth.context.tenantUserId,
      id,
      suggestedRedirectId,
      now
    );
    if (!observation)
      return fail(404, "RESOURCE_NOT_FOUND", "404 observation not found.");

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: SEO_MODULE_KEY,
      action: "seo_distribution.not_found.resolved",
      resourceType: "seo_not_found_observation",
      resourceId: id,
      severity: "info",
      message: `404 observation resolved: ${observation.normalizedPath}.`,
      attributes: { suggestedRedirectId },
      correlationId
    });

    return ok(observation);
  });
};

export const DELETE: APIRoute = async ({
  request,
  cookies,
  params,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const id = resolveId(params);
  if (!id) return fail(400, "VALIDATION_ERROR", "Observation id is invalid.");

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
      UPDATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const dismissed = await dismissNotFoundObservation(tx, tenantId, id);
    if (!dismissed)
      return fail(404, "RESOURCE_NOT_FOUND", "404 observation not found.");

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: SEO_MODULE_KEY,
      action: "seo_distribution.not_found.dismissed",
      resourceType: "seo_not_found_observation",
      resourceId: id,
      severity: "info",
      message: "404 observation dismissed.",
      correlationId
    });

    return ok({ id, dismissed: true });
  });
};
