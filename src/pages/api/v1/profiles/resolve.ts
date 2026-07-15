import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { resolveProfileByIdentifier } from "../../../../modules/profile-identity/application/identifier-directory";
import { validateResolveProfileQuery } from "../../../../modules/profile-identity/domain/identifier-validation";

const READ_GUARD = {
  moduleKey: "profile_identity",
  activityCode: "profile_management",
  action: "read" as const
};

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const validation = validateResolveProfileQuery({
    type: url.searchParams.get("type"),
    value: url.searchParams.get("value")
  });

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Resolve query is invalid.",
      {},
      validation.errors
    );
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
    if (!auth.allowed) return auth.denied;

    const profile = await resolveProfileByIdentifier(
      tx,
      tenantId,
      validation.value
    );
    return ok({ profile });
  });
};
