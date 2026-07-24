import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { listLifecycleRuns } from "../../../../modules/data-lifecycle/application/run-record-store";

/** `GET /api/v1/data-lifecycle/runs` (ADR-0037) — lifecycle run history (dry-run/archive/purge outcomes) for the caller's tenant, categorized aggregate counts only — never row contents or PII. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const descriptorKeyParam = url.searchParams.get("descriptorKey");
  const runTypeParam = url.searchParams.get("runType");

  if (
    runTypeParam &&
    runTypeParam !== "dry_run" &&
    runTypeParam !== "archive" &&
    runTypeParam !== "purge"
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      'runType must be "dry_run", "archive", or "purge".'
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "data_lifecycle",
      activityCode: "runs",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const runs = await listLifecycleRuns(tx, tenantId, {
      descriptorKey: descriptorKeyParam ?? undefined,
      runType: runTypeParam as "dry_run" | "archive" | "purge" | undefined
    });

    return ok({ runs });
  });
};
