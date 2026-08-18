import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { log } from "../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  fetchInstitutionById,
  softDeleteInstitution,
  updateInstitution
} from "../../../../../modules/blog-content/application/institution-directory";
import {
  validateSoftDeleteInstitutionInput,
  validateUpdateInstitutionInput,
  type SoftDeleteInstitutionInput,
  type UpdateInstitutionInput
} from "../../../../../modules/blog-content/domain/institution-validation";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "institutions",
  action: "read"
} as const;

const UPDATE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "institutions",
  action: "update"
} as const;

const DELETE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "institutions",
  action: "delete"
} as const;

/**
 * `GET /api/v1/blog/institutions/{id}` — read one institution.
 *
 * Unlike `blog/terms`, which has no `GET /{id}`, this one exists because an
 * institution is an editable resource with seven fields including landing SEO:
 * the admin screen needs the current row to populate an edit form, and
 * re-deriving it by filtering the bounded list is the kind of thing that works
 * until a tenant crosses the list ceiling.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: READ_GUARD,
  handler: async ({ tx, tenantId, params }) => {
    const institutionId = params.id;

    if (!institutionId) {
      return fail(400, "VALIDATION_ERROR", "Institution id is required.");
    }

    const institution = await fetchInstitutionById(tx, tenantId, institutionId);

    if (!institution) {
      return fail(404, "RESOURCE_NOT_FOUND", "Institution not found.");
    }

    return ok(institution);
  }
});

/** `PATCH /api/v1/blog/institutions/{id}` — update; only supplied fields change, an explicit `null` clears. */
export const PATCH = defineTenantRoute({
  workClass: "interactive",
  prepare: async ({ request }): Promise<UpdateInstitutionInput | Response> => {
    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const validation = validateUpdateInstitutionInput(bodyRead.value);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Institution update is invalid.",
        {},
        validation.errors
      );
    }

    return validation.value;
  },
  authorize: UPDATE_GUARD,
  handler: async ({ tx, tenantId, auth, params, prepared, locals }) => {
    const institutionId = params.id;

    if (!institutionId) {
      return fail(400, "VALIDATION_ERROR", "Institution id is required.");
    }

    const correlationId = locals.correlationId;
    let updated;

    try {
      updated = await updateInstitution(tx, tenantId, institutionId, prepared);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_blog_institutions_slug_dedup")) {
        return fail(
          409,
          "SLUG_CONFLICT",
          `An institution already exists for slug "${prepared.slug}".`
        );
      }

      throw error;
    }

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Institution not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.institution.updated",
      resourceType: "blog_institution",
      resourceId: updated.id,
      severity: "info",
      message: `Institution updated: ${updated.slug}.`,
      correlationId
    });

    log("info", "blog-content.institution.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      institutionId: updated.id,
      slug: updated.slug
    });

    return ok(updated);
  }
});

/**
 * `DELETE /api/v1/blog/institutions/{id}` — soft delete, `{ reason }` required.
 *
 * The articles filed against it are NOT touched: their
 * `awcms_blog_post_institutions` rows survive, so restoring the institution
 * restores its archive intact. That is the whole reason the delete is soft —
 * a hard delete would have to choose between orphaning those rows and
 * silently unclassifying every article the body ever appeared in.
 */
export const DELETE = defineTenantRoute({
  workClass: "interactive",
  prepare: async ({
    request
  }): Promise<SoftDeleteInstitutionInput | Response> => {
    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const validation = validateSoftDeleteInstitutionInput(bodyRead.value);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Delete reason is invalid.",
        {},
        validation.errors
      );
    }

    return validation.value;
  },
  authorize: DELETE_GUARD,
  handler: async ({ tx, tenantId, auth, params, prepared, locals }) => {
    const institutionId = params.id;

    if (!institutionId) {
      return fail(400, "VALIDATION_ERROR", "Institution id is required.");
    }

    const correlationId = locals.correlationId;

    // Read before write so the audit event can carry the slug, and so a 404 is
    // distinguishable from a successful delete.
    const existing = await fetchInstitutionById(tx, tenantId, institutionId);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Institution not found.");
    }

    const deleted = await softDeleteInstitution(
      tx,
      tenantId,
      auth.context.tenantUserId,
      institutionId,
      prepared.reason
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Institution not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.institution.deleted",
      resourceType: "blog_institution",
      resourceId: institutionId,
      severity: "warning",
      message: `Institution soft-deleted: ${existing.slug}.`,
      correlationId
    });

    log("info", "blog-content.institution.deleted", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      institutionId,
      slug: existing.slug
    });

    return ok({ id: institutionId, deleted: true });
  }
});
