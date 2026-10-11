import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  createEmployment,
  listEmployments,
  parseEmploymentCursor
} from "../../../../../modules/hr-workforce/application/hr-workforce-directory";
import {
  asUuid,
  badId,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateCreateEmployment,
  type CreateEmploymentInput
} from "../../../../../modules/hr-workforce/domain/hr-workforce-validation";

const IDEMPOTENCY_SCOPE = "hr_workforce_employment_create";

type ListPrepared = {
  state?: "active" | "terminated";
  officeId?: string;
  includeDeleted: boolean;
  mine: boolean;
  cursor: ReturnType<typeof parseEmploymentCursor>;
};

/**
 * `GET /api/v1/hr-workforce/employments` — this tenant's employments, newest
 * first, keyset paginated (`?cursor=`). Each row REFERENCES its person
 * (`profileId`); no name, contact or national id is ever in this response.
 *
 * `?mine=true` answers the caller's OWN employment and needs no permission
 * beyond being linked (an ownership grant, ADR-0063); without it the route needs
 * `hr_workforce.employments.read`. Soft-deleted rows are visible only to someone
 * holding `employments.restore`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const state = url.searchParams.get("state");
    const officeId = url.searchParams.get("officeId");
    const includeDeleted = url.searchParams.get("includeDeleted");
    const mine = url.searchParams.get("mine");
    const cursorText = url.searchParams.get("cursor");

    if (state && state !== "active" && state !== "terminated") {
      return fail(
        400,
        "VALIDATION_ERROR",
        "state must be active or terminated."
      );
    }

    if (officeId && !asUuid(officeId)) {
      return badId("officeId");
    }

    for (const [name, value] of [
      ["includeDeleted", includeDeleted],
      ["mine", mine]
    ] as const) {
      if (value && value !== "true" && value !== "false") {
        return fail(400, "VALIDATION_ERROR", `${name} must be true or false.`);
      }
    }

    const cursor = cursorText ? parseEmploymentCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      state: (state as "active" | "terminated" | null) ?? undefined,
      officeId: officeId ? asUuid(officeId)! : undefined,
      includeDeleted: includeDeleted === "true",
      mine: mine === "true",
      cursor
    };
  },
  ownershipGrant: async ({ prepared }) => ({
    granted: prepared.mine,
    reason: "employee lists their own employment"
  }),
  authorize: HR_WORKFORCE_GUARDS.employments.read,
  handler: async ({ tx, tenantId, prepared, tokenHash, now, auth }) => {
    if (prepared.includeDeleted) {
      const deletedView = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        HR_WORKFORCE_GUARDS.employments.restore
      );

      if (!deletedView.allowed) {
        return deletedView.denied;
      }
    }

    const page = await listEmployments(
      tx,
      tenantId,
      {
        state: prepared.state,
        officeId: prepared.officeId,
        includeDeleted: prepared.includeDeleted,
        ownedByTenantUserId: prepared.mine
          ? auth.context.tenantUserId
          : undefined
      },
      prepared.cursor ?? undefined
    );

    return ok(page);
  }
});

type CreatePrepared = { idempotencyKey: string; input: CreateEmploymentInput };

/**
 * `POST /api/v1/hr-workforce/employments` — create an employment for an
 * existing `profile_identity` party, with its first terms effective on the hire
 * date. One ACTIVE employment per profile and tenant (the database refuses a
 * second); rehire is a new employment after the first is terminated.
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateCreateEmployment);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.employments.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => {
        const result = await createEmployment(
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
            return { status: 201, body: result.employment };
          case "profile_not_found":
            return fail(
              422,
              "PROFILE_NOT_FOUND",
              "profileId does not name an active party in this tenant."
            );
          case "already_employed":
            return fail(
              409,
              "ALREADY_EMPLOYED",
              "This person already has an active employment; terminate it before creating another."
            );
          case "duplicate_employee_no":
            return fail(
              409,
              "EMPLOYEE_NO_CONFLICT",
              "An employment with this employee number already exists."
            );
          case "office_not_found":
            return fail(422, "OFFICE_NOT_FOUND", "Office not found.");
          case "manager_not_found":
            return fail(
              422,
              "MANAGER_NOT_FOUND",
              "managerEmploymentId does not name a live employment in this tenant."
            );
          case "manager_cycle":
            return fail(
              409,
              "MANAGER_CYCLE",
              "That manager would make the reporting chain circular."
            );
          case "manager_depth":
            return fail(
              409,
              "MANAGER_CHAIN_TOO_DEEP",
              "The reporting chain would be deeper than 10 levels."
            );
        }
      }
    )
});
