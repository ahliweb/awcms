import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { listModules } from "../../../../modules";
import { collectHighVolumeTableDescriptors } from "../../../../modules/data-lifecycle/domain/lifecycle-registry";

/**
 * `GET /api/v1/data-lifecycle/registry` (ADR-0037) — every registered
 * `HighVolumeTableDescriptor` (code-declared metadata only: table/owner/scope/
 * cursor/retention bounds/partition/archive/deletion/legal-hold/index/
 * batch-limit facts — NEVER row contents, never a live count). Auth/ABAC still
 * applies (same reasoning `GET /api/v1/modules` already established for other
 * code-derived, non-tenant-scoped registries): role/permission grants
 * themselves are tenant-scoped even though this response body is identical for
 * every tenant.
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
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "data_lifecycle",
      activityCode: "registry",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const descriptors = collectHighVolumeTableDescriptors(listModules());

    return ok({ descriptors });
  });
};
