import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { listConsumerStates } from "../../../../../modules/domain-event-runtime/application/consumer-state-directory";

const READ_GUARD = {
  moduleKey: "domain_event_runtime",
  activityCode: "consumers",
  action: "read" as const
};

/** `GET /api/v1/domain-events/consumers` — the static registry (from source code) plus per-tenant pause state and pending/dead-letter backlog counts (consumer lag/checkpoint + DLQ count). */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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

    const consumers = await listConsumerStates(tx, tenantId);

    return ok({ consumers });
  });
};
