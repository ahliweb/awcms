import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { fetchEmailHealthReport } from "../../../../modules/reporting/application/email-health-report";

const GUARD_REQUEST = {
  moduleKey: "reporting",
  activityCode: "dashboard",
  action: "read" as const
};

/** `GET /api/v1/reports/email-health` (Issue #499) — queue health, failed messages, and retry backlog visible to authorized operators. Reuses the `reporting.dashboard.read` permission already gating `GET /reports/sync-health`. */
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

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        GUARD_REQUEST
      );

      if (!auth.allowed) {
        return auth.denied;
      }

      const report = await fetchEmailHealthReport(tx, tenantId);

      return ok(report);
    },
    { workClass: "reporting" }
  );
};
