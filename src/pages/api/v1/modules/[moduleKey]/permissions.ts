import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { fetchModulePermissionSyncReport } from "../../../../../modules/module-management/application/permission-sync";

const READ_GUARD = {
  moduleKey: "module_management",
  activityCode: "permissions",
  action: "read" as const
};

/**
 * `GET /api/v1/modules/{moduleKey}/permissions` — compares the module's
 * descriptor-declared `permissions` against the `awcms_permissions` catalog
 * and classifies each one `synced`, `missing`, `orphaned`, or
 * `mismatched_description`. Read-only: never writes to the catalog, never
 * changes a role's assigned permissions. A genuinely unknown `moduleKey` (no
 * descriptor, no catalog rows either) is `404`.
 */
export const GET: APIRoute = async ({ request, params, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const moduleKey = params.moduleKey;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!moduleKey) {
    return fail(400, "VALIDATION_ERROR", "Module key is required.");
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

    const report = await fetchModulePermissionSyncReport(tx, moduleKey);

    if (!report) {
      return fail(404, "RESOURCE_NOT_FOUND", "Module not found.");
    }

    return ok(report);
  });
};
