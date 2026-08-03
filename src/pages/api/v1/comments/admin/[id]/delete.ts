import { recordCounter } from "../../../../../../lib/observability/metrics-port";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { moderateComment } from "../../../../../../modules/comments/application/comment-moderation";
import {
  COMMENTS_MODERATION_ACTIVITY_CODE,
  COMMENTS_MODULE_KEY
} from "../../../../../../modules/comments/domain/comments-permissions";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/comments/admin/{id}/delete` — moderator soft delete (ADR-0058 §B).
 *
 * The half of this module that never shipped. `applyModerationAction` has
 * accepted `"delete"` since ADR-0041, `LEGAL_TRANSITIONS` allows it from all
 * four non-terminal statuses, and the moderation queue can already FILTER on
 * `deleted` — so moderators could see deleted comments without being able to
 * delete one. The only actor who could reach that state was the comment's own
 * author, through `requestCommentDeletion` inside the edit window.
 *
 * ## This is the one irreversible moderator action, and that is deliberate
 *
 * `LEGAL_TRANSITIONS.deleted` is `[]`. Nothing here changes that: recovering a
 * deleted comment stays an operator/database action. ADR-0058 §B accepts the
 * asymmetry because the state was already reachable (so this introduces no new
 * state and no new terminality), it stays non-destructive (row, body text and
 * append-only moderation history all survive — ADR-0041's archive-not-delete
 * model is about the DATA, and the data is kept), and because every other
 * moderator action is reversible and keeps the body in the queue, which leaves
 * no in-band answer for content that must be pulled permanently.
 *
 * `reject` is the reversible neighbour and stays the default choice; `archive`
 * is the one for withdrawing an approved comment with its history intact.
 *
 * Bulk moderation deliberately does NOT gain this action: bulk turns the cost
 * of one mistake from a single comment into a page of the queue, and this
 * mistake cannot be undone in-band.
 *
 * Unlike its `archive`/`restore` siblings, this route is built on
 * `defineTenantRoute` rather than a hand-rolled `withTenant` — those predate
 * the factory and sit in its allow-list; a new route may not join them.
 */
const IDEMPOTENCY_SCOPE = "comments_delete";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Prepared = { idempotencyKey: string; note: string | null };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody(request);
    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const body = bodyRead.value;
    const note =
      isRecord(body) && typeof body.note === "string"
        ? body.note.slice(0, 2000)
        : null;

    return { idempotencyKey, note };
  },
  authorize: {
    moduleKey: COMMENTS_MODULE_KEY,
    activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
    action: "delete"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const commentId = params.id;

    if (!commentId) {
      return fail(400, "VALIDATION_ERROR", "Comment id is required.");
    }

    const correlationId = locals.correlationId;
    const requestHash = computeRequestHash({ commentId, action: "delete" });

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const result = await moderateComment(
      tx,
      tenantId,
      commentId,
      "delete",
      {
        reasonCode: null,
        actorUserId: auth.context.tenantUserId,
        note: prepared.note,
        correlationId
      },
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: COMMENTS_MODULE_KEY,
          action: "comments.moderation.delete",
          resourceType: "comments_comment",
          resourceId: detail.commentId,
          // `warning`, not `info` like archive/restore: this is the only
          // moderator transition with no way back through the API.
          severity: "warning",
          message: "Comment soft-deleted by moderator.",
          attributes: {
            fromStatus: detail.fromStatus,
            toStatus: detail.toStatus
          },
          correlationId
        });
      }
    );

    recordCounter("comments_moderation_actions_total", {
      action: "delete",
      result: result.ok ? "applied" : result.reason
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        return fail(404, "NOT_FOUND", "Comment not found.");
      }

      // The only illegal source is `deleted` itself — every other status can
      // reach it. So this 409 means "already deleted", and saying so is not an
      // oracle: the caller already holds `moderation.delete`, and the queue
      // shows deleted comments to exactly that caller.
      return fail(
        409,
        "ILLEGAL_TRANSITION",
        "That comment is already deleted."
      );
    }

    const successResponse = ok({ commentId, status: result.toStatus });
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      successBody
    );

    return successResponse;
  }
});
