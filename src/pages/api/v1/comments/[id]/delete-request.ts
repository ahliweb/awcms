import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/ssr-session";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { resolveOptionalRegisteredAuthor } from "../../../../../modules/comments/application/author-resolution";
import { requestCommentDeletion } from "../../../../../modules/comments/application/comment-service";
import { withCommentsTenant } from "../../../../../modules/comments/application/public-comments-tenant-resolution";
import { hashRequestSignal } from "../../../../../modules/comments/domain/request-hashing";

/**
 * `POST /api/v1/comments/{id}/delete-request` — an author's request to remove
 * their OWN comment (ADR-0041, ported from awcms-micro Issue #271). Within the edit window it soft-deletes
 * immediately (status `deleted`, row retained); past the window it files a report
 * for a moderator to action, so threading/history stays coherent. Author-bound;
 * always returns a neutral acknowledgement.
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  params
}) => {
  const commentId = params.id;
  if (!commentId)
    return fail(400, "VALIDATION_ERROR", "Comment id is required.");

  const sql = getDatabaseClient();
  const now = new Date();
  const clientIp = resolveClientIp(request, clientAddress);
  const sessionToken = cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const tokenHash = sessionToken ? hashSessionToken(sessionToken) : null;

  const result = await withCommentsTenant(sql, request, async (tx, tenant) => {
    const author = await resolveOptionalRegisteredAuthor(
      tx,
      tenant.tenantId,
      tokenHash,
      now
    );
    return requestCommentDeletion(tx, tenant.tenantId, commentId, {
      userId: author.authorUserId,
      ipHash: hashRequestSignal(tenant.tenantId, clientIp)
    });
  });

  // Neutral: never reveal whether the comment existed or was self-deletable.
  return ok({
    status: "received",
    softDeleted: result?.ok === true ? result.softDeleted : false
  });
};
