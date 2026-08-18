import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { log } from "../../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  fetchInstitutionById,
  restoreInstitution
} from "../../../../../../modules/blog-content/application/institution-directory";

const RESTORE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "institutions",
  action: "restore"
} as const;

/**
 * `POST /api/v1/blog/institutions/{id}/restore` — bring a soft-deleted
 * institution back, together with the archive of articles still pointing at
 * it.
 *
 * ## Why there is no `Idempotency-Key` here
 *
 * `POST /api/v1/blog/posts/{id}/restore` requires one; this deliberately does
 * not, and the difference is not an oversight. The statement in
 * `restoreInstitution` only matches a row that is *currently* soft-deleted, so
 * a replayed request finds nothing to restore, writes no audit event, and
 * answers 404 — the operation is idempotent by construction rather than by a
 * recorded key. Adding the header would demand a ceremony that guards against
 * a double-effect this endpoint cannot have.
 *
 * ## Why a 409 exists at all
 *
 * `awcms_blog_institutions_slug_dedup` is a PARTIAL unique index: deleting an
 * institution releases its slug. If another institution has taken that slug in
 * the meantime, restoring would violate the index. The directory detects that
 * case explicitly and this handler answers 409 with the reason named, rather
 * than letting a raw constraint violation surface as a 500 — or, worse,
 * answering 404 and sending the operator hunting for a row that is right
 * there.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  authorize: RESTORE_GUARD,
  handler: async ({ tx, tenantId, auth, params, locals }) => {
    const institutionId = params.id;

    if (!institutionId) {
      return fail(400, "VALIDATION_ERROR", "Institution id is required.");
    }

    const correlationId = locals.correlationId;
    const outcome = await restoreInstitution(tx, tenantId, institutionId);

    if (!outcome.restored) {
      if (outcome.slugTaken) {
        return fail(
          409,
          "SLUG_CONFLICT",
          "Another institution now holds this slug. Rename that one, or rename this institution, before restoring it."
        );
      }

      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "No soft-deleted institution with this id."
      );
    }

    const restored = await fetchInstitutionById(tx, tenantId, institutionId);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.institution.restored",
      resourceType: "blog_institution",
      resourceId: institutionId,
      severity: "info",
      message: `Institution restored: ${restored?.slug ?? institutionId}.`,
      correlationId
    });

    log("info", "blog-content.institution.restored", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      institutionId,
      slug: restored?.slug ?? null
    });

    return ok(restored ?? { id: institutionId, restored: true });
  }
});
