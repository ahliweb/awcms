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
  createBlogTerm,
  listBlogTerms
} from "../../../../../modules/blog-content/application/blog-taxonomy-directory";
import { validateCreateBlogTermInput } from "../../../../../modules/blog-content/domain/blog-term-validation";
import { isTaxonomyType } from "../../../../../modules/blog-content/domain/taxonomy-policy";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "taxonomies",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "taxonomies",
  action: "configure" as const
};

/** `GET /api/v1/blog/terms` (Issue #539) — list this tenant's non-deleted categories/tags, `?taxonomyType=` optional filter. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const taxonomyTypeParam = url.searchParams.get("taxonomyType");

  if (taxonomyTypeParam !== null && !isTaxonomyType(taxonomyTypeParam)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "taxonomyType must be one of category, tag."
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

    const terms = await listBlogTerms(tx, tenantId, {
      taxonomyType: taxonomyTypeParam ?? undefined
    });

    return ok({ terms });
  });
};

/** `POST /api/v1/blog/terms` (Issue #539) — create a category or tag. Not idempotent — a retry duplicating a create is caught by the `(tenant_id, taxonomy_type, slug)` partial unique index. */
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

  const validation = validateCreateBlogTermInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Blog term is invalid.",
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

    if (input.parentId) {
      const parentRows = await tx`
        SELECT taxonomy_type FROM awcms_blog_terms
        WHERE tenant_id = ${tenantId} AND id = ${input.parentId} AND deleted_at IS NULL
      `;

      if (parentRows.length === 0) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "parentId does not reference an existing term."
        );
      }
    }

    let term;

    try {
      term = await createBlogTerm(tx, tenantId, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_blog_terms_slug_dedup")) {
        return fail(
          409,
          "SLUG_CONFLICT",
          `A ${input.taxonomyType} already exists for slug "${input.slug}".`
        );
      }

      if (message.includes("awcms_blog_terms_tag_no_parent_check")) {
        return fail(400, "VALIDATION_ERROR", "A tag must not have a parentId.");
      }

      throw error;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.term.created",
      resourceType: "blog_term",
      resourceId: term.id,
      severity: "info",
      message: `Blog term created: ${term.slug}.`,
      correlationId
    });

    log("info", "blog-content.term.created", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      termId: term.id,
      slug: term.slug
    });

    return ok(term);
  });
};
