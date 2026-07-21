import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { fetchDraftVersion } from "../../../../modules/theming/application/theme-config-directory";
import { createPreviewSession } from "../../../../modules/theming/application/theme-preview-directory";
import {
  buildPreviewUrlToken,
  generatePreviewToken,
  hashPreviewToken,
  resolvePreviewTtlMinutes
} from "../../../../modules/theming/domain/preview-token";
import {
  THEMING_MODULE_KEY,
  THEMING_PREVIEW_ACTIVITY_CODE
} from "../../../../modules/theming/domain/theme-permissions";

/**
 * `POST /api/v1/theming/preview` (Issue #269, ADR-0029 §6) — mint a short-lived,
 * authorized, NON-INDEXABLE preview session for this tenant's current DRAFT theme
 * config. Returns the preview URL (`/theming/preview/{token}`) and its expiry; the
 * raw token is returned ONCE (only its hash is stored). ABAC-gated
 * (`theming.preview.create`), tenant-scoped, audited. Not idempotency-keyed —
 * each preview session is intentionally a distinct, disposable token.
 */
const PREVIEW_GUARD = {
  moduleKey: THEMING_MODULE_KEY,
  activityCode: THEMING_PREVIEW_ACTIVITY_CODE,
  action: "create" as const
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }
  const rawBody = bodyRead.value as { ttlMinutes?: unknown } | null;
  const ttlMinutes = resolvePreviewTtlMinutes(rawBody?.ttlMinutes);

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
      PREVIEW_GUARD
    );
    if (!auth.allowed) {
      return auth.denied;
    }

    const draft = await fetchDraftVersion(tx, tenantId);
    if (!draft) {
      return fail(
        400,
        "NO_DRAFT",
        "No draft theme config to preview — save a draft first."
      );
    }

    const rawToken = generatePreviewToken();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
    const session = await createPreviewSession(
      tx,
      tenantId,
      auth.context.tenantUserId,
      draft.id,
      hashPreviewToken(rawToken),
      expiresAt
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: THEMING_MODULE_KEY,
      action: "theming.preview.create",
      resourceType: "theming_preview_session",
      resourceId: session.id,
      severity: "info",
      message: "Theme preview session created.",
      attributes: {
        themeKey: draft.themeKey,
        expiresAt: expiresAt.toISOString()
      },
      correlationId
    });

    const urlToken = buildPreviewUrlToken(tenantId, rawToken);
    return ok({
      previewUrl: `/theming/preview/${urlToken}`,
      expiresAt: expiresAt.toISOString()
    });
  });
};
