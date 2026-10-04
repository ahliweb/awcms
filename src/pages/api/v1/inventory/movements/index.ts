import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { postMovement } from "../../../../../modules/inventory/application/inventory-ledger";
import {
  listMovements,
  parseMovementCursor,
  type MovementListFilters
} from "../../../../../modules/inventory/application/inventory-movement-directory";
import {
  asUuid,
  enforceBackdateWindow,
  postedResult,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent,
  toApiMovement
} from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";
import { isMovementType } from "../../../../../modules/inventory/domain/inventory-types";
import {
  validatePostMovementInput,
  type PostMovementInput
} from "../../../../../modules/inventory/domain/inventory-validation";
import type { KeysetCursor } from "../../../../../modules/_shared/keyset-pagination";

const IDEMPOTENCY_SCOPE = "inventory_movement_post";

type ListPrepared = { filters: MovementListFilters; cursor?: KeysetCursor };

/**
 * `GET /api/v1/inventory/movements` — the ledger, newest first, keyset
 * paginated. Filters: `locationId`, `itemType`, `itemRef`, `movementType`,
 * `sourceType`, `sourceId`, `transferId`.
 */
export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const filters: MovementListFilters = {};
    const locationId = url.searchParams.get("locationId");
    const transferId = url.searchParams.get("transferId");
    const movementType = url.searchParams.get("movementType");

    if (locationId !== null) {
      const parsed = asUuid(locationId);

      if (!parsed) {
        return fail(400, "VALIDATION_ERROR", "locationId must be a UUID.");
      }

      filters.locationId = parsed;
    }

    if (transferId !== null) {
      const parsed = asUuid(transferId);

      if (!parsed) {
        return fail(400, "VALIDATION_ERROR", "transferId must be a UUID.");
      }

      filters.transferId = parsed;
    }

    if (movementType !== null) {
      if (!isMovementType(movementType)) {
        return fail(400, "VALIDATION_ERROR", "movementType is not recognised.");
      }

      filters.movementType = movementType;
    }

    for (const key of [
      "itemType",
      "itemRef",
      "sourceType",
      "sourceId"
    ] as const) {
      const value = url.searchParams.get(key);

      if (value !== null) {
        if (value.length === 0 || value.length > 200) {
          return fail(
            400,
            "VALIDATION_ERROR",
            `${key} must be 1-200 characters.`
          );
        }

        filters[key] = value;
      }
    }

    const cursorParam = url.searchParams.get("cursor");

    if (cursorParam === null) {
      return { filters };
    }

    const cursor = parseMovementCursor(cursorParam);

    return cursor
      ? { filters, cursor }
      : fail(400, "VALIDATION_ERROR", "cursor is malformed.");
  },
  authorize: INVENTORY_GUARDS.movements.read,
  handler: async ({ tx, tenantId, prepared }) => {
    const page = await listMovements(
      tx,
      tenantId,
      prepared.filters,
      prepared.cursor
    );

    return ok({
      movements: page.movements.map(toApiMovement),
      nextCursor: page.nextCursor
    });
  }
});

type PostPrepared = { idempotencyKey: string; input: PostMovementInput };

/**
 * `POST /api/v1/inventory/movements` — post ONE source-backed movement:
 * `opening`, `receive`, `sale`, `sale_return` or `supplier_return`. The request
 * carries a positive `quantity`; the type decides direction.
 *
 * Requires `Idempotency-Key` AND a `source` identity. They are different
 * guards: the header deduplicates a retried HTTP request, while the source
 * identity `(type, id, line)` deduplicates the BUSINESS document — the same
 * order line posted twice under two different keys still posts once and the
 * second call returns the original (`replayed: true`).
 *
 * `201` for a new posting, `200` for a replay. There is no field by which a
 * client can state a balance; `onHand`/`balanceAfter` in a body is a 400, and no
 * response carries one.
 *
 * The ledger TRUSTS the `source` identity the caller supplies: it can prove a
 * document was not posted twice, never that the document exists. Verifying that
 * is the consumer's duty (docs/awcms/inventory-ledger.md §6.1) — which is why the
 * kinds with no document at all (`opening`, `adjustment`) are NOT postable here.
 */
export const POST = defineTenantRoute<PostPrepared>({
  workClass: "critical_transaction",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validatePostMovementInput);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: INVENTORY_GUARDS.movements.create,
  handler: async ({ tx, tenantId, auth, prepared, locals, tokenHash, now }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      prepared.input,
      async () => {
        const tooOld = await enforceBackdateWindow(
          tx,
          tenantId,
          tokenHash,
          now,
          prepared.input.occurredAt
        );

        if (tooOld) {
          return tooOld;
        }

        const actor = {
          actorTenantUserId: auth.context.tenantUserId,
          correlationId: locals.correlationId
        };
        const result = await postMovement(tx, tenantId, prepared.input, actor);

        return postedResult(
          tx,
          tenantId,
          actor.actorTenantUserId,
          actor.correlationId,
          result,
          () => ({
            action: `inventory.movement.${prepared.input.movementType}`,
            severity: "info",
            message: `Stock ${prepared.input.movementType} posted.`
          })
        );
      }
    )
});
