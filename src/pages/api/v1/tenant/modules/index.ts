import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { fetchTenantModuleEntries } from "../../../../../modules/module-management/application/tenant-module-lifecycle";

const READ_GUARD = {
  moduleKey: "module_management",
  activityCode: "tenant_modules",
  action: "read" as const
};

/**
 * `GET /api/v1/tenant/modules` — every registered module's enablement state
 * for the caller's tenant. A module with no explicit state
 * (`tenantEnabled: true`, no `enabledAt`/`disabledAt`) has never been toggled
 * — available by default (backward-compatible with pre-existing behavior).
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

    const modules = await fetchTenantModuleEntries(tx, tenantId);

    return ok({ modules });
  });
};
