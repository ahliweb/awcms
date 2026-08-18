import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { log } from "../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createInstitution,
  listInstitutions
} from "../../../../../modules/blog-content/application/institution-directory";
import {
  isInstitutionBranch,
  validateCreateInstitutionInput,
  INSTITUTION_BRANCH_LIST,
  type CreateInstitutionInput,
  type InstitutionBranch
} from "../../../../../modules/blog-content/domain/institution-validation";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "institutions",
  action: "read"
} as const;

const CREATE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "institutions",
  action: "create"
} as const;

/**
 * `GET /api/v1/blog/institutions` — list this tenant's non-deleted
 * institutions, `?branch=` optional filter (PRD LenteraKalteng §12.2).
 *
 * The `?branch=` filter is what builds each mega menu (§8.3 legislative,
 * §8.4 executive) in one query rather than by fetching everything and
 * partitioning client-side.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  // Validated in `prepare` so a hand-edited query string costs no connection
  // and no pool slot.
  prepare: ({ url }): InstitutionBranch | undefined | Response => {
    const branchParam = url.searchParams.get("branch");

    if (branchParam === null) {
      return undefined;
    }

    if (!isInstitutionBranch(branchParam)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `branch must be one of ${INSTITUTION_BRANCH_LIST}.`
      );
    }

    return branchParam;
  },
  authorize: READ_GUARD,
  handler: async ({ tx, tenantId, prepared }) => {
    const institutions = await listInstitutions(tx, tenantId, {
      branch: prepared
    });

    return ok({ institutions });
  }
});

/**
 * `POST /api/v1/blog/institutions` — register an institution.
 *
 * Not idempotent, and deliberately so: a retry that duplicates a create is
 * caught by the `awcms_blog_institutions_slug_dedup` partial unique index and
 * answered 409, which is the same protection `POST /api/v1/blog/terms` relies
 * on. An `Idempotency-Key` would add a second mechanism for a conflict the
 * database already refuses.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  prepare: async ({ request }): Promise<CreateInstitutionInput | Response> => {
    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const validation = validateCreateInstitutionInput(bodyRead.value);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Institution is invalid.",
        {},
        validation.errors
      );
    }

    return validation.value;
  },
  authorize: CREATE_GUARD,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const correlationId = locals.correlationId;
    let institution;

    try {
      institution = await createInstitution(tx, tenantId, prepared);
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

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.institution.created",
      resourceType: "blog_institution",
      resourceId: institution.id,
      severity: "info",
      message: `Institution created: ${institution.slug}.`,
      correlationId
    });

    log("info", "blog-content.institution.created", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      institutionId: institution.id,
      slug: institution.slug,
      branch: institution.branch
    });

    return ok(institution);
  }
});
