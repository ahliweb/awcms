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
  createTenantDomain,
  listTenantDomains
} from "../../../../../modules/tenant-domain/application/tenant-domain-directory";
import { validateCreateTenantDomainInput } from "../../../../../modules/tenant-domain/domain/tenant-domain-validation";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";

const READ_GUARD = {
  moduleKey: "tenant_domain",
  activityCode: "domains",
  action: "read" as const
};

const CREATE_GUARD = {
  moduleKey: "tenant_domain",
  activityCode: "domains",
  action: "create" as const
};

/** `GET /api/v1/tenant/domains` — this tenant's non-deleted domain/subdomain mappings, keyset-paginated newest first (limit 100). */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
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

    const { domains, nextCursor } = await listTenantDomains(
      tx,
      tenantId,
      cursor ?? undefined
    );

    return ok({ domains, nextCursor });
  });
};

/**
 * `POST /api/v1/tenant/domains` — add a domain/subdomain mapping. A duplicate
 * normalized hostname is caught here and mapped to a generic 409 — never
 * distinguishes "you already have this hostname" from "another tenant already
 * has this hostname" (do not leak whether a hostname belongs to another
 * tenant), because the unique index is global, not tenant-scoped (migration
 * 046).
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

  const validation = validateCreateTenantDomainInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Tenant domain is invalid.",
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

    let domain;

    try {
      domain = await createTenantDomain(
        tx,
        tenantId,
        auth.context.tenantUserId,
        input
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_tenant_domains_normalized_hostname_dedup")) {
        return fail(
          409,
          "HOSTNAME_CONFLICT",
          "This hostname is already mapped to a tenant."
        );
      }

      throw error;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "tenant_domain",
      action: "tenant_domain.domain.created",
      resourceType: "tenant_domain",
      resourceId: domain.id,
      severity: "info",
      message: `Tenant domain mapping created: ${domain.normalizedHostname}.`,
      correlationId
    });

    return ok(domain);
  });
};
