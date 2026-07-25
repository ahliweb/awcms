import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import {
  fetchIndexStatus,
  fetchRecentRuns
} from "../../../../../modules/site-search/application/search-diagnostics";
import {
  SITE_SEARCH_INDEX_ACTIVITY_CODE,
  SITE_SEARCH_MODULE_KEY
} from "../../../../../modules/site-search/domain/site-search-permissions";

const READ_GUARD = {
  moduleKey: SITE_SEARCH_MODULE_KEY,
  activityCode: SITE_SEARCH_INDEX_ACTIVITY_CODE,
  action: "read" as const
};

/** `GET /api/v1/site-search/index/status` — index status, freshness, and recent runs. */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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
        READ_GUARD
      );
      if (!auth.allowed) return auth.denied;

      // Sequential, not Promise.all: concurrent queries on one tx connection
      // leak it (idle in transaction).
      const status = await fetchIndexStatus(tx, tenantId);
      const recentRuns = await fetchRecentRuns(tx, tenantId, 10);
      return ok({ status, recentRuns });
    },
    { workClass: "reporting" }
  );
};
