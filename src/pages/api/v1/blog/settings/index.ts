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
  fetchBlogSettings,
  upsertBlogSettings
} from "../../../../../modules/blog-content/application/blog-settings-directory";
import { validateUpdateBlogSettingsInput } from "../../../../../modules/blog-content/domain/blog-settings-policy";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "settings",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "settings",
  action: "configure" as const
};

/** `GET /api/v1/blog/settings` (Issue #543) — this tenant's blog settings, falling back to schema/domain defaults when never configured. Permission `blog_content.settings.read` was seeded by migration 027 (Issue #537) but had no route consuming it until now. */
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

    const settings = await fetchBlogSettings(tx, tenantId);

    return ok(settings);
  });
};

/** `PATCH /api/v1/blog/settings` (Issue #543) — partial-update upsert, no `id` param (one row per tenant, same convention `PATCH /api/v1/blog/theme` uses). Publishes `blog-content.settings.updated`, closing the gap the Issue #541 AsyncAPI channel left reserved-but-producer-less. */
export const PATCH: APIRoute = async ({ request, cookies, locals }) => {
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

  const validation = validateUpdateBlogSettingsInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Blog settings are invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
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

    const settings = await upsertBlogSettings(tx, tenantId, input);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.settings.updated",
      resourceType: "blog_settings",
      severity: "info",
      message: "Blog settings updated.",
      correlationId
    });

    log("info", "blog-content.settings.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content"
    });

    return ok(settings);
  });
};
