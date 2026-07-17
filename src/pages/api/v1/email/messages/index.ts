import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import {
  fetchEmailMessageEntries,
  type EmailMessageStatus
} from "../../../../../modules/email/application/email-message-directory";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";

const READ_GUARD = {
  moduleKey: "email",
  activityCode: "message",
  action: "read" as const
};

const VALID_STATUS_FILTERS = new Set<EmailMessageStatus>([
  "queued",
  "sending",
  "sent",
  "failed",
  "retry_wait",
  "cancelled",
  "suppressed"
]);

/**
 * `GET /api/v1/email/messages` (Issue #499) — admin-facing email queue
 * diagnostics: queue health, failed messages, retry backlog, all visible to
 * authorized operators (never the raw recipient address, only
 * `to_address_masked`). Mirrors `GET /api/v1/sync/object-queue`.
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const statusParam = url.searchParams.get("status");

  if (
    statusParam !== null &&
    !VALID_STATUS_FILTERS.has(statusParam as EmailMessageStatus)
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "status must be one of queued, sending, sent, failed, retry_wait, cancelled, suppressed."
    );
  }

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
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

    const { messages, nextCursor } = await fetchEmailMessageEntries(
      tx,
      tenantId,
      (statusParam as EmailMessageStatus | null) ?? undefined,
      cursor ?? undefined
    );

    return ok({ messages, nextCursor });
  });
};
