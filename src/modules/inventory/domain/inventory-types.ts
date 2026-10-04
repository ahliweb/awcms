/**
 * Vocabulary of the stock ledger (Issue #887, ADR-0126). Pure — no I/O, no
 * imports — so the validators, the posting code, the OpenAPI schema test and the
 * SQL `CHECK` constraints in `sql/169` all read the same lists.
 */

/** Every movement type the ledger stores. Mirrors the `sql/169` type CHECK. */
export const MOVEMENT_TYPES = [
  "opening",
  "receive",
  "sale",
  "sale_return",
  "supplier_return",
  "transfer_out",
  "transfer_in",
  "adjustment"
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * The types `POST /api/v1/inventory/movements` accepts — the SOURCE-BACKED,
 * caller-attested kinds. Everything else has its own entry point:
 *
 *   - a transfer is TWO movements and a different permission;
 *   - an adjustment is the only type that carries its own sign, and is high-risk;
 *   - an `opening` states a starting quantity out of thin air, with no document a
 *     consumer could point at, so it is posted through `POST /openings` and needs
 *     `movements.adjust`, not `movements.create` (ADR-0126 §2).
 *
 * `reservation`/`hold` are a documented later extension, not a status on this
 * table.
 */
export const POSTABLE_MOVEMENT_TYPES = [
  "receive",
  "sale",
  "sale_return",
  "supplier_return"
] as const;

export type PostableMovementType = (typeof POSTABLE_MOVEMENT_TYPES)[number];

/** What the posting core accepts: the postable kinds plus `opening`. */
export type PostableOrOpeningType = PostableMovementType | "opening";

/**
 * Source types the SERVER owns. A caller-supplied source identity may not use
 * them: `reversal` is the identity every reversal is derived under, and letting a
 * caller squat it would let them pre-claim (and so block) the compensation of
 * an adjustment they know the id of.
 */
export const RESERVED_SOURCE_TYPES: readonly string[] = ["reversal"];

/**
 * The sign each type owns. A request carries a positive quantity and the TYPE
 * decides direction — a client cannot ask for a `sale` that adds stock, and the
 * `sql/169` sign CHECK refuses one even if this layer were bypassed.
 */
export const MOVEMENT_SIGN: Readonly<
  Record<Exclude<MovementType, "adjustment">, 1 | -1>
> = {
  opening: 1,
  receive: 1,
  sale_return: 1,
  transfer_in: 1,
  sale: -1,
  supplier_return: -1,
  transfer_out: -1
};

/** `operation` is the server-derived half of the idempotent source identity. */
export type MovementOperation = MovementType | "reversal";

export const NEGATIVE_STOCK_POLICIES = ["forbid", "allow"] as const;
export type NegativeStockPolicy = (typeof NEGATIVE_STOCK_POLICIES)[number];

/** Used when neither the location nor the tenant has said anything. */
export const DEFAULT_NEGATIVE_STOCK_POLICY: NegativeStockPolicy = "forbid";

export const LOCATION_STATUSES = ["active", "inactive"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

/** The unit a movement carries when the consumer names none. */
export const DEFAULT_UNIT_CODE = "unit";

export function isMovementType(value: unknown): value is MovementType {
  return (
    typeof value === "string" &&
    (MOVEMENT_TYPES as readonly string[]).includes(value)
  );
}

export function isPostableMovementType(
  value: unknown
): value is PostableMovementType {
  return (
    typeof value === "string" &&
    (POSTABLE_MOVEMENT_TYPES as readonly string[]).includes(value)
  );
}

export function isNegativeStockPolicy(
  value: unknown
): value is NegativeStockPolicy {
  return (
    typeof value === "string" &&
    (NEGATIVE_STOCK_POLICIES as readonly string[]).includes(value)
  );
}

export function isLocationStatus(value: unknown): value is LocationStatus {
  return (
    typeof value === "string" &&
    (LOCATION_STATUSES as readonly string[]).includes(value)
  );
}
