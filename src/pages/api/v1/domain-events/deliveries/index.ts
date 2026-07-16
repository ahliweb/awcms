import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { listDomainEventDeliveries } from "../../../../../modules/domain-event-runtime/application/domain-event-directory";

const READ_GUARD = {
  moduleKey: "domain_event_runtime",
  activityCode: "deliveries",
  action: "read" as const
};

const VALID_STATUSES = new Set([
  "pending",
  "delivered",
  "dead_letter",
  "skipped"
]);

/** `GET /api/v1/domain-events/deliveries?status=&consumerName=&eventType=` — `status=dead_letter` is the DLQ inspection view. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const statusParam = url.searchParams.get("status") ?? undefined;

  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "status is not a recognized delivery status."
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

    if (!auth.allowed) {
      return auth.denied;
    }

    const deliveries = await listDomainEventDeliveries(tx, tenantId, {
      status: statusParam,
      consumerName: url.searchParams.get("consumerName") ?? undefined,
      eventType: url.searchParams.get("eventType") ?? undefined
    });

    return ok({ deliveries });
  });
};
