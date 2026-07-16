import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { listDomainEvents } from "../../../../../modules/domain-event-runtime/application/domain-event-directory";

const READ_GUARD = {
  moduleKey: "domain_event_runtime",
  activityCode: "events",
  action: "read" as const
};

/** `GET /api/v1/domain-events/events?eventType=&aggregateType=&aggregateId=` — bounded list (max 200), redacted payload projections only. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
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

    const events = await listDomainEvents(tx, tenantId, {
      eventType: url.searchParams.get("eventType") ?? undefined,
      aggregateType: url.searchParams.get("aggregateType") ?? undefined,
      aggregateId: url.searchParams.get("aggregateId") ?? undefined
    });

    return ok({ events });
  });
};
