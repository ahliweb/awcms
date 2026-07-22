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
  createHomepageSection,
  listHomepageSections
} from "../../../../../modules/news-portal/application/homepage-section-directory";
import { validateHomepageSectionReferences } from "../../../../../modules/news-portal/application/homepage-section-reference-validation";
import { publicContentPortAdapter } from "../../../../../modules/blog-content/application/public-content-port-adapter";
import { validateCreateHomepageSectionInput } from "../../../../../modules/news-portal/domain/homepage-section-policy";

const READ_GUARD = {
  moduleKey: "news_portal",
  activityCode: "homepage_sections",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "news_portal",
  activityCode: "homepage_sections",
  action: "configure" as const
};

/** `GET /api/v1/news-portal/homepage-sections` (Issue #637) — list this tenant's non-deleted homepage sections (admin view: includes disabled/out-of-schedule rows). */
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

    const sections = await listHomepageSections(tx, tenantId);

    return ok({ sections });
  });
};

/** `POST /api/v1/news-portal/homepage-sections` (Issue #637) — create a homepage section. `config` is validated for shape (domain layer) then for reference existence/tenant-ownership (`validateHomepageSectionReferences`) before the row is written — a request that fails either never creates a partially-written row. Not idempotent. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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
  const validation = validateCreateHomepageSectionInput(body);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Homepage section is invalid.",
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

    const referenceValidation = await validateHomepageSectionReferences(
      tx,
      tenantId,
      input.sectionType,
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

    let section;

    try {
      section = await createHomepageSection(tx, tenantId, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (
        message.includes("awcms_news_portal_homepage_sections_tenant_key_dedup")
      ) {
        return fail(
          409,
          "HOMEPAGE_SECTION_KEY_CONFLICT",
          `sectionKey "${input.sectionKey}" is already in use.`
        );
      }

      throw error;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "news_portal",
      action: "news_portal.homepage_section.created",
      resourceType: "news_portal_homepage_section",
      resourceId: section.id,
      severity: "info",
      message: `Homepage section created: ${section.sectionKey}.`,
      correlationId
    });

    log("info", "news-portal.homepage_section.created", {
      correlationId,
      tenantId,
      moduleKey: "news_portal",
      sectionId: section.id
    });

    return ok(section);
  });
};
