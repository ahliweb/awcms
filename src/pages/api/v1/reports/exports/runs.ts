import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { listExportRuns } from "../../../../../modules/reporting/application/export-run-store";

/** `GET /api/v1/reports/exports/runs` (Issue #753) — export run history (manifest/checksum/expiry evidence), optionally filtered by `projectionKey`. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
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
  const projectionKey = url.searchParams.get("projectionKey") ?? undefined;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "reporting",
      activityCode: "exports",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const runs = await listExportRuns(tx, tenantId, projectionKey);

    return ok({ exportRuns: runs });
  });
};
