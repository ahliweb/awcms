import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { resolveActiveSession } from "../../../../../modules/identity-access/application/session-lookup";
import { resolveAuthInputs } from "../../../../../modules/identity-access/application/access-guard";
import { getMfaStatus } from "../../../../../modules/identity-access/application/mfa";

/**
 * `GET /api/v1/auth/mfa/status` (Issue #184) — the current identity's own MFA
 * enrollment state. Not gated on `AUTH_MFA_ENABLED`: it must still report an
 * existing factor even if an operator later turned the enrollment feature off.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const session = await resolveActiveSession(tx, tenantId, tokenHash, now);

    if (!session) {
      return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
    }

    const status = await getMfaStatus(tx, tenantId, session.identity_id);

    return ok(status);
  });
};
