import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  createTemplate,
  listTemplates,
  parseShiftCursor
} from "../../../../../modules/hr-workforce/application/hr-shift-directory";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateCreateTemplate,
  type CreateTemplateInput
} from "../../../../../modules/hr-workforce/domain/hr-shift-validation";

type ListPrepared = { cursor: ReturnType<typeof parseShiftCursor> };

/**
 * `GET /api/v1/hr-workforce/shift-templates` — this tenant's live shift
 * templates, newest first, keyset paginated (`?cursor=`). A template is a
 * pattern and names no person.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const cursorText = url.searchParams.get("cursor");
    const cursor = cursorText ? parseShiftCursor(cursorText) : null;

    return cursorText && !cursor
      ? fail(400, "VALIDATION_ERROR", "cursor is not valid.")
      : { cursor };
  },
  authorize: HR_WORKFORCE_GUARDS.templates.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(await listTemplates(tx, tenantId, prepared.cursor ?? undefined))
});

type CreatePrepared = { idempotencyKey: string; input: CreateTemplateInput };

const SCOPE = "hr_workforce_shift_template_create";

/**
 * `POST /api/v1/hr-workforce/shift-templates` — create a pattern: a local start
 * time, an elapsed duration, an optional single break and an IANA zone. Codes
 * are unique among live templates.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreateTemplate);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.templates.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => {
        const result = await createTemplate(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input
        );

        switch (result.outcome) {
          case "ok":
            return { status: 201, body: result.template };
          case "duplicate_code":
            return fail(
              409,
              "TEMPLATE_CODE_CONFLICT",
              "A shift template with this code already exists."
            );
          case "office_not_found":
            return fail(422, "OFFICE_NOT_FOUND", "Office not found.");
          case "invalid_time_zone":
            return fail(
              422,
              "INVALID_TIME_ZONE",
              "timeZone is not a known IANA zone."
            );
        }
      }
    )
});
