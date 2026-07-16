import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { readJsonBody } from "../../../../../../lib/security/request-body-limit";
import {
  UnknownDomainEventConsumerError,
  listConsumerStates,
  pauseConsumer
} from "../../../../../../modules/domain-event-runtime/application/consumer-state-directory";

const MANAGE_GUARD = {
  moduleKey: "domain_event_runtime",
  activityCode: "consumers",
  action: "manage" as const
};

const MAX_REASON_LENGTH = 500;

type PauseRequestBody = { reason?: unknown };

/**
 * `POST /api/v1/domain-events/consumers/{name}/pause` — naturally
 * idempotent (setting `is_paused = true` twice has the same end state,
 * unlike `replay`'s "each call does new work" shape), so no
 * `Idempotency-Key` is required — same lighter-weight pattern
 * `enable`/`disable` (module-management) already establishes for
 * reversible, non-destructive toggles. Still explicitly audited.
 */
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

  const bodyRead = await readJsonBody<PauseRequestBody>(request);

  if (bodyRead.tooLarge) {
    return fail(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }

  const reason =
    typeof bodyRead.value?.reason === "string"
      ? bodyRead.value.reason.trim()
      : "";

  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `reason is required and must be 1-${MAX_REASON_LENGTH} characters.`
    );
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
      await pauseConsumer(
        tx,
        tenantId,
        auth.context.tenantUserId,
        name,
        reason,
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
