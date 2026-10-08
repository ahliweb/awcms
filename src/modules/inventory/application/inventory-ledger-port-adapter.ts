/**
 * Concrete `InventoryLedgerPort` (Issue #887, ADR-0126, ADR-0011) — the seam a
 * consumer module is wired to at ITS composition root.
 *
 * Deliberately thin: it validates with the same validators the HTTP surface
 * uses (so an in-process caller cannot post what an HTTP caller could not), then
 * delegates to the one posting core. There is no second write path to the
 * ledger, which is what keeps "no balance a client can assert" true for an
 * in-process consumer as well.
 */
import type {
  InventoryLedgerPort,
  InventoryPostOutcome,
  InventoryPostRequest,
  InventoryTransferRequest
} from "../../_shared/ports/inventory-ledger-port";
import {
  validatePostMovementInput,
  validateTransferInput,
  type PostMovementInput,
  type TransferInput
} from "../domain/inventory-validation";
import type { PostableMovementType } from "../domain/inventory-types";
import {
  postMovement,
  postTransfer,
  type PostResult
} from "./inventory-ledger";
import { canonicalQuantity } from "./inventory-rows";
import {
  UUID_PATTERN,
  decodeBalanceCursor,
  encodeBalanceCursor
} from "./inventory-balance-directory";

const LIST_BALANCES_DEFAULT_LIMIT = 100;
const LIST_BALANCES_MAX_LIMIT = 500;
/** Item-type character set (same as the posting validator) — a prefix is a prefix of one. */
const ITEM_TYPE_PREFIX_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

/** Thrown for a request the validators refuse — a programming error in the consumer, not a business refusal. */
export class InventoryPortRequestError extends Error {
  readonly errors: { field: string; message: string }[];

  constructor(errors: { field: string; message: string }[]) {
    super(
      `Invalid inventory request: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`
    );
    this.name = "InventoryPortRequestError";
    this.errors = errors;
  }
}

function toInput(
  movementType: PostableMovementType,
  request: InventoryPostRequest
): PostMovementInput {
  const validation = validatePostMovementInput({
    locationId: request.locationId,
    itemType: request.itemType,
    itemRef: request.itemRef,
    unitCode: request.unitCode,
    movementType,
    quantity: request.quantity,
    source: {
      type: request.source.type,
      id: request.source.id,
      line: request.source.line
    },
    occurredAt: request.occurredAt?.toISOString(),
    reasonCode: request.reasonCode,
    note: request.note
  });

  if (!validation.valid) {
    throw new InventoryPortRequestError(validation.errors);
  }

  return validation.value;
}

function toTransferInput(request: InventoryTransferRequest): TransferInput {
  const validation = validateTransferInput({
    fromLocationId: request.fromLocationId,
    toLocationId: request.toLocationId,
    itemType: request.itemType,
    itemRef: request.itemRef,
    unitCode: request.unitCode,
    quantity: request.quantity,
    source: {
      type: request.source.type,
      id: request.source.id,
      line: request.source.line
    },
    occurredAt: request.occurredAt?.toISOString(),
    reasonCode: request.reasonCode,
    note: request.note
  });

  if (!validation.valid) {
    throw new InventoryPortRequestError(validation.errors);
  }

  return validation.value;
}

function toOutcome(result: PostResult): InventoryPostOutcome {
  switch (result.outcome) {
    case "posted":
    case "replayed":
      return {
        outcome: result.outcome,
        movements: result.movements.map((movement) => ({
          id: movement.id,
          locationId: movement.locationId,
          movementType: movement.movementType,
          quantityDelta: movement.quantityDelta,
          balanceAfter: movement.balanceAfter
        }))
      };
    case "insufficient_stock":
      return {
        outcome: "insufficient_stock",
        locationId: result.locationId,
        onHand: result.onHand
      };
    case "unit_mismatch":
      return {
        outcome: "unit_mismatch",
        locationId: result.locationId,
        expectedUnitCode: result.expectedUnitCode
      };
    case "quantity_out_of_range":
      return {
        outcome: "quantity_out_of_range",
        locationId: result.locationId
      };
    case "location_not_found":
    case "location_inactive":
      return { outcome: result.outcome, locationId: result.locationId };
    default:
      // `opening_not_first`, `target_not_found` and `not_reversible` cannot
      // arise from the operations this port exposes; `source_conflict`
      // is the only remaining refusal.
      return { outcome: "source_conflict" };
  }
}

function post(
  movementType: PostableMovementType
): InventoryLedgerPort["postSale"] {
  return async (tx, tenantId, actorTenantUserId, request) =>
    toOutcome(
      await postMovement(tx, tenantId, toInput(movementType, request), {
        actorTenantUserId,
        correlationId: request.correlationId
      })
    );
}

export const inventoryLedgerPortAdapter: InventoryLedgerPort = {
  postSale: post("sale"),
  postSaleReturn: post("sale_return"),
  postReceipt: post("receive"),
  postSupplierReturn: post("supplier_return"),

  async postTransfer(tx, tenantId, actorTenantUserId, request) {
    return toOutcome(
      await postTransfer(tx, tenantId, toTransferInput(request), {
        actorTenantUserId,
        correlationId: request.correlationId
      })
    );
  },

  async listBalances(tx, tenantId, query) {
    const errors: { field: string; message: string }[] = [];
    const limit = query.limit ?? LIST_BALANCES_DEFAULT_LIMIT;

    if (
      typeof query.locationId !== "string" ||
      !UUID_PATTERN.test(query.locationId)
    ) {
      errors.push({ field: "locationId", message: "must be a UUID" });
    }

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > LIST_BALANCES_MAX_LIMIT
    ) {
      errors.push({
        field: "limit",
        message: `must be an integer between 1 and ${LIST_BALANCES_MAX_LIMIT}`
      });
    }

    if (
      query.itemTypePrefix !== undefined &&
      !ITEM_TYPE_PREFIX_PATTERN.test(query.itemTypePrefix)
    ) {
      errors.push({
        field: "itemTypePrefix",
        message: "must be a prefix of a valid item type"
      });
    }

    let cursor: ReturnType<typeof decodeBalanceCursor> = null;

    if (query.after !== undefined) {
      cursor = decodeBalanceCursor(query.after);

      if (
        !cursor ||
        cursor.locationId.toLowerCase() !== query.locationId?.toLowerCase?.()
      ) {
        errors.push({
          field: "after",
          message: "is not a cursor issued for this location"
        });
      }
    }

    if (errors.length > 0) {
      throw new InventoryPortRequestError(errors);
    }

    const prefix = query.itemTypePrefix ?? null;
    const nonZeroOnly = query.nonZeroOnly === true;
    // No cursor = ('', ''): an item type starts with [a-z], so '' precedes
    // every row. Keeping the comparison unconditional (no `IS NULL OR`) and
    // led by location_id makes it an Index Cond on the balances primary key
    // even under a generic plan; as an OR'd Filter, each page would re-walk
    // every earlier row of the location — quadratic over a full sweep.
    const afterType = cursor?.itemType ?? "";
    const afterRef = cursor?.itemRef ?? "";

    const rows = (await tx`
      SELECT item_type, item_ref, unit_code, on_hand::text AS on_hand
      FROM awcms_inventory_balances
      WHERE tenant_id = ${tenantId} AND location_id = ${query.locationId}
        AND (${prefix}::text IS NULL OR starts_with(item_type, ${prefix}::text))
        AND (${nonZeroOnly}::boolean = false OR on_hand <> 0)
        AND (location_id, item_type, item_ref)
            > (${query.locationId}::uuid, ${afterType}::text, ${afterRef}::text)
      ORDER BY item_type, item_ref
      LIMIT ${limit + 1}
    `) as {
      item_type: string;
      item_ref: string;
      unit_code: string;
      on_hand: string;
    }[];

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        itemType: row.item_type,
        itemRef: row.item_ref,
        unitCode: row.unit_code,
        onHand: canonicalQuantity(row.on_hand)
      })),
      next:
        rows.length > limit && last
          ? encodeBalanceCursor({
              locationId: query.locationId,
              itemType: last.item_type,
              itemRef: last.item_ref
            })
          : null
    };
  },

  async getOnHand(tx, tenantId, locationId, item) {
    const rows = (await tx`
      SELECT on_hand::text AS on_hand
      FROM awcms_inventory_balances
      WHERE tenant_id = ${tenantId} AND location_id = ${locationId}
        AND item_type = ${item.itemType} AND item_ref = ${item.itemRef}
    `) as { on_hand: string }[];

    return rows[0] ? canonicalQuantity(rows[0].on_hand) : "0";
  }
};
