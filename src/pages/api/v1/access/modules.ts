import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "read" as const
};

/**
 * `GET /api/v1/access/modules` — the permission catalog grouped by module:
 * every `(moduleKey, activityCode, action)` a role can be granted. Read-only.
 * Guarded by `identity_access.access_control.read` (reading roles,
 * permissions, and decision logs) — distinct from `GET /api/v1/modules`, the
 * module-management catalog of registered modules and their lifecycle state.
 */
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

    const rows = await tx`
      SELECT module_key, activity_code, action, description
      FROM awcms_permissions
      ORDER BY module_key, activity_code, action
    `;

    type PermissionRow = {
      module_key: string;
      activity_code: string;
      action: string;
      description: string | null;
    };

    return ok({
      modules: (rows as PermissionRow[]).map((row) => ({
        moduleKey: row.module_key,
        activityCode: row.activity_code,
        action: row.action,
        description: row.description ?? undefined
      }))
    });
  });
};
