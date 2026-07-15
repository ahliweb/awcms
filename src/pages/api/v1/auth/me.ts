import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  extractBearerToken,
  resolveActiveSession
} from "../../../../modules/identity-access/application/session-lookup";

export const GET: APIRoute = async ({ request }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  const token = extractBearerToken(request.headers.get("authorization"));

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const session = await resolveActiveSession(tx, tenantId, tokenHash, now);

    if (!session) {
      return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
    }

    const identityRows = await tx`
      SELECT id, login_identifier, profile_id, status, last_login_at
      FROM awcms_identities
      WHERE tenant_id = ${tenantId} AND id = ${session.identity_id}
    `;
    const identity = identityRows[0] as
      | {
          id: string;
          login_identifier: string;
          profile_id: string;
          status: string;
          last_login_at: Date | null;
        }
      | undefined;

    if (!identity) {
      return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
    }

    return ok({
      identityId: identity.id,
      loginIdentifier: identity.login_identifier,
      profileId: identity.profile_id,
      status: identity.status,
      lastLoginAt: identity.last_login_at
    });
  });
};
