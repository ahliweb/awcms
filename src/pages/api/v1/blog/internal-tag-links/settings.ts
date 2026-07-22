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
import { resolveBlogAutoInternalTagLinksConfig } from "../../../../../modules/blog-content/domain/internal-tag-linking-config";
import { validateUpdateInternalTagLinkingSettingsInput } from "../../../../../modules/blog-content/domain/internal-tag-linking-policy";
import {
  countExistingTagTermIds,
  fetchInternalTagLinkingSettings,
  upsertInternalTagLinkingSettings
} from "../../../../../modules/blog-content/application/internal-tag-link-settings-directory";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "internal_links",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "internal_links",
  action: "configure" as const
};

/**
 * `GET /api/v1/blog/internal-tag-links/settings` (Issue #641) — effective
 * automatic internal tag linking configuration for this tenant: the
 * deployment-wide `BLOG_AUTO_INTERNAL_TAG_LINKS_*` knobs (read-only from
 * this endpoint's perspective) plus the tenant's own overridable policy
 * (`enabled`, `caseInsensitive`, `disabledTagIds`). Deliberately a
 * dedicated endpoint/permission, NOT folded into `GET /api/v1/blog/settings`
 * — see migration 050's header for why.
 */
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

    const deploymentConfig = resolveBlogAutoInternalTagLinksConfig();
    const tenantSettings = await fetchInternalTagLinkingSettings(tx, tenantId);

    return ok({
      enabled: deploymentConfig.enabled && tenantSettings.enabled,
      deploymentEnabled: deploymentConfig.enabled,
      tenantEnabled: tenantSettings.enabled,
      caseInsensitive: tenantSettings.caseInsensitive,
      disabledTagIds: tenantSettings.disabledTagIds,
      maxPerPost: deploymentConfig.maxPerPost,
      maxPerTag: deploymentConfig.maxPerTag,
      minTermLength: deploymentConfig.minTermLength,
      linkFirstOccurrenceOnly: deploymentConfig.linkFirstOccurrenceOnly,
      excludeHeadings: deploymentConfig.excludeHeadings,
      updatedAt: tenantSettings.updatedAt
    });
  });
};

/**
 * `PATCH /api/v1/blog/internal-tag-links/settings` (Issue #641) — partial
 * update of the tenant-overridable policy only (`enabled`/
 * `caseInsensitive`/`disabledTagIds`). The six deployment-wide
 * `BLOG_AUTO_INTERNAL_TAG_LINKS_*` knobs are environment-only, never
 * writable through this or any endpoint. `disabledTagIds` is verified to
 * reference real, same-tenant, non-deleted, `taxonomy_type = 'tag'` terms
 * before being accepted (cross-tenant/nonexistent/category ids rejected
 * with a 400, never a raw constraint error).
 */
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

  const validation = validateUpdateInternalTagLinkingSettingsInput(
    bodyRead.value
  );

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Internal tag linking settings are invalid.",
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

    if (input.disabledTagIds && input.disabledTagIds.length > 0) {
      const existingCount = await countExistingTagTermIds(
        tx,
        tenantId,
        input.disabledTagIds
      );

      if (existingCount !== input.disabledTagIds.length) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "disabledTagIds contains an id that is not an existing tag for this tenant."
        );
      }
    }

    const settings = await upsertInternalTagLinkingSettings(
      tx,
      tenantId,
      input
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.internal_tag_linking.settings_updated",
      resourceType: "blog_internal_tag_link_settings",
      severity: "info",
      message: "Automatic internal tag linking settings updated.",
      correlationId
    });

    log("info", "blog-content.internal-tag-linking-policy.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content"
    });

    return ok(settings);
  });
};
