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
  getRedirectById,
  softDeleteRedirect,
  updateRedirect
} from "../../../../../modules/seo-distribution/application/redirect-directory";
import { checkRedirectSafety } from "../../../../../modules/seo-distribution/application/redirect-safety";
import { resolveTenantAllowedHosts } from "../../../../../modules/seo-distribution/application/tenant-allowed-hosts";
import { validateRedirectUpdate } from "../../../../../modules/seo-distribution/domain/redirect-rule";
import {
  SEO_MODULE_KEY,
  SEO_REDIRECT_ACTIVITY_CODE
} from "../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `/api/v1/seo/redirects/{id}` (ADR-0039) — read (GET), update mutable fields
 * (PUT; source path is immutable), and soft-delete (DELETE, reason required).
 * ABAC-gated (`redirect.read` / `redirect.update` / `redirect.delete`),
 * tenant-scoped, audited on write. Every update re-validates the target through
 * the frozen open-redirect guard + the conflict/loop/chain safety gate.
 */

const READ_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "read" as const
};
const UPDATE_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "update" as const
};
const DELETE_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "delete" as const
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

export const GET: APIRoute = async ({ request, cookies, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const id = resolveId(params);
  if (!id) return fail(400, "VALIDATION_ERROR", "Redirect id is invalid.");

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
    if (!auth.allowed) return auth.denied;

    const redirect = await getRedirectById(tx, tenantId, id);
    if (!redirect)
      return fail(404, "RESOURCE_NOT_FOUND", "Redirect rule not found.");

    return ok(redirect);
  });
};

export const PUT: APIRoute = async ({ request, cookies, params, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const id = resolveId(params);
  if (!id) return fail(400, "VALIDATION_ERROR", "Redirect id is invalid.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

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

    const existing = await getRedirectById(tx, tenantId, id);
    if (!existing)
      return fail(404, "RESOURCE_NOT_FOUND", "Redirect rule not found.");

    const allowedHosts = await resolveTenantAllowedHosts(tx, tenantId);
    const validation = validateRedirectUpdate(
      bodyRead.value,
      existing.normalizedSourcePath,
      { allowedHosts }
    );
    if (!validation.ok) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Redirect rule is invalid.",
        {},
        validation.errors
      );
    }

    const safety = await checkRedirectSafety(
      tx,
      tenantId,
      {
        sourcePath: existing.sourcePath,
        normalizedSourcePath: existing.normalizedSourcePath,
        origin: existing.origin,
        ...validation.value
      },
      now,
      { allowedHosts, excludeId: id }
    );
    if (!safety.ok) {
      return fail(
        409,
        safety.code,
        safety.message,
        {},
        safety.conflict ? { conflict: safety.conflict } : undefined
      );
    }

    const updated = await updateRedirect(
      tx,
      tenantId,
      auth.context.tenantUserId,
      id,
      validation.value
    );
    if (!updated)
      return fail(404, "RESOURCE_NOT_FOUND", "Redirect rule not found.");

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: SEO_MODULE_KEY,
      action: "seo_distribution.redirect.updated",
      resourceType: "seo_redirect",
      resourceId: id,
      severity: "info",
      message: `Redirect rule updated: ${updated.normalizedSourcePath} -> ${updated.target} (${updated.statusCode}).`,
      attributes: {
        targetType: updated.targetType,
        statusCode: updated.statusCode,
        state: updated.state
      },
      correlationId
    });

    return ok(updated);
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
  if (!id) return fail(400, "VALIDATION_ERROR", "Redirect id is invalid.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const body = (bodyRead.value ?? {}) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "A non-empty delete reason is required."
    );
  }
  if (reason.length > 500) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Delete reason must be at most 500 characters."
    );
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
      DELETE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const deleted = await softDeleteRedirect(
      tx,
      tenantId,
      auth.context.tenantUserId,
      id,
      reason
    );
    if (!deleted)
      return fail(404, "RESOURCE_NOT_FOUND", "Redirect rule not found.");

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: SEO_MODULE_KEY,
      action: "seo_distribution.redirect.deleted",
      resourceType: "seo_redirect",
      resourceId: id,
      severity: "info",
      message: `Redirect rule soft-deleted: ${deleted.normalizedSourcePath}.`,
      attributes: { reason },
      correlationId
    });

    return ok(deleted);
  });
};
