import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { listNotFoundObservations } from "../../../../../modules/seo-distribution/application/not-found-directory";
import {
  SEO_MODULE_KEY,
  SEO_NOT_FOUND_ACTIVITY_CODE
} from "../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `GET /api/v1/seo/not-found` (ADR-0039) — the privacy-minimized 404/broken-link
 * governance dashboard: top observations by hit count (sanitized path + bare
 * referrer domain only — never full URLs/queries/secrets). `?unresolvedOnly=true`
 * filters to open items. ABAC `seo_distribution.not_found.read`.
 */

const READ_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_NOT_FOUND_ACTIVITY_CODE,
  action: "read" as const
};

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const unresolvedOnly = url.searchParams.get("unresolvedOnly") === "true";

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
    if (!auth.allowed) return auth.denied;

    const observations = await listNotFoundObservations(tx, tenantId, {
      unresolvedOnly
    });
    return ok({ observations });
  });
};
