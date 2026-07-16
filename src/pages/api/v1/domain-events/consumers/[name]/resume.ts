import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  UnknownDomainEventConsumerError,
  listConsumerStates,
  resumeConsumer
} from "../../../../../../modules/domain-event-runtime/application/consumer-state-directory";

const MANAGE_GUARD = {
  moduleKey: "domain_event_runtime",
  activityCode: "consumers",
  action: "manage" as const
};

/** `POST /api/v1/domain-events/consumers/{name}/resume` — naturally idempotent (same reasoning as `.../pause`), no `Idempotency-Key` required. Still explicitly audited. */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const name = params.name;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!name) {
    return fail(400, "VALIDATION_ERROR", "Consumer name is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      MANAGE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    try {
      await resumeConsumer(
        tx,
        tenantId,
        auth.context.tenantUserId,
        name,
        correlationId
      );
    } catch (error) {
      if (error instanceof UnknownDomainEventConsumerError) {
        return fail(404, "RESOURCE_NOT_FOUND", error.message);
      }

      throw error;
    }

    const consumers = await listConsumerStates(tx, tenantId);
    const consumer = consumers.find((entry) => entry.name === name);

    return ok({ consumer });
  });
};
