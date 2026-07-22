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
import { log } from "../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  fetchBlogThemeSettings,
  upsertBlogThemeSettings
} from "../../../../../modules/blog-content/application/theme-settings-directory";
import { validateUpdateThemeSettingsInput } from "../../../../../modules/blog-content/domain/theme-policy";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "theme",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "theme",
  action: "configure" as const
};

/** `GET /api/v1/blog/theme` (Issue #542) — this tenant's blog theme mode, falling back to `awcms_tenants.default_theme` when no override row exists (`isOverride: false`). */
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

    const settings = await fetchBlogThemeSettings(tx, tenantId);

    return ok(settings);
  });
};

/** `PATCH /api/v1/blog/theme` (Issue #542) — set (or overwrite) this tenant's blog theme override. Upsert, no `id` param — one row per tenant. */
export const PATCH: APIRoute = async ({ request, cookies, locals }) => {
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

  const validation = validateUpdateThemeSettingsInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Theme settings are invalid.",
      {},
      validation.errors
    );
  }

  const { mode } = validation.value;
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
      CONFIGURE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const settings = await upsertBlogThemeSettings(tx, tenantId, mode);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.theme.updated",
      resourceType: "blog_theme_settings",
      severity: "info",
      message: `Blog theme mode set to "${mode}".`,
      correlationId
    });

    log("info", "blog-content.theme.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      mode
    });

    return ok(settings);
  });
};
