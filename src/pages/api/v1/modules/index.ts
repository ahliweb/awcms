import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { fetchModuleCatalog } from "../../../../modules/module-management/application/module-catalog";

const READ_GUARD = {
  moduleKey: "module_management",
  activityCode: "modules",
  action: "read" as const
};

/**
 * `GET /api/v1/modules` — the module catalog: every module currently
 * registered in code (`listModules()`), merged with its database-tracked
 * lifecycle state where `POST /api/v1/modules/sync` has run. Distinct from
 * `GET /api/v1/access/modules` (the permission catalog grouped by module).
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

    const modules = await fetchModuleCatalog(tx);

    return ok({ modules });
  });
};
