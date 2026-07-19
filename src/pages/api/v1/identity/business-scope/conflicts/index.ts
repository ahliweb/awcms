import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { listSoDConflictEvaluations } from "../../../../../../modules/identity-access/application/sod-conflict-evaluation-log";
import {
  decodeKeysetCursor,
  encodeKeysetCursor
} from "../../../../../../modules/_shared/keyset-pagination";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * `GET /api/v1/identity/business-scope/conflicts` (Issue #181) —
 * keyset-paginated, permission-gated SoD conflict evaluation history (the
 * "conflict preview"/audit view). Gated on
 * `identity_access.business_scope_conflicts.read`. Safe projection: rule key,
 * subject id, trigger context, outcome, reason, timestamp only — no
 * request/resource payload.
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const cursorParam = url.searchParams.get("cursor");
  let cursor: { createdAt: string; id: string } | null = null;
  if (cursorParam) {
    const decoded = decodeKeysetCursor(cursorParam);
    if (!decoded) {
      return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
    }
    cursor = decoded;
  }

  const limitParam = url.searchParams.get("limit");
  let limit = DEFAULT_PAGE_SIZE;
  if (limitParam) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_PAGE_SIZE) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `limit must be a positive number up to ${MAX_PAGE_SIZE}.`
      );
    }
    limit = parsed;
  }

  const ruleKeyParam = url.searchParams.get("ruleKey");
  const conflictDetectedParam = url.searchParams.get("conflictDetected");
  let conflictDetected: boolean | undefined;
  if (conflictDetectedParam === "true") conflictDetected = true;
  else if (conflictDetectedParam === "false") conflictDetected = false;
  else if (conflictDetectedParam) {
    return fail(
      400,
      "VALIDATION_ERROR",
      'conflictDetected must be "true" or "false".'
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "identity_access",
      activityCode: "business_scope_conflicts",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const evaluations = await listSoDConflictEvaluations(tx, tenantId, {
      ruleKey: ruleKeyParam ?? undefined,
      conflictDetected,
      limit: limit + 1,
      cursor
    });

    const hasMore = evaluations.length > limit;
    const page = hasMore ? evaluations.slice(0, limit) : evaluations;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeKeysetCursor(last.occurredAtCursor, last.id)
        : null;

    // Strip the internal cursor field from the response projection.
    const conflicts = page.map((row) => ({
      id: row.id,
      ruleKey: row.ruleKey,
      subjectTenantUserId: row.subjectTenantUserId,
      triggerContext: row.triggerContext,
      conflictDetected: row.conflictDetected,
      resolvedVia: row.resolvedVia,
      decisionReason: row.decisionReason,
      occurredAt: row.occurredAt
    }));

    return ok({ conflicts, nextCursor });
  });
};
