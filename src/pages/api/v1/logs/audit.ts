import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { listAuditEvents } from "../../../../modules/logging/application/audit-log";

const READ_GUARD = {
  moduleKey: "logging",
  activityCode: "audit_trail",
  action: "read" as const
};

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (
    limitParam !== null &&
    (!Number.isFinite(limit) || (limit as number) < 1)
  ) {
    return fail(400, "VALIDATION_ERROR", "limit must be a positive number.");
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
    if (!auth.allowed) return auth.denied;

    const items = await listAuditEvents(tx, tenantId, {
      resourceType: url.searchParams.get("resourceType") ?? undefined,
      limit
    });

    return ok({
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString()
      }))
    });
  });
};
