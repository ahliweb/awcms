import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  serializeThemeTokensCss,
  validateThemeConfig
} from "../../../../modules/theming/domain/theme-config";
import { getThemeDescriptor } from "../../../../modules/theming/theme-registry";
import {
  THEMING_CONFIG_ACTIVITY_CODE,
  THEMING_MODULE_KEY
} from "../../../../modules/theming/domain/theme-permissions";

/**
 * `POST /api/v1/theming/validate` (Issue #269, ADR-0029 §4/§5) — read-only dry
 * run: validate a proposed theme config against its theme descriptor (the same
 * CSS-injection spine + declared-surface bounding the draft PUT applies) and, when
 * valid, return the exact `text/css` custom-property block it would produce —
 * writing nothing. ABAC-gated (`theming.config.read`). No idempotency (no write).
 */
const READ_GUARD = {
  moduleKey: THEMING_MODULE_KEY,
  activityCode: THEMING_CONFIG_ACTIVITY_CODE,
  action: "read" as const
};

export const POST: APIRoute = async ({ request, cookies }) => {
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

  const rawBody = bodyRead.value as { themeKey?: unknown } | null;
  const themeKey =
    typeof rawBody?.themeKey === "string" ? rawBody.themeKey : null;
  if (!themeKey) {
    return fail(400, "VALIDATION_ERROR", "A themeKey string is required.");
  }
  const descriptor = getThemeDescriptor(themeKey);
  if (!descriptor) {
    return fail(
      400,
      "UNKNOWN_THEME",
      `Theme "${themeKey}" is not a registered theme.`
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

    const validation = validateThemeConfig(descriptor, bodyRead.value);
    if (!validation.ok) {
      return ok({ valid: false, errors: validation.errors, previewCss: null });
    }

    // Safe by construction: only a validated config reaches the serializer, which
    // re-validates every token value before emitting it.
    const previewCss = serializeThemeTokensCss(descriptor, validation.value);
    return ok({ valid: true, errors: [], previewCss });
  });
};
