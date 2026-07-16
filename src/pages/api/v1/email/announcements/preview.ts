import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { previewAnnouncement } from "../../../../../modules/email/application/announcement-directory";
import { validateAnnouncementInput } from "../../../../../modules/email/domain/announcement-validation";

const NOTIFICATION_GUARD = {
  moduleKey: "email",
  activityCode: "notification",
  action: "create" as const
};

const ANNOUNCEMENT_GUARD = {
  moduleKey: "email",
  activityCode: "announcement",
  action: "create" as const
};

/**
 * `POST /api/v1/email/announcements/preview` — dry-run: resolves the same
 * targeting criteria as the real send (Issue #497 §"Require preview/
 * dry-run before high-volume sends") and returns only a recipient COUNT
 * plus a rendered sample using synthetic data — never the actual
 * recipient list/addresses. Guarded by the same two-tier permission the
 * real send uses, so a caller can only preview what it could actually
 * send.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateAnnouncementInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Announcement request is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
  const isBulk = input.target.type === "role" || input.target.type === "tenant";
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      NOTIFICATION_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    if (isBulk) {
      const bulkAuth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        ANNOUNCEMENT_GUARD
      );

      if (!bulkAuth.allowed) {
        return bulkAuth.denied;
      }
    }

    const preview = await previewAnnouncement(
      tx,
      tenantId,
      input.templateKey,
      input.variables,
      input.target,
      input.locale
    );

    if (!preview) {
      return fail(
        404,
        "TEMPLATE_NOT_FOUND",
        `No active template found for templateKey "${input.templateKey}".`
      );
    }

    return ok(preview);
  });
};
