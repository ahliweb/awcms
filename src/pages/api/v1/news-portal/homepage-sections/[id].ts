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
  fetchHomepageSectionById,
  softDeleteHomepageSection,
  updateHomepageSection
} from "../../../../../modules/news-portal/application/homepage-section-directory";
import { validateHomepageSectionReferences } from "../../../../../modules/news-portal/application/homepage-section-reference-validation";
import { publicContentPortAdapter } from "../../../../../modules/blog-content/application/public-content-port-adapter";
import { validateUpdateHomepageSectionInput } from "../../../../../modules/news-portal/domain/homepage-section-policy";
import { validateDeleteReasonInput } from "../../../../../modules/blog-content/domain/content-validation";

const CONFIGURE_GUARD = {
  moduleKey: "news_portal",
  activityCode: "homepage_sections",
  action: "configure" as const
};

/** `PATCH /api/v1/news-portal/homepage-sections/{id}` (Issue #637) — partial update; `sortOrder` is how an admin reorders sections (no separate bulk-reorder endpoint, same "just another patchable field" convention `widget-directory.ts`'s `updateWidget` uses). `sectionType` is immutable — see `homepage-section-policy.ts`. */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Homepage section id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<Record<string, unknown>>(
    request,
    "large"
  );

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
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

    const existing = await fetchHomepageSectionById(tx, tenantId, id);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Homepage section not found.");
    }

    const validation = validateUpdateHomepageSectionInput(
      body,
      existing.sectionType
    );

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Homepage section update is invalid.",
        {},
        validation.errors
      );
    }

    const input = validation.value;

    if (input.config) {
      const referenceValidation = await validateHomepageSectionReferences(
        tx,
        tenantId,
        existing.sectionType,
        input.config,
        publicContentPortAdapter
      );

      if (!referenceValidation.valid) {
        return fail(
          422,
          "HOMEPAGE_SECTION_REFERENCE_INVALID",
          "Homepage section references invalid or inaccessible content.",
          {},
          referenceValidation.errors
        );
      }
    }

    const updated = await updateHomepageSection(tx, tenantId, id, input);

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Homepage section not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "news_portal",
      action: "news_portal.homepage_section.updated",
      resourceType: "news_portal_homepage_section",
      resourceId: id,
      severity: "info",
      message: `Homepage section updated: ${updated.sectionKey}.`,
      correlationId
    });

    log("info", "news-portal.homepage_section.updated", {
      correlationId,
      tenantId,
      moduleKey: "news_portal",
      sectionId: id
    });

    return ok(updated);
  });
};

/** `DELETE /api/v1/news-portal/homepage-sections/{id}` (Issue #637) — soft-delete. `reason` required, same convention every other soft-deletable resource in this repo uses. */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Homepage section id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateDeleteReasonInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "reason is required.",
      {},
      validation.errors
    );
  }

  const { reason } = validation.value;
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

    const existing = await fetchHomepageSectionById(tx, tenantId, id);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Homepage section not found.");
    }

    await softDeleteHomepageSection(
      tx,
      tenantId,
      auth.context.tenantUserId,
      id,
      reason
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "news_portal",
      action: "news_portal.homepage_section.deleted",
      resourceType: "news_portal_homepage_section",
      resourceId: id,
      severity: "warning",
      message: "Homepage section deleted.",
      attributes: { reason },
      correlationId
    });

    log("info", "news-portal.homepage_section.deleted", {
      correlationId,
      tenantId,
      moduleKey: "news_portal",
      sectionId: id
    });

    return ok({ id, deleted: true });
  });
};
