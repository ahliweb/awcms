import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
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
  fetchActiveTenantDomain,
  softDeleteTenantDomain,
  updateTenantDomain
} from "../../../../../modules/tenant-domain/application/tenant-domain-directory";
import { validateUpdateTenantDomainInput } from "../../../../../modules/tenant-domain/domain/tenant-domain-validation";

const READ_GUARD = {
  moduleKey: "tenant_domain",
  activityCode: "domains",
  action: "read" as const
};

const UPDATE_GUARD = {
  moduleKey: "tenant_domain",
  activityCode: "domains",
  action: "update" as const
};

const DELETE_GUARD = {
  moduleKey: "tenant_domain",
  activityCode: "domains",
  action: "delete" as const
};

/**
 * `GET /api/v1/tenant/domains/{id}`. Unknown id, another tenant's id, and a
 * soft-deleted id all fall through to the same generic 404 —
 * `fetchActiveTenantDomain` filters `tenant_id`/`deleted_at IS NULL` explicitly,
 * and RLS `FORCE`s the same isolation underneath (defense in depth), so a
 * cross-tenant id is invisible before it can ever be distinguished from
 * "doesn't exist".
 */
export const GET: APIRoute = async ({ request, params, cookies }) => {
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

    const domain = await fetchActiveTenantDomain(tx, tenantId, domainId);

    if (!domain) {
      return fail(404, "RESOURCE_NOT_FOUND", "Tenant domain not found.");
    }

    return ok(domain);
  });
};

/** `PATCH /api/v1/tenant/domains/{id}` — partial update. Idempotent by construction (same body -> same end state), no `Idempotency-Key` needed. `hostname`/`is_primary`/`status: "active"` are not reachable through this endpoint — see `updateTenantDomain`'s own docblock. */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateTenantDomainInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Tenant domain update is invalid.",
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
      UPDATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const domain = await updateTenantDomain(
      tx,
      tenantId,
      auth.context.tenantUserId,
      domainId,
      input
    );

    if (!domain) {
      return fail(404, "RESOURCE_NOT_FOUND", "Tenant domain not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "tenant_domain",
      action: "tenant_domain.domain.updated",
      resourceType: "tenant_domain",
      resourceId: domainId,
      severity: "info",
      message: `Tenant domain mapping updated: ${domain.normalizedHostname}.`,
      correlationId
    });

    return ok(domain);
  });
};

/** `DELETE /api/v1/tenant/domains/{id}` — soft-delete only, `reason` required. Never hard-deletes; frees the normalized hostname for reuse (migration 046's partial unique index). */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const reasonRaw = (body as { reason?: unknown } | null)?.reason;

  if (typeof reasonRaw !== "string" || reasonRaw.trim().length === 0) {
    return fail(400, "VALIDATION_ERROR", "reason is required.");
  }

  const reason = reasonRaw.trim();
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

    if (!auth.allowed) {
      return auth.denied;
    }

    const deleted = await softDeleteTenantDomain(
      tx,
      tenantId,
      auth.context.tenantUserId,
      domainId,
      reason
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Tenant domain not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "tenant_domain",
      action: "tenant_domain.domain.deleted",
      resourceType: "tenant_domain",
      resourceId: domainId,
      severity: "warning",
      message: "Tenant domain mapping deleted.",
      attributes: { reason },
      correlationId
    });

    return ok({ id: domainId, deleted: true });
  });
};
