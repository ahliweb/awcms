import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { fetchPartyById } from "../../../../../modules/profile-identity/application/party-directory";
import { listProfileEntityLinks } from "../../../../../modules/profile-identity/application/identifier-directory";

const READ_GUARD = {
  moduleKey: "profile_identity",
  activityCode: "profile_management",
  action: "read" as const
};

export const GET: APIRoute = async ({ request, params, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const profileId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!profileId)
    return fail(400, "VALIDATION_ERROR", "Profile id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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

    const profile = await fetchPartyById(tx, tenantId, profileId);
    if (!profile) return fail(404, "RESOURCE_NOT_FOUND", "Profile not found.");

    const items = await listProfileEntityLinks(tx, tenantId, profileId);
    return ok({ items });
  });
};
