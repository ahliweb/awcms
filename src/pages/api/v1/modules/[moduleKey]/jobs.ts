import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { fetchModuleJobs } from "../../../../../modules/module-management/application/job-registry";

const READ_GUARD = {
  moduleKey: "module_management",
  activityCode: "jobs",
  action: "read" as const
};

/**
 * `GET /api/v1/modules/{moduleKey}/jobs` — the module's declared operational
 * commands (`command`, `purpose`, `recommendedSchedule`, `environmentNotes`,
 * `safeInOfflineLan`). Documentation only: this never executes anything and
 * there is no corresponding "run this job" endpoint, deliberately (running
 * arbitrary commands from a web UI is explicitly out of scope). A genuinely
 * unknown `moduleKey` is `404`; a registered module that simply declares no
 * jobs still returns `200` with an empty list.
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

    const jobs = fetchModuleJobs(moduleKey);

    if (!jobs) {
      return fail(404, "RESOURCE_NOT_FOUND", "Module not found.");
    }

    return ok({ moduleKey, jobs });
  });
};
