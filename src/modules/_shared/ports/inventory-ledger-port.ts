/**
 * `InventoryLedgerPort` — the consumer adapter contract of the stock ledger
 * (Issue #887, ADR-0126, ADR-0011).
 *
 * A commerce, POS or storefront module that wants the ledger as its inventory
 * AUTHORITY depends on THIS type, never on `inventory`'s `application/` or
 * `domain/` code. It lives in neutral ground (`_shared`, importing nothing from
 * any module) for the reason every sibling port documents: importing the
 * ledger's code from a consumer's tree would make the consumer depend on the
 * ledger's internals and, the day the ledger needs something from the consumer,
 * complete a cycle the boundary gate forbids.
 *
 * ## What the consumer owns, and what it must NOT do
 *
 * The consumer owns the CATALOGUE. The ledger is handed an opaque
 * `(itemType, itemRef)` and never looks it up — there is deliberately no foreign
 * key to any product table. That is a division of duty, not a convenience:
 *
 *   - the consumer decides what an `itemRef` names (a variant id, a SKU, a
 *     bundle component) and keeps it stable;
 *   - the consumer owns the STOCK UNIT of each item and passes the same
 *     `unitCode` every time — the ledger refuses a mismatch rather than
 *     converting;
 *   - the consumer MUST NOT keep a second writable counter. A counter on the
 *     product row that is decremented directly and ALSO posted here is two
 *     sources of truth, and reconciliation will say so. The migration path
 *     (expand -> backfill -> reconcile -> contract) is in
 *     `docs/awcms/inventory-ledger.md`.
 *   - every call carries a `source` identity: the business document behind the
 *     movement. Posting the same identity twice returns the ORIGINAL result, so a
 *     consumer may retry a timed-out call without a double decrement.
 *
 * ## The composition root authorizes and audits — the port does not
 *
 * Calling the adapter performs NO access check and writes NO audit row: it is
 * the ledger's posting core behind a typed seam, and a typed seam is not a
 * chokepoint. The consumer's composition root (its route handler, its job) MUST
 * authorize the actor against ITS OWN permission for the business action — "may
 * this person ring up a sale" — through `authorizeInTransaction` BEFORE calling
 * it, and MUST audit that business action. The adapter takes
 * `actorTenantUserId` so the ledger row records WHO, and an optional
 * `correlationId` on the request so the ledger row carries the SAME correlation
 * id as the consumer's audit row — pass the request's id through, or the two
 * halves of one business action cannot be joined. A consumer that calls the
 * adapter from an unauthenticated path has handed an anonymous caller write
 * access to stock.
 *
 * ## The ledger trusts your `source`
 *
 * It can prove a source identity was not posted twice; it cannot prove the
 * document exists or that the quantity matches it. Checking that the order,
 * receipt or return named by `source` is real, and belongs to the tenant and the
 * actor, is the consumer's duty and is not repeated here.
 *
 * ## Transactions
 *
 * `tx` is the CALLER's tenant-scoped transaction (`withTenant`'s callback). The
 * ledger writes inside it, so "decrement stock" and "record the order line" can
 * commit together. The port performs plain database writes only — no provider
 * call (ADR-0006).
 *
 * ## The result is a refusal, not an exception
 *
 * A business refusal (`insufficient_stock`, `unit_mismatch`, …) is a RETURNED
 * outcome, because a caller inside a request handler needs to decide whether a
 * refusal rolls the whole order back — and a thrown error would roll back
 * without asking. NOTE the converse hazard: a handler that RETURNS a 4xx
 * `Response` after the port reported a refusal still COMMITS the transaction.
 * Since a refused post writes nothing, that is safe for the ledger — but a
 * consumer that already wrote its own rows must throw to undo them.
 */

export type InventoryItemRef = {
  /** Lower-case namespace the consumer chose, e.g. `commerce.variant`. */
  itemType: string;
  /** Opaque, stable reference. `A-Za-z0-9_.:-` only, at most 200 characters. */
  itemRef: string;
  /** The item's single stock unit. Defaults to `unit`. */
  unitCode?: string;
};

export type InventorySourceIdentity = {
  type: string;
  id: string;
  /** `''`/omitted when the source has no lines. */
  line?: string;
};

export type InventoryPostRequest = InventoryItemRef & {
  locationId: string;
  /** Strictly positive decimal text; the movement type decides direction. */
  quantity: string;
  source: InventorySourceIdentity;
  occurredAt?: Date;
  reasonCode?: string;
  note?: string;
  /** The request's correlation id; stored on the movement. Pass it through. */
  correlationId?: string;
};

/**
 * A location-to-location transfer of ONE item: a balanced out/in pair posted
 * atomically (ADR-0126 §5). Added for `procurement` (ADR-0128) — requisitions and
 * transfers are documents a consumer verifies and then posts through here.
 */
export type InventoryTransferRequest = InventoryItemRef & {
  fromLocationId: string;
  toLocationId: string;
  /** Strictly positive decimal text. */
  quantity: string;
  source: InventorySourceIdentity;
  occurredAt?: Date;
  reasonCode?: string;
  note?: string;
  correlationId?: string;
};

export type InventoryPostedMovement = {
  id: string;
  locationId: string;
  movementType: string;
  quantityDelta: string;
  balanceAfter: string;
};

export type InventoryPostOutcome =
  | { outcome: "posted" | "replayed"; movements: InventoryPostedMovement[] }
  | { outcome: "insufficient_stock"; locationId: string; onHand: string }
  | { outcome: "unit_mismatch"; locationId: string; expectedUnitCode: string }
  | { outcome: "quantity_out_of_range"; locationId: string }
  | { outcome: "location_not_found" | "location_inactive"; locationId: string }
  | { outcome: "source_conflict" };

export type InventoryListBalancesQuery = {
  locationId: string;
  /** Items whose `itemType` starts with this text (literal match), e.g. `commerce.`. */
  itemTypePrefix?: string;
  /** Omit balances whose on-hand is exactly zero. */
  nonZeroOnly?: boolean;
  /** Opaque `next` cursor of the previous page; bound to the same `locationId`. */
  after?: string;
  /** Page size, 1..500; defaults to 100. */
  limit?: number;
};

export type InventoryBalanceListItem = {
  itemType: string;
  itemRef: string;
  unitCode: string;
  onHand: string;
};

export type InventoryListBalancesResult = {
  items: InventoryBalanceListItem[];
  /** `null` on the last page. */
  next: string | null;
};

export type InventoryLedgerPort = {
  /** Decrement for a sale. `replayed` means this exact line was already posted. */
  postSale(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string | null,
    request: InventoryPostRequest
  ): Promise<InventoryPostOutcome>;

  /** Put stock back for a customer return. */
  postSaleReturn(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string | null,
    request: InventoryPostRequest
  ): Promise<InventoryPostOutcome>;

  /** Stock received from a supplier. */
  postReceipt(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string | null,
    request: InventoryPostRequest
  ): Promise<InventoryPostOutcome>;

  /** Send stock back to a supplier. Decrements; refused when the policy forbids going below zero. */
  postSupplierReturn(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string | null,
    request: InventoryPostRequest
  ): Promise<InventoryPostOutcome>;

  /**
   * Move stock between two locations as a balanced out/in pair, in the caller's
   * transaction. `movements` lists the out leg first.
   */
  postTransfer(
    tx: Bun.SQL,
    tenantId: string,
    actorTenantUserId: string | null,
    request: InventoryTransferRequest
  ): Promise<InventoryPostOutcome>;

  /**
   * Read ONE balance. Returns `"0"` for an item that never moved. This is the
   * only read a consumer needs for an "in stock?" check, and the answer is
   * advisory: stock can change between this call and a later post, which is why
   * the post itself — not this read — is what enforces the negative-stock
   * policy.
   */
  getOnHand(
    tx: Bun.SQL,
    tenantId: string,
    locationId: string,
    item: InventoryItemRef
  ): Promise<string>;

  /**
   * List the balances of ONE location, keyset-paged by `(itemType, itemRef)` on
   * the balances primary key. Read-only and current-balance only: it never
   * returns movement history or `balance_after`. Lets a consumer find items the
   * ledger holds that its own catalogue no longer knows (orphans) without
   * reading the module's tables. Invalid input (non-UUID location, bad limit,
   * malformed or foreign-location cursor, bad prefix) throws
   * `InventoryPortRequestError`.
   */
  listBalances(
    tx: Bun.SQL,
    tenantId: string,
    query: InventoryListBalancesQuery
  ): Promise<InventoryListBalancesResult>;
};
