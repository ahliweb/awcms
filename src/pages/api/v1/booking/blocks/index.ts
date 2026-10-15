import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { authorizeInTransaction } from "../../../../../modules/identity-access/application/access-guard";
import {
  listBlocks,
  parseBlockCursor,
  type BlockListFilters
} from "../../../../../modules/booking/application/booking-block-directory";
import { runCreateBlockRoute } from "../../../../../modules/booking/application/booking-block-routes";
import {
  asUuid,
  readIdempotencyKey
} from "../../../../../modules/booking/application/booking-route-support";
import { parseCreateBlockBody } from "../../../../../modules/booking/domain/booking-block-validation";
import { BOOKING_GUARDS } from "../../../../../modules/booking/domain/booking-permissions";
import {
  validateCreateBlock,
  type CreateBlockInput
} from "../../../../../modules/booking/domain/booking-stay";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";

type ListPrepared = {
  filters: BlockListFilters;
  cursor: ReturnType<typeof parseBlockCursor>;
};

/**
 * `GET /api/v1/booking/blocks` -- this tenant's blocks of stay resources, newest
 * first, keyset paginated (`cursor`). Filters: `resourceId`, `unitId`, `status`
 * (`active` | `released`). Gated by `booking.blocks.read`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const resourceId = url.searchParams.get("resourceId");
    const unitId = url.searchParams.get("unitId");
    const status = url.searchParams.get("status");
    const cursorText = url.searchParams.get("cursor");

    if (resourceId && !asUuid(resourceId)) {
      return fail(400, "VALIDATION_ERROR", "resourceId must be a UUID.");
    }

    if (unitId && !asUuid(unitId)) {
      return fail(400, "VALIDATION_ERROR", "unitId must be a UUID.");
    }

    if (status && status !== "active" && status !== "released") {
      return fail(
        400,
        "VALIDATION_ERROR",
        "status must be active or released."
      );
    }

    const cursor = cursorText ? parseBlockCursor(cursorText) : null;

    if (cursorText && !cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not valid.");
    }

    return {
      filters: {
        ...(resourceId ? { resourceId: asUuid(resourceId)! } : {}),
        ...(unitId ? { unitId: asUuid(unitId)! } : {}),
        ...(status ? { status: status as "active" | "released" } : {})
      },
      cursor
    };
  },
  authorize: BOOKING_GUARDS.blocks.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await listBlocks(
        tx,
        tenantId,
        prepared.filters,
        prepared.cursor ?? undefined
      )
    )
});

type CreatePrepared = { idempotencyKey: string; input: CreateBlockInput };

/**
 * `POST /api/v1/booking/blocks` -- take `[fromDate, toDate)` of a STAY resource
 * out of sale: one unit (`unitId`) or every unit (absent or null), for a closed
 * `reasonCode` (`maintenance`, `owner_use`, `other`; never free text). Dates are
 * local dates in the resource's zone, at most 366 nights. A block is a HARD
 * exclusion under the same constraint as a guest's nights: it is all-or-none, it
 * never cancels a reservation, and a night already held by a live stay or another
 * block is `409 BLOCK_CONFLICT` and writes nothing. The conflicting reservations
 * (number, status, dates; never a customer reference) are named in
 * `error.details.conflicts` only to a caller who also holds
 * `booking.reservations.read`. A resource-wide block also covers units added
 * later. Elapsed unswept holds on the covered units are reclaimed first.
 *
 * Gated by `booking.blocks.create` (high-impact: it removes sellable inventory);
 * `Idempotency-Key` required -- a retry returns the SAME response and writes
 * nothing, never `BLOCK_CONFLICT` about its own block; audited `warning`. Emits no
 * domain event in v1 (booking.md section 7.4).
 */
export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    const shape = parseCreateBlockBody(bodyRead.value);
    const issues = shape.valid
      ? validateCreateBlock(shape.value)
      : shape.errors;

    if (!shape.valid || issues.length > 0) {
      return fail(
        400,
        issues.some((issue) => issue.code === "STAY_DATES_INVALID")
          ? "STAY_DATES_INVALID"
          : "VALIDATION_ERROR",
        "Request is invalid.",
        {},
        issues
      );
    }

    return { idempotencyKey, input: shape.value };
  },
  authorize: BOOKING_GUARDS.blocks.create,
  handler: ({
    tx,
    tenantId,
    auth,
    prepared,
    locals,
    tokenHash,
    now,
    request,
    clientAddress
  }) =>
    runCreateBlockRoute(
      tx,
      tenantId,
      auth,
      locals,
      prepared.idempotencyKey,
      prepared.input,
      async () =>
        // Through the one chokepoint (ADR-0063), so ABAC applies; ADR-0092: a
        // hand-written call passes the client IP explicitly.
        (
          await authorizeInTransaction(
            tx,
            tenantId,
            tokenHash,
            now,
            BOOKING_GUARDS.reservations.read,
            { clientIp: resolveClientIp(request, clientAddress) }
          )
        ).allowed
    )
});
