import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { listTenantUsers } from "../../../../modules/identity-access/application/access-directory";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "read" as const
};

/**
 * `GET /api/v1/users` — the tenant's users with their assigned role codes
 * (Issue #166). Read-only; `login_identifier` is masked (PII). Gated on
 * `identity_access.access_control.read`.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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

    const items = await listTenantUsers(tx, tenantId);
    return ok({ items });
  });
};
