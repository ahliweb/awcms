/**
 * The handler bodies of the two block mutations (Issue #1012, ADR-0135 section
 * 4; docs/awcms/booking.md sections 3 and 6): `POST /api/v1/booking/blocks` and
 * `POST /api/v1/booking/blocks/{id}/release`. Each route file still calls
 * `defineTenantRoute` itself (so the route and permission-enforcement scans read
 * the guard where it sits); the identical plumbing is here.
 *
 * ## The order, and why
 *
 *   1. the route has ALREADY authorised the verb (default deny) and validated the
 *      body and the header, before any database work;
 *   2. {@link runIdempotent}: a stored response for this key (and this acting
 *      user and this request) is returned byte for byte, a reused key with a
 *      different request is `409 IDEMPOTENCY_CONFLICT`, and concurrent requests
 *      with one key are serialised by the per-key advisory lock. THIS is what
 *      makes a client that retries after the commit receive its own block again
 *      and not `BLOCK_CONFLICT` naming it (finding N2 of the #940 review): the
 *      exclusion constraint is never the retry mechanism;
 *   3. the service call: a refusal is returned as a value, stored nowhere, and
 *      wrote nothing; a success is stored with its status.
 *
 * Who is told whom a night is taken by: the conflicting reservations (number,
 * status, dates; never a customer reference) are returned only to a caller who
 * ALSO holds `booking.reservations.read` (checked through the one access
 * chokepoint, so ABAC applies). Without it the caller learns that nights are
 * taken, not by whom.
 */
import { fail } from "../../_shared/api-response";
import type { AuthorizedAccess } from "../../_shared/tenant-route";
import { getBlock } from "./booking-block-directory";
import { createBlock, releaseBlock } from "./booking-block-service";
import { runIdempotent } from "./booking-route-support";
import type { CreateBlockInput } from "../domain/booking-stay";

export const BLOCK_CREATE_SCOPE = "booking_block_create";
export const BLOCK_RELEASE_SCOPE = "booking_block_release";

type RouteLocals = { correlationId?: string };

/** The neutral 404: an unknown id and another tenant's id are one answer. */
export function blockNotFound(): Response {
  return fail(404, "BLOCK_NOT_FOUND", "Block not found.");
}

export async function runCreateBlockRoute(
  tx: Bun.TransactionSQL,
  tenantId: string,
  auth: AuthorizedAccess,
  locals: RouteLocals,
  idempotencyKey: string,
  input: CreateBlockInput,
  /** Whether the caller may see WHICH reservations stand in the way. Called only when producing. */
  mayRevealConflicts: () => Promise<boolean>
): Promise<Response> {
  const actor = auth.context.tenantUserId;

  return runIdempotent(
    tx,
    tenantId,
    BLOCK_CREATE_SCOPE,
    idempotencyKey,
    actor,
    input,
    async () => {
      const result = await createBlock(
        tx,
        {
          tenantId,
          actorTenantUserId: actor,
          revealConflicts: await mayRevealConflicts(),
          ...(locals.correlationId
            ? { correlationId: locals.correlationId }
            : {})
        },
        input
      );

      switch (result.outcome) {
        case "invalid":
          return fail(
            400,
            result.errors.some((issue) => issue.code === "STAY_DATES_INVALID")
              ? "STAY_DATES_INVALID"
              : "VALIDATION_ERROR",
            "Request is invalid.",
            {},
            result.errors
          );
        case "refused":
          return fail(
            result.httpStatus,
            result.code,
            result.message,
            {},
            result.conflicts ? { conflicts: result.conflicts } : undefined
          );
        case "ok":
          return {
            status: 201,
            body: {
              block: await getBlock(tx, tenantId, result.block.blockId),
              replayed: false
            }
          };
      }
    }
  );
}

export async function runReleaseBlockRoute(
  tx: Bun.TransactionSQL,
  tenantId: string,
  auth: AuthorizedAccess,
  locals: RouteLocals,
  idempotencyKey: string,
  blockId: string
): Promise<Response> {
  const actor = auth.context.tenantUserId;

  return runIdempotent(
    tx,
    tenantId,
    BLOCK_RELEASE_SCOPE,
    idempotencyKey,
    actor,
    { id: blockId },
    async () => {
      const result = await releaseBlock(
        tx,
        {
          tenantId,
          actorTenantUserId: actor,
          ...(locals.correlationId
            ? { correlationId: locals.correlationId }
            : {})
        },
        blockId
      );

      if (result.outcome === "refused") {
        return blockNotFound();
      }

      return {
        status: 200,
        body: {
          block: await getBlock(tx, tenantId, result.blockId),
          replayed: result.replayed,
          releasedAllocations: result.releasedAllocations
        }
      };
    }
  );
}
