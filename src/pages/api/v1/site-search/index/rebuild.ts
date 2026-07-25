import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { getRegisteredSearchSources } from "../../../../../lib/search/search-sources";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { rebuildTenantSearchIndex } from "../../../../../modules/site-search/application/search-index-engine";
import {
  SITE_SEARCH_INDEX_ACTIVITY_CODE,
  SITE_SEARCH_MODULE_KEY
} from "../../../../../modules/site-search/domain/site-search-permissions";

const REBUILD_GUARD = {
  moduleKey: SITE_SEARCH_MODULE_KEY,
  activityCode: SITE_SEARCH_INDEX_ACTIVITY_CODE,
  action: "rebuild" as const
};
const IDEMPOTENCY_SCOPE = "site_search_index_rebuild";

/**
 * `POST /api/v1/site-search/index/rebuild` — force a full, idempotent rebuild of
 * this tenant's search index (delete + re-extract every document). High-risk,
 * idempotency-keyed, audited, bounded (per-tenant content is bounded), observable
 * (returns the run summary + records a run ledger row).
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey)
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;
  const requestHash = computeRequestHash({ op: "site_search_rebuild" });

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        REBUILD_GUARD
      );
      if (!auth.allowed) return auth.denied;

      const existing = await findIdempotencyRecord(
        tx,
        tenantId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was already used with a different request."
          );
        }
        return jsonResponse(existing.responseBody, {
          status: existing.responseStatus
        });
      }

      const result = await rebuildTenantSearchIndex(
        tx,
        tenantId,
        getRegisteredSearchSources(),
        { trigger: "manual", triggeredBy: auth.context.tenantUserId }
      );

      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: SITE_SEARCH_MODULE_KEY,
        action: "site_search.index.rebuild",
        resourceType: "site_search_index_run",
        resourceId: result.runId,
        severity: "info",
        message: "Search index rebuilt.",
        attributes: {
          status: result.status,
          totalIndexed: result.totalIndexed,
          totalRemoved: result.totalRemoved,
          failureCount: result.failureCount
        },
        correlationId
      });

      const successResponse = ok({
        runId: result.runId,
        runType: result.runType,
        status: result.status,
        totalIndexed: result.totalIndexed,
        totalRemoved: result.totalRemoved,
        failureCount: result.failureCount,
        results: result.results
      });
      const successBody = await successResponse.clone().json();
      await saveIdempotencyRecord(
        tx,
        tenantId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
        requestHash,
        200,
        successBody
      );
      return successResponse;
    },
    { workClass: "reporting" }
  );
};
