import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/ssr-session";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { resolveOptionalRegisteredAuthor } from "../../../../../modules/comments/application/author-resolution";
import { editCommentWithinWindow } from "../../../../../modules/comments/application/comment-service";
import { withCommentsTenant } from "../../../../../modules/comments/application/public-comments-tenant-resolution";
import { hashRequestSignal } from "../../../../../modules/comments/domain/request-hashing";

/**
 * `PATCH /api/v1/comments/{id}` — edit a comment within its edit window (ADR-0041,
 * ported from awcms-micro Issue #271). Author-bound (registered → session user; anonymous → IP hash);
 * a caller can never edit another author's comment. Body is re-normalized/escaped.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const PATCH: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  params
}) => {
  const commentId = params.id;
  if (!commentId)
    return fail(400, "VALIDATION_ERROR", "Comment id is required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);
  const body = bodyRead.value;
  if (!isRecord(body) || typeof body.body !== "string") {
    return fail(400, "VALIDATION_ERROR", "A `body` string is required.");
  }

  const sql = getDatabaseClient();
  const now = new Date();
  const clientIp = resolveClientIp(request, clientAddress);
  const sessionToken = cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const tokenHash = sessionToken ? hashSessionToken(sessionToken) : null;

  const outcome = await withCommentsTenant(
    sql,
    request,
    async (tx, tenant, settings) => {
      const author = await resolveOptionalRegisteredAuthor(
        tx,
        tenant.tenantId,
        tokenHash,
        now
      );
      return editCommentWithinWindow(
        tx,
        tenant.tenantId,
        commentId,
        {
          userId: author.authorUserId,
          ipHash: hashRequestSignal(tenant.tenantId, clientIp)
        },
        body.body as string,
        settings
      );
    }
  );

  if (
    outcome === null ||
    (outcome && !outcome.ok && outcome.reason === "not_found")
  ) {
    return fail(404, "NOT_FOUND", "Comment not found or not editable.");
  }
  if (!outcome.ok) {
    if (outcome.reason === "window_expired") {
      return fail(
        409,
        "EDIT_WINDOW_EXPIRED",
        "The edit window for this comment has passed."
      );
    }
    return fail(422, "COMMENT_REJECTED", "Your edit could not be accepted.");
  }
  return ok({ bodyHtml: outcome.bodyHtml });
};
