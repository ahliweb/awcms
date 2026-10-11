import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  getTemplate,
  softDeleteTemplate,
  updateTemplate
} from "../../../../../modules/hr-workforce/application/hr-shift-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateUpdateTemplate,
  type UpdateTemplateInput
} from "../../../../../modules/hr-workforce/domain/hr-shift-validation";
import { validateEmptyBody } from "../../../../../modules/hr-workforce/domain/hr-workforce-validation";

type IdPrepared = { id: string };

/** `GET /api/v1/hr-workforce/shift-templates/{id}` — one live template. */
export const GET = defineTenantRoute<IdPrepared>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: HR_WORKFORCE_GUARDS.templates.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const template = await getTemplate(tx, tenantId, prepared.id);

    return template
      ? ok(template)
      : fail(404, "RESOURCE_NOT_FOUND", "Shift template not found.");
  }
});

type UpdatePrepared = { id: string; input: UpdateTemplateInput };

/**
 * `PATCH /api/v1/hr-workforce/shift-templates/{id}` — change a pattern (the code
 * is fixed). Only the keys sent change; `officeId: null`, or both break keys
 * `null`, clear them. Assignments already made are NOT moved: they hold their
 * own resolved instants. The call sets values, so repeating it is harmless and
 * it needs no `Idempotency-Key`.
 */
export const PATCH = defineTenantRoute<UpdatePrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const input = await readValidatedBody(request, validateUpdateTemplate);

    return input instanceof Response ? input : { id, input };
  },
  authorize: HR_WORKFORCE_GUARDS.templates.update,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const result = await updateTemplate(
      tx,
      tenantId,
      prepared.id,
      {
        actorTenantUserId: auth.context.tenantUserId,
        correlationId: locals.correlationId
      },
      prepared.input
    );

    switch (result.outcome) {
      case "ok":
        return ok(result.template);
      case "not_found":
        return fail(404, "RESOURCE_NOT_FOUND", "Shift template not found.");
      case "office_not_found":
        return fail(422, "OFFICE_NOT_FOUND", "Office not found.");
      case "invalid_time_zone":
        return fail(
          422,
          "INVALID_TIME_ZONE",
          "timeZone is not a known IANA zone."
        );
      case "invalid_break":
        return fail(
          422,
          "VALIDATION_ERROR",
          "The break must end within the shift."
        );
    }
  }
});

type DeletePrepared = { id: string; idempotencyKey: string };

const DELETE_SCOPE = "hr_workforce_shift_template_delete";

/**
 * `DELETE /api/v1/hr-workforce/shift-templates/{id}` — SOFT delete; frees the
 * code. Assignments made from it are unaffected. High-risk, audited, idempotent.
 */
export const DELETE = defineTenantRoute<DeletePrepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return badId();
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const body = await readValidatedBody(request, validateEmptyBody);

    return body instanceof Response ? body : { id, idempotencyKey };
  },
  authorize: HR_WORKFORCE_GUARDS.templates.delete,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      DELETE_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      { id: prepared.id },
      async () => {
        const result = await softDeleteTemplate(tx, tenantId, prepared.id, {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        });

        switch (result.outcome) {
          case "ok":
            return { status: 200, body: result.template };
          case "not_found":
            return fail(404, "RESOURCE_NOT_FOUND", "Shift template not found.");
          case "already_deleted":
            return fail(
              409,
              "TEMPLATE_DELETED",
              "The shift template is already deleted."
            );
        }
      }
    )
});
