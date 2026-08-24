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
  createBlogTerm,
  listBlogTerms,
  listBlogTermsPage
} from "../../../../../modules/blog-content/application/blog-taxonomy-directory";
import { validateCreateBlogTermInput } from "../../../../../modules/blog-content/domain/blog-term-validation";
import { parseBlogTermListQuery } from "../../../../../modules/blog-content/domain/blog-term-list-query";

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

/**
 * `GET /api/v1/blog/terms` (Issue #539) — list this tenant's non-deleted
 * vocabularies. `?taxonomyType=` optional filter, `?limit=` bounded
 * (default 100, max 200).
 *
 * ## `?order=created_at` and `?cursor=` — a stable traversal (Issue #597)
 *
 * The default ordering is `name ASC`: right for the admin taxonomy screen,
 * and unsound as a keyset key, because renaming a term moves it and a row can
 * cross the page boundary between two requests — skipped, or returned twice,
 * with nothing able to detect it.
 *
 * Until this existed there was no second option, so a caller that needed EVERY
 * term got the alphabetically-first hundred and no signal that more existed.
 * For `category` that is harmless; for `tag` on the 23,906-article archive of
 * Issue #599 it means a site that builds a hundred tag pages out of thousands,
 * green, with every article filed under a later tag linking into a 404.
 *
 * So a caller that needs the whole vocabulary asks for `?order=created_at`,
 * which is immutable, and follows `nextCursor`. Passing `?cursor=` without it
 * is refused rather than quietly honoured — see `blog-term-list-query.ts`.
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const query = parseBlogTermListQuery(url.searchParams);

  if (!query.valid) {
    return fail(400, "VALIDATION_ERROR", query.message);
  }

  const { taxonomyType, limit, stableOrder, cursor } = query.value;

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

    if (stableOrder) {
      const page = await listBlogTermsPage(tx, tenantId, {
        taxonomyType,
        limit,
        cursor
      });

      return ok({ terms: page.items, nextCursor: page.nextCursor });
    }

    const terms = await listBlogTerms(tx, tenantId, { taxonomyType, limit });

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

      // Matched on the shared `no_parent_check` suffix, NOT on either full
      // constraint name. sql/131 renamed
      // `awcms_blog_terms_tag_no_parent_check` ->
      // `awcms_blog_terms_flat_taxonomy_no_parent_check` when `topic` became
      // the second flat vocabulary, and a deployment runs both names in the
      // window between the code rolling out and the migration applying. Pinning
      // either one turns a 400 into a raw 500 for the duration of that window.
      if (message.includes("no_parent_check")) {
        return fail(
          400,
          "VALIDATION_ERROR",
          `A ${input.taxonomyType} must not have a parentId.`
        );
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

    // ADR-0042 §Rule 21 (Issue #628) — `/blog/{code}/category/{slug}` and
    // `/tag/{slug}` resolve the term through `fetchPublicTermBySlug`, and a post
    // detail page lists its terms. A new term is a new archive URL.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.term.created"
    );

    return ok(term);
  });
};
