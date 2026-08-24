import { enqueueModuleContentPurge } from "../../../../../lib/edge-cache/content-purge";
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
  fetchBlogTermById,
  softDeleteBlogTerm,
  updateBlogTerm
} from "../../../../../modules/blog-content/application/blog-taxonomy-directory";
import {
  validateSoftDeleteBlogTermInput,
  validateUpdateBlogTermInput
} from "../../../../../modules/blog-content/domain/blog-term-validation";
import { validateTermParent } from "../../../../../modules/blog-content/domain/taxonomy-policy";

const UPDATE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "taxonomies",
  action: "configure" as const
};

const DELETE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "taxonomies",
  action: "configure" as const
};

/** `PATCH /api/v1/blog/terms/{id}` (Issue #539). No dedicated `GET /{id}` route (doc issue #539's Routes section lists list/create/update/delete only). Re-derives the effective `taxonomyType`/`parentId` against the existing row before writing, so `validateTermParent`'s ownership rule is checked against the real post-update state, not just the fields present in this one request body. */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const termId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!termId) {
    return fail(400, "VALIDATION_ERROR", "Term id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateBlogTermInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Blog term update is invalid.",
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
      UPDATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const existing = await fetchBlogTermById(tx, tenantId, termId);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog term not found.");
    }

    const effectiveTaxonomyType = input.taxonomyType ?? existing.taxonomyType;
    const effectiveParentId =
      input.parentId !== undefined ? input.parentId : existing.parentId;
    const ownershipResult = validateTermParent(
      effectiveTaxonomyType,
      termId,
      effectiveParentId
    );

    if (!ownershipResult.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Blog term update is invalid.",
        {},
        ownershipResult.errors
      );
    }

    if (effectiveParentId) {
      const parentRows = await tx`
        SELECT id FROM awcms_blog_terms
        WHERE tenant_id = ${tenantId} AND id = ${effectiveParentId} AND deleted_at IS NULL
      `;

      if (parentRows.length === 0) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "parentId does not reference an existing term."
        );
      }
    }

    let updated;

    try {
      updated = await updateBlogTerm(tx, tenantId, termId, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_blog_terms_slug_dedup")) {
        return fail(
          409,
          "SLUG_CONFLICT",
          `A term already exists for slug "${input.slug}" in this taxonomy type.`
        );
      }

      // See the sibling comment in `terms/index.ts`: matched on the shared
      // `no_parent_check` suffix so the handler spans both the pre- and
      // post-sql/131 constraint names.
      if (message.includes("no_parent_check")) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "A flat taxonomy type (tag, topic) must not have a parentId."
        );
      }

      throw error;
    }

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog term not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.term.updated",
      resourceType: "blog_term",
      resourceId: termId,
      severity: "info",
      message: `Blog term updated: ${updated.slug}.`,
      correlationId
    });

    log("info", "blog-content.term.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      termId,
      slug: updated.slug
    });

    // ADR-0042 §Rule 21 (Issue #628) — renaming a term changes every archive
    // heading and every tag label rendered on a post that carries it.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.term.updated"
    );

    return ok(updated);
  });
};

/** `DELETE /api/v1/blog/terms/{id}` (Issue #539) — soft-delete. `reason` required, same convention as posts/pages. No restore/purge endpoint exists for terms (doc issue #537's permission seed has no `taxonomies.restore`/`.purge`). */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const termId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!termId) {
    return fail(400, "VALIDATION_ERROR", "Term id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateSoftDeleteBlogTermInput(bodyRead.value);

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
      DELETE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

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

    const deleted = await softDeleteBlogTerm(
      tx,
      tenantId,
      auth.context.tenantUserId,
      termId,
      reason
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog term not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.term.deleted",
      resourceType: "blog_term",
      resourceId: termId,
      severity: "warning",
      message: "Blog term deleted.",
      attributes: { reason },
      correlationId
    });

    // ADR-0042 §Rule 21 (Issue #628) — the archive URL stops resolving. Left
    // cached, a deleted category keeps answering 200 from the edge.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.term.deleted"
    );

    return ok({ id: termId, deleted: true });
  });
};
