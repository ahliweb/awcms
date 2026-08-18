import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { log } from "../../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { purgeInstitution } from "../../../../../../modules/blog-content/application/institution-directory";

const IDEMPOTENCY_SCOPE = "blog_institution_purge";

type Prepared = { idempotencyKey: string };

/**
 * `POST /api/v1/blog/institutions/{id}/purge` — permanently remove a
 * soft-deleted institution and the article links that point at it.
 *
 * ## Why this exists at all
 *
 * Not for tidiness. Without it `awcms_blog_institutions` would have no
 * mechanism that ever removes a row, and `data-lifecycle:table-coverage:check`
 * would have to be answered with an ARGUMENT ("it will not grow much") instead
 * of a MECHANISM. The `BOUNDED_BY_DESIGN` ledger is explicitly capped and its
 * bar is a net shrink, not another argument — correctly, because an
 * expectation about growth is not a retention policy. So the honest way to
 * answer the retention question here was to build the thing that answers it.
 *
 * ## Why it requires a prior soft delete
 *
 * `purgeInstitution` matches only `deleted_at IS NOT NULL`. Purging a live
 * institution would strip the classification from every article naming it with
 * no way back, so the operator has to pass through delete first — the same
 * two-step `canPurgePost`/`canPurgePage` impose, expressed here in the
 * statement's predicate rather than in a status helper because an institution
 * has no status beyond deleted-or-not.
 *
 * ## Why `Idempotency-Key` IS required, when restore's is not
 *
 * Restore is idempotent by construction: a replay matches nothing and answers
 * 404, so there is no second effect to guard. Purge is not. The row is gone
 * after the first call, so a replayed request cannot tell "I already did this"
 * from "somebody else purged a different institution and this id never
 * existed" — and the two deserve different answers. The recorded response is
 * what keeps a retried network call from reading as a 404 mystery.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request }): Prepared | Response => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    return { idempotencyKey };
  },
  authorize: {
    moduleKey: "blog_content",
    activityCode: "institutions",
    action: "purge"
  },
  handler: async ({ tx, tenantId, auth, params, prepared, locals }) => {
    const institutionId = params.id;

    if (!institutionId) {
      return fail(400, "VALIDATION_ERROR", "Institution id is required.");
    }

    const correlationId = locals.correlationId;
    const requestHash = computeRequestHash({ institutionId, action: "purge" });

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

    const result = await purgeInstitution(tx, tenantId, institutionId);

    if (!result.purged) {
      // One answer for "no such institution" and "it is still live". The
      // second is not an oracle worth building: an operator who has the
      // institution in front of them knows which it is, and a caller who does
      // not learns nothing about this tenant's registry either way.
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "No soft-deleted institution with this id. Delete it first, then purge."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.institution.purged",
      resourceType: "blog_institution",
      resourceId: institutionId,
      severity: "critical",
      message: "Institution purged.",
      attributes: { articleLinksRemoved: result.articleLinksRemoved },
      correlationId
    });

    log("info", "blog-content.institution.purged", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      institutionId,
      articleLinksRemoved: result.articleLinksRemoved
    });

    const response = ok({
      id: institutionId,
      status: "purged",
      articleLinksRemoved: result.articleLinksRemoved
    });
    const body = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      body
    );

    return response;
  }
});
