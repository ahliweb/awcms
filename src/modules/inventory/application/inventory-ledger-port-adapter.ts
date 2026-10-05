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
