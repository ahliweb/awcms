/**
 * The stock ledger against a real PostgreSQL, as the least-privilege runtime
 * role, with FORCE RLS in force (Issue #887, ADR-0126).
 *
 * ## What this proves that unit tests cannot
 *
 * Almost every invariant in this module lives in the interaction between SQL and
 * concurrency, so a test that mocks the database would be asserting the mock:
 *
 *   * "two concurrent attempts on the last unit cannot both succeed" is a
 *     property of row locks and a guarded UPDATE, not of TypeScript;
 *   * "a transfer is a balanced pair" is enforced by a DEFERRED constraint
 *     trigger that only fires at COMMIT;
 *   * "finalised movements are append-only" is a trigger plus a REVOKE, and the
 *     test attacks it from both the runtime role and the table owner;
 *   * "no reference crosses tenants" is a composite foreign key on top of RLS.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected,
  getAdminSql,
  getOwnerSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  postAdjustment,
  postMovement,
  postTransfer,
  reverseAdjustment,
  type PostActor,
  type PostResult
} from "../../src/modules/inventory/application/inventory-ledger";
import {
  listBalances,
  rebuildBalances,
  reconcileBalances,
  setLowStockThreshold
} from "../../src/modules/inventory/application/inventory-balance-directory";
import {
  createLocation,
  setLocationPolicy,
  setTenantPolicy,
  updateLocation
} from "../../src/modules/inventory/application/inventory-location-directory";
import { listMovements } from "../../src/modules/inventory/application/inventory-movement-directory";
import {
  InventoryPortRequestError,
  inventoryLedgerPortAdapter
} from "../../src/modules/inventory/application/inventory-ledger-port-adapter";
import type {
  AdjustmentInput,
  PostMovementInput,
  TransferInput
} from "../../src/modules/inventory/domain/inventory-validation";
import { runIncrementalUpdateForTenant } from "../../src/modules/reporting/application/projection-incremental-worker";
import { getProjectionMetrics } from "../../src/modules/reporting/application/projection-metric-store";
import { reconcileProjection } from "../../src/modules/reporting/application/projection-reconciliation";
import { inventoryModule } from "../../src/modules/inventory/module";
import { listModules } from "../../src/modules";
import { collectProjectionDescriptors } from "../../src/modules/reporting/domain/projection-registry";
import * as harness from "./harness";

const TENANT_A = "a8870000-0000-4000-8000-00000000000a";
const TENANT_B = "a8870000-0000-4000-8000-00000000000b";
const TENANT_PLAN = "a8870000-0000-4000-8000-00000000000c";

const ACTOR: PostActor = {
  actorTenantUserId: null,
  correlationId: "corr-887"
};

const ITEM = {
  itemType: "commerce.variant",
  itemRef: "sku-1",
  unitCode: "unit"
};

let sequence = 0;

/** A fresh, unique source identity per call so tests never collide on replay. */
function nextSource(type = "pos_order") {
  sequence += 1;

  return { sourceType: type, sourceId: `order-${sequence}`, sourceLine: "1" };
}

function movement(
  locationId: string,
  movementType: PostMovementInput["movementType"],
  quantity: string,
  overrides: Partial<PostMovementInput> = {}
): PostMovementInput {
  return {
    locationId,
    ...ITEM,
    movementType,
    quantity,
    source: nextSource(),
    occurredAt: null,
    reasonCode: null,
    note: null,
    ...overrides
  };
}

function adjustment(
  locationId: string,
  quantityDelta: string,
  overrides: Partial<AdjustmentInput> = {}
): AdjustmentInput {
  return {
    locationId,
    ...ITEM,
    quantityDelta,
    source: nextSource("stock_count"),
    occurredAt: null,
    reasonCode: "count_correction",
    note: null,
    ...overrides
  };
}

function transfer(
  from: string,
  to: string,
  quantity: string,
  overrides: Partial<TransferInput> = {}
): TransferInput {
  return {
    fromLocationId: from,
    toLocationId: to,
    ...ITEM,
    quantity,
    source: nextSource("transfer_request"),
    occurredAt: null,
    reasonCode: null,
    note: null,
    ...overrides
  };
}

function inTenant<T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, fn);
}

async function newLocation(tenantId: string, code: string): Promise<string> {
  const result = await inTenant(tenantId, (tx) =>
    createLocation(tx, tenantId, null, { code, name: code, officeId: null })
  );

  if (result.outcome !== "created") {
    throw new Error(`fixture: could not create location ${code}`);
  }

  return result.location.id;
}

async function post(
  tenantId: string,
  input: PostMovementInput
): Promise<PostResult> {
  return inTenant(tenantId, (tx) => postMovement(tx, tenantId, input, ACTOR));
}

function expectPosted(result: PostResult) {
  if (result.outcome !== "posted" && result.outcome !== "replayed") {
    throw new Error(`expected a posted movement, got ${result.outcome}`);
  }

  return result.movements;
}

async function onHand(
  tenantId: string,
  locationId: string,
  itemRef = ITEM.itemRef
): Promise<string> {
  return inTenant(tenantId, async (tx) => {
    const rows = (await tx`
      SELECT on_hand::float8 AS on_hand FROM awcms_inventory_balances
      WHERE tenant_id = ${tenantId} AND location_id = ${locationId}
        AND item_type = ${ITEM.itemType} AND item_ref = ${itemRef}
    `) as { on_hand: number }[];

    return String(rows[0]?.on_hand ?? "none");
  });
}

async function countRows(table: string, tenantId: string): Promise<number> {
  const rows = (await getAdminSql().unsafe(
    `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
    [tenantId]
  )) as { n: number }[];

  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("inventory ledger (Issue #887, ADR-0126)", () => {
  let locA1 = "";
  let locA2 = "";
  let locB1 = "";

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'inv-a', 'Inventory A'),
             (${TENANT_B}, 'inv-b', 'Inventory B'),
             (${TENANT_PLAN}, 'inv-plan', 'Inventory Plan')
    `;
    locA1 = await newLocation(TENANT_A, "main");
    locA2 = await newLocation(TENANT_A, "annex");
    locB1 = await newLocation(TENANT_B, "main");
  });

  describe("posting, balances and idempotent source identity", () => {
    test("receive then sale moves the balance and records balance_after on each movement", async () => {
      const received = expectPosted(
        await post(TENANT_A, movement(locA1, "receive", "10"))
      );
      const sold = expectPosted(
        await post(TENANT_A, movement(locA1, "sale", "3.5"))
      );

      expect(received[0]!.quantityDelta).toBe("10");
      expect(received[0]!.balanceAfter).toBe("10");
      expect(sold[0]!.quantityDelta).toBe("-3.5");
      expect(sold[0]!.balanceAfter).toBe("6.5");
      expect(await onHand(TENANT_A, locA1)).toBe("6.5");
    });

    test("replaying a source identity returns the ORIGINAL movement and posts nothing new", async () => {
      const input = movement(locA1, "receive", "5");
      const first = await post(TENANT_A, input);
      const again = await post(TENANT_A, input);

      expect(first.outcome).toBe("posted");
      expect(again.outcome).toBe("replayed");
      expect(expectPosted(again)[0]!.id).toBe(expectPosted(first)[0]!.id);
      expect(await countRows("awcms_inventory_movements", TENANT_A)).toBe(1);
      expect(await onHand(TENANT_A, locA1)).toBe("5");
    });

    test("the same source identity with a DIFFERENT payload is a conflict, not a replay", async () => {
      const input = movement(locA1, "receive", "5");

      await post(TENANT_A, input);
      const conflicting = await post(TENANT_A, { ...input, quantity: "6" });

      expect(conflicting.outcome).toBe("source_conflict");
      expect(await onHand(TENANT_A, locA1)).toBe("5");
    });

    test("six concurrent requests for ONE source identity post exactly once", async () => {
      await post(TENANT_A, movement(locA1, "receive", "100"));
      const input = movement(locA1, "sale", "1");

      const results = await Promise.all(
        Array.from({ length: 6 }, () => post(TENANT_A, input))
      );

      expect(results.filter((r) => r.outcome === "posted")).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "replayed")).toHaveLength(5);
      expect(await onHand(TENANT_A, locA1)).toBe("99");
      // 1 receive + 1 sale, not 1 + 6.
      expect(await countRows("awcms_inventory_movements", TENANT_A)).toBe(2);
    });

    test("a unit that differs from the one the item is stocked in is refused, not summed", async () => {
      await post(TENANT_A, movement(locA1, "receive", "5"));
      const result = await post(
        TENANT_A,
        movement(locA1, "receive", "2", { unitCode: "box" })
      );

      expect(result.outcome).toBe("unit_mismatch");
      expect(await onHand(TENANT_A, locA1)).toBe("5");
    });

    test("an opening movement must be the first movement for its key, and only once", async () => {
      expect(
        expectPosted(await post(TENANT_A, movement(locA1, "opening", "20")))[0]!
          .balanceAfter
      ).toBe("20");

      const second = await post(TENANT_A, movement(locA1, "opening", "5"));
      expect(second.outcome).toBe("opening_not_first");

      await post(TENANT_A, movement(locA2, "receive", "1"));
      const late = await post(TENANT_A, movement(locA2, "opening", "5"));
      expect(late.outcome).toBe("opening_not_first");
    });

    test("an inactive location refuses postings and keeps its history readable", async () => {
      await post(TENANT_A, movement(locA1, "receive", "5"));
      await inTenant(TENANT_A, (tx) =>
        updateLocation(tx, TENANT_A, null, locA1, { status: "inactive" })
      );

      expect(
        (await post(TENANT_A, movement(locA1, "receive", "1"))).outcome
      ).toBe("location_inactive");

      const listed = await inTenant(TENANT_A, (tx) =>
        listMovements(tx, TENANT_A, { locationId: locA1 })
      );
      expect(listed.movements).toHaveLength(1);
    });
  });

  describe("negative-stock policy and the last unit", () => {
    test("forbid is the default: a sale beyond on-hand is refused and writes nothing", async () => {
      await post(TENANT_A, movement(locA1, "receive", "2"));
      const before = await countRows("awcms_inventory_movements", TENANT_A);

      const result = await post(TENANT_A, movement(locA1, "sale", "3"));

      expect(result.outcome).toBe("insufficient_stock");
      expect(await onHand(TENANT_A, locA1)).toBe("2");
      expect(await countRows("awcms_inventory_movements", TENANT_A)).toBe(
        before
      );
    });

    test("a location override of allow lets stock go negative; the tenant default still governs other locations", async () => {
      await inTenant(TENANT_A, (tx) =>
        setLocationPolicy(tx, TENANT_A, null, locA1, "allow")
      );

      expect((await post(TENANT_A, movement(locA1, "sale", "4"))).outcome).toBe(
        "posted"
      );
      expect(await onHand(TENANT_A, locA1)).toBe("-4");
      expect((await post(TENANT_A, movement(locA2, "sale", "1"))).outcome).toBe(
        "insufficient_stock"
      );
    });

    test("the tenant default of allow applies where a location states no override", async () => {
      await inTenant(TENANT_A, (tx) =>
        setTenantPolicy(tx, TENANT_A, null, "allow")
      );

      expect((await post(TENANT_A, movement(locA2, "sale", "2"))).outcome).toBe(
        "posted"
      );
      expect(await onHand(TENANT_A, locA2)).toBe("-2");
    });

    test("a receipt into a negative balance is never blocked by forbid (it only improves the balance)", async () => {
      await inTenant(TENANT_A, (tx) =>
        setLocationPolicy(tx, TENANT_A, null, locA1, "allow")
      );
      await post(TENANT_A, movement(locA1, "sale", "5"));
      await inTenant(TENANT_A, (tx) =>
        setLocationPolicy(tx, TENANT_A, null, locA1, "forbid")
      );

      expect(
        (await post(TENANT_A, movement(locA1, "receive", "2"))).outcome
      ).toBe("posted");
      expect(await onHand(TENANT_A, locA1)).toBe("-3");
    });

    test("TWELVE concurrent sales of the final unit: exactly one succeeds, the balance is 0", async () => {
      await post(TENANT_A, movement(locA1, "receive", "1"));

      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          post(TENANT_A, movement(locA1, "sale", "1"))
        )
      );

      expect(results.filter((r) => r.outcome === "posted")).toHaveLength(1);
      expect(
        results.filter((r) => r.outcome === "insufficient_stock")
      ).toHaveLength(11);
      expect(await onHand(TENANT_A, locA1)).toBe("0");

      const report = await inTenant(TENANT_A, (tx) =>
        reconcileBalances(tx, TENANT_A, null)
      );
      expect(report.consistent).toBe(true);
    });

    test("concurrent sales that together exceed stock never oversell: sold units == received units", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));

      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          post(TENANT_A, movement(locA1, "sale", "1"))
        )
      );

      expect(results.filter((r) => r.outcome === "posted")).toHaveLength(10);
      expect(await onHand(TENANT_A, locA1)).toBe("0");
    });
  });

  describe("transfers are balanced pairs", () => {
    test("a transfer posts an out leg and an in leg in one transaction, out first", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));

      const result = await inTenant(TENANT_A, (tx) =>
        postTransfer(tx, TENANT_A, transfer(locA1, locA2, "4"), ACTOR)
      );
      const [out, into] = expectPosted(result);

      expect(out!.movementType).toBe("transfer_out");
      expect(out!.quantityDelta).toBe("-4");
      expect(into!.movementType).toBe("transfer_in");
      expect(into!.quantityDelta).toBe("4");
      expect(out!.transferId).toBe(into!.transferId);
      expect(await onHand(TENANT_A, locA1)).toBe("6");
      expect(await onHand(TENANT_A, locA2)).toBe("4");
    });

    test("replaying a transfer returns the ORIGINAL pair and moves nothing again", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));
      const input = transfer(locA1, locA2, "4");

      const first = await inTenant(TENANT_A, (tx) =>
        postTransfer(tx, TENANT_A, input, ACTOR)
      );
      const again = await inTenant(TENANT_A, (tx) =>
        postTransfer(tx, TENANT_A, input, ACTOR)
      );

      expect(again.outcome).toBe("replayed");
      expect(expectPosted(again).map((m) => m.id)).toEqual(
        expectPosted(first).map((m) => m.id)
      );
      expect(await onHand(TENANT_A, locA1)).toBe("6");
      expect(await onHand(TENANT_A, locA2)).toBe("4");
    });

    test("a refused transfer (insufficient stock) writes NOTHING — no half-applied pair", async () => {
      await post(TENANT_A, movement(locA1, "receive", "2"));
      const before = await countRows("awcms_inventory_movements", TENANT_A);

      const result = await inTenant(TENANT_A, (tx) =>
        postTransfer(tx, TENANT_A, transfer(locA1, locA2, "5"), ACTOR)
      );

      expect(result.outcome).toBe("insufficient_stock");
      expect(await countRows("awcms_inventory_movements", TENANT_A)).toBe(
        before
      );
      expect(await onHand(TENANT_A, locA1)).toBe("2");
      expect(await onHand(TENANT_A, locA2)).toBe("none");
    });

    test("a transfer into an inactive location is refused whole", async () => {
      await post(TENANT_A, movement(locA1, "receive", "5"));
      await inTenant(TENANT_A, (tx) =>
        updateLocation(tx, TENANT_A, null, locA2, { status: "inactive" })
      );

      const result = await inTenant(TENANT_A, (tx) =>
        postTransfer(tx, TENANT_A, transfer(locA1, locA2, "1"), ACTOR)
      );

      expect(result.outcome).toBe("location_inactive");
      expect(await onHand(TENANT_A, locA1)).toBe("5");
    });

    test("opposing concurrent transfers do not deadlock and conserve the total", async () => {
      await post(TENANT_A, movement(locA1, "receive", "50"));
      await post(TENANT_A, movement(locA2, "receive", "50"));

      const results = await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          inTenant(TENANT_A, (tx) =>
            index % 2 === 0
              ? postTransfer(tx, TENANT_A, transfer(locA1, locA2, "1"), ACTOR)
              : postTransfer(tx, TENANT_A, transfer(locA2, locA1, "1"), ACTOR)
          )
        )
      );

      expect(results.every((r) => r.outcome === "posted")).toBe(true);
      const total =
        Number(await onHand(TENANT_A, locA1)) +
        Number(await onHand(TENANT_A, locA2));
      expect(total).toBe(100);
    });

    test("the DATABASE refuses to commit an unpaired transfer leg (deferred constraint trigger)", async () => {
      const error = await assertRejected(
        getRuntimeSql().begin(async (tx) => {
          await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
          await tx`
            INSERT INTO awcms_inventory_movements
              (tenant_id, location_id, item_type, item_ref, unit_code,
               movement_type, quantity_delta, balance_after, source_type,
               source_id, operation, transfer_id, request_fingerprint)
            VALUES (${TENANT_A}, ${locA1}, 'x.y', 'orphan', 'unit',
                    'transfer_out', -1, -1, 'raw', 'raw-1', 'transfer_out',
                    gen_random_uuid(), 'f')
          `;
        }),
        "an unpaired transfer leg"
      );

      expect(String((error as { errno?: string }).errno)).toBe("23514");
      expect(await countRows("awcms_inventory_movements", TENANT_A)).toBe(0);
    });
  });

  describe("adjustments and compensating reversals", () => {
    test("an adjustment followed by its reversal restores the balance, and the original row is untouched", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));

      const adjusted = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          postAdjustment(tx, TENANT_A, adjustment(locA1, "-4"), ACTOR)
        )
      )[0]!;
      expect(await onHand(TENANT_A, locA1)).toBe("6");

      const reversal = await inTenant(TENANT_A, (tx) =>
        reverseAdjustment(
          tx,
          TENANT_A,
          adjusted.id,
          { reasonCode: "miscount", note: null },
          ACTOR
        )
      );
      const reversed = expectPosted(reversal)[0]!;

      expect(reversed.quantityDelta).toBe("4");
      expect(reversed.reversesMovementId).toBe(adjusted.id);
      expect(reversed.operation).toBe("reversal");
      expect(await onHand(TENANT_A, locA1)).toBe("10");

      // Two adjustment rows now exist; the first was never edited.
      const original = (await getAdminSql()`
        SELECT quantity_delta::float8 AS q FROM awcms_inventory_movements
        WHERE id = ${adjusted.id}
      `) as { q: number }[];
      expect(original[0]!.q).toBe(-4);
    });

    test("reversing twice replays the first reversal; the target can be reversed at most once", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));
      const adjusted = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          postAdjustment(tx, TENANT_A, adjustment(locA1, "3"), ACTOR)
        )
      )[0]!;

      const run = () =>
        inTenant(TENANT_A, (tx) =>
          reverseAdjustment(
            tx,
            TENANT_A,
            adjusted.id,
            { reasonCode: "undo", note: null },
            ACTOR
          )
        );
      const first = await run();
      const second = await run();

      expect(first.outcome).toBe("posted");
      expect(second.outcome).toBe("replayed");
      expect(await onHand(TENANT_A, locA1)).toBe("10");
    });

    test("the movement listing says which adjustment has been reversed (#900)", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));
      const reversedTarget = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          postAdjustment(tx, TENANT_A, adjustment(locA1, "-2"), ACTOR)
        )
      )[0]!;
      const untouched = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          postAdjustment(tx, TENANT_A, adjustment(locA1, "-1"), ACTOR)
        )
      )[0]!;
      const reversal = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          reverseAdjustment(
            tx,
            TENANT_A,
            reversedTarget.id,
            { reasonCode: "undo", note: null },
            ACTOR
          )
        )
      )[0]!;

      const { movements } = await inTenant(TENANT_A, (tx) =>
        listMovements(tx, TENANT_A, { locationId: locA1 })
      );
      const byId = new Map(movements.map((m) => [m.id, m]));

      expect(byId.get(reversedTarget.id)!.reversedByMovementId).toBe(
        reversal.id
      );
      expect(byId.get(untouched.id)!.reversedByMovementId).toBeNull();
      expect(byId.get(reversal.id)!.reversedByMovementId).toBeNull();
      expect(byId.get(reversal.id)!.reversesMovementId).toBe(reversedTarget.id);
    });

    test("only an adjustment is reversible; a reversal is not", async () => {
      const received = expectPosted(
        await post(TENANT_A, movement(locA1, "receive", "10"))
      )[0]!;
      const refused = await inTenant(TENANT_A, (tx) =>
        reverseAdjustment(
          tx,
          TENANT_A,
          received.id,
          { reasonCode: "oops", note: null },
          ACTOR
        )
      );
      expect(refused.outcome).toBe("not_reversible");

      const adjusted = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          postAdjustment(tx, TENANT_A, adjustment(locA1, "1"), ACTOR)
        )
      )[0]!;
      const reversal = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          reverseAdjustment(
            tx,
            TENANT_A,
            adjusted.id,
            { reasonCode: "undo", note: null },
            ACTOR
          )
        )
      )[0]!;
      const again = await inTenant(TENANT_A, (tx) =>
        reverseAdjustment(
          tx,
          TENANT_A,
          reversal.id,
          { reasonCode: "undo-undo", note: null },
          ACTOR
        )
      );
      expect(again.outcome).toBe("not_reversible");
    });

    test("an unknown movement id is target_not_found", async () => {
      const result = await inTenant(TENANT_A, (tx) =>
        reverseAdjustment(
          tx,
          TENANT_A,
          "00000000-0000-4000-8000-000000000000",
          { reasonCode: "x", note: null },
          ACTOR
        )
      );

      expect(result.outcome).toBe("target_not_found");
    });
  });

  describe("immutability — the ledger is append-only", () => {
    async function aMovementId(): Promise<string> {
      return expectPosted(
        await post(TENANT_A, movement(locA1, "receive", "5"))
      )[0]!.id;
    }

    test("the runtime role cannot UPDATE, DELETE or TRUNCATE a movement (privileges)", async () => {
      const id = await aMovementId();
      const attempt = (statement: string) =>
        assertRejected(
          getRuntimeSql().begin(async (tx) => {
            await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
            await tx.unsafe(statement, statement.includes("$1") ? [id] : []);
          }),
          statement
        );

      for (const statement of [
        "UPDATE awcms_inventory_movements SET quantity_delta = 999 WHERE id = $1",
        "DELETE FROM awcms_inventory_movements WHERE id = $1",
        "TRUNCATE awcms_inventory_movements"
      ]) {
        const error = await attempt(statement);
        expect(String((error as { errno?: string }).errno)).toBe("42501");
      }

      expect(await onHand(TENANT_A, locA1)).toBe("5");
    });

    test("even the table OWNER cannot UPDATE or DELETE a movement (trigger)", async () => {
      const id = await aMovementId();

      for (const statement of [
        "UPDATE awcms_inventory_movements SET quantity_delta = 999 WHERE id = $1",
        "DELETE FROM awcms_inventory_movements WHERE id = $1"
      ]) {
        const error = await assertRejected(
          getOwnerSql().begin(async (tx) => {
            await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
            await tx.unsafe(statement, [id]);
          }),
          statement
        );

        expect(String((error as { errno?: string }).errno)).toBe("55000");
      }
    });

    test("low-stock signals are append-only too", async () => {
      // A row-level trigger only fires when a row exists, so seed one first.
      await post(TENANT_A, movement(locA1, "receive", "5"));
      await inTenant(TENANT_A, (tx) =>
        setLowStockThreshold(
          tx,
          TENANT_A,
          { locationId: locA1, ...ITEM, lowStockThreshold: "10" },
          ACTOR
        )
      );
      for (const statement of [
        "DELETE FROM awcms_inventory_low_stock_signals",
        "UPDATE awcms_inventory_low_stock_signals SET on_hand = 0"
      ]) {
        const rejected = await assertRejected(
          getOwnerSql().begin(async (tx) => {
            await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
            await tx.unsafe(statement);
          }),
          statement
        );

        expect(String((rejected as { errno?: string }).errno)).toBe("55000");
      }
    });
  });

  describe("tenant isolation — FORCE RLS and composite foreign keys", () => {
    test("another tenant's location id is not found, and nothing is written", async () => {
      const result = await post(TENANT_A, movement(locB1, "receive", "5"));

      expect(result.outcome).toBe("location_not_found");
      expect(await countRows("awcms_inventory_movements", TENANT_A)).toBe(0);
      expect(await countRows("awcms_inventory_movements", TENANT_B)).toBe(0);
    });

    test("tenant B sees none of tenant A's ledger, balances or locations", async () => {
      await post(TENANT_A, movement(locA1, "receive", "5"));

      const seen = await inTenant(TENANT_B, async (tx) => {
        const movements = await tx`SELECT 1 FROM awcms_inventory_movements`;
        const balances = await tx`SELECT 1 FROM awcms_inventory_balances`;
        const locations = await tx`SELECT code FROM awcms_inventory_locations`;

        return {
          movements: movements.length,
          balances: balances.length,
          locations: (locations as { code: string }[]).map((l) => l.code)
        };
      });

      expect(seen.movements).toBe(0);
      expect(seen.balances).toBe(0);
      expect(seen.locations).toEqual(["main"]);
    });

    test("a forged movement row pointing at another tenant's location is rejected by the composite FK, even from the owner", async () => {
      const error = await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_inventory_movements
            (tenant_id, location_id, item_type, item_ref, unit_code,
             movement_type, quantity_delta, balance_after, source_type,
             source_id, operation, request_fingerprint)
          VALUES (${TENANT_A}, ${locB1}, 'x.y', 'z', 'unit', 'receive', 1, 1,
                  'raw', 'forged', 'receive', 'f')
        `,
        "a cross-tenant location reference"
      );

      expect(String((error as { errno?: string }).errno)).toBe("23503");
    });

    test("with no tenant context the runtime role sees no rows at all", async () => {
      await post(TENANT_A, movement(locA1, "receive", "5"));

      // `awcms_app` carries an all-zero default tenant (sql/019), so an unscoped
      // session matches no tenant's rows: default-deny, not default-allow.
      const rows = (await getRuntimeSql()`
        SELECT count(*)::int AS n FROM awcms_inventory_movements
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(0);
      expect(await countRows("awcms_inventory_movements", TENANT_A)).toBe(1);
    });
  });

  describe("reconciliation and rebuild", () => {
    test("a healthy ledger reconciles", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));
      await post(TENANT_A, movement(locA1, "sale", "3"));
      await inTenant(TENANT_A, (tx) =>
        postTransfer(tx, TENANT_A, transfer(locA1, locA2, "2"), ACTOR)
      );

      const report = await inTenant(TENANT_A, (tx) =>
        reconcileBalances(tx, TENANT_A, null)
      );

      expect(report.consistent).toBe(true);
      expect(report.drift).toEqual([]);
      expect(report.checkedKeys).toBe(2);
    });

    test("a corrupted balance is detected, repaired FROM the ledger, and rebuild is idempotent", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));
      await post(TENANT_A, movement(locA1, "sale", "3"));

      // Corrupt the derived balance out-of-band (the admin channel bypasses RLS
      // and the posting code on purpose — this is the failure being modelled).
      await getAdminSql()`
        UPDATE awcms_inventory_balances SET on_hand = 999
        WHERE tenant_id = ${TENANT_A} AND location_id = ${locA1}
      `;

      const drifted = await inTenant(TENANT_A, (tx) =>
        reconcileBalances(tx, TENANT_A, null)
      );
      expect(drifted.consistent).toBe(false);
      expect(drifted.drift[0]).toMatchObject({
        ledgerOnHand: "7",
        balanceOnHand: "999"
      });

      const rebuilt = await inTenant(TENANT_A, (tx) =>
        rebuildBalances(tx, TENANT_A, null, ACTOR)
      );
      expect(rebuilt.repaired).toHaveLength(1);
      expect(rebuilt.repaired[0]!.after.onHand).toBe("7");
      expect(await onHand(TENANT_A, locA1)).toBe("7");

      const clean = await inTenant(TENANT_A, (tx) =>
        reconcileBalances(tx, TENANT_A, null)
      );
      expect(clean.consistent).toBe(true);

      const second = await inTenant(TENANT_A, (tx) =>
        rebuildBalances(tx, TENANT_A, null, ACTOR)
      );
      expect(second.repaired).toEqual([]);
    });

    test("a key with movements but NO balance row is reported and rebuilt", async () => {
      await post(TENANT_A, movement(locA1, "receive", "4"));
      await getAdminSql()`
        DELETE FROM awcms_inventory_balances WHERE tenant_id = ${TENANT_A}
      `;

      const drifted = await inTenant(TENANT_A, (tx) =>
        reconcileBalances(tx, TENANT_A, null)
      );
      expect(drifted.drift[0]).toMatchObject({
        balanceOnHand: null,
        ledgerOnHand: "4"
      });

      await inTenant(TENANT_A, (tx) =>
        rebuildBalances(tx, TENANT_A, null, ACTOR)
      );
      expect(await onHand(TENANT_A, locA1)).toBe("4");
    });

    test("rebuild never takes a stale sum: a concurrent poster is not overwritten", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));
      await getAdminSql()`
        UPDATE awcms_inventory_balances SET on_hand = 1
        WHERE tenant_id = ${TENANT_A} AND location_id = ${locA1}
      `;

      await Promise.all([
        post(TENANT_A, movement(locA1, "receive", "5")),
        inTenant(TENANT_A, (tx) => rebuildBalances(tx, TENANT_A, null, ACTOR))
      ]);

      // Whichever order they ran in, one more rebuild leaves balance == ledger.
      // The poster's 5 is in the ledger either way, so 15 is the only answer —
      // a stale sum overwriting the poster's row would have produced 10.
      await inTenant(TENANT_A, (tx) =>
        rebuildBalances(tx, TENANT_A, null, ACTOR)
      );

      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            reconcileBalances(tx, TENANT_A, null)
          )
        ).consistent
      ).toBe(true);
      expect(await onHand(TENANT_A, locA1)).toBe("15");
    });

    test("negative balances under a forbid policy are reported separately from drift", async () => {
      await inTenant(TENANT_A, (tx) =>
        setLocationPolicy(tx, TENANT_A, null, locA1, "allow")
      );
      await post(TENANT_A, movement(locA1, "sale", "2"));
      await inTenant(TENANT_A, (tx) =>
        setLocationPolicy(tx, TENANT_A, null, locA1, "forbid")
      );

      const report = await inTenant(TENANT_A, (tx) =>
        reconcileBalances(tx, TENANT_A, null)
      );

      expect(report.consistent).toBe(true);
      expect(report.negativeUnderForbid).toBe(1);
    });
  });

  describe("low stock: threshold, signals, events and the reporting projection", () => {
    test("crossing below and recovering records transitions, publishes one event per downward crossing, and feeds the projection", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));
      await inTenant(TENANT_A, (tx) =>
        setLowStockThreshold(
          tx,
          TENANT_A,
          { locationId: locA1, ...ITEM, lowStockThreshold: "5" },
          ACTOR
        )
      );

      await post(TENANT_A, movement(locA1, "sale", "4")); // 6 -> still above
      await post(TENANT_A, movement(locA1, "sale", "1")); // 5 -> crosses (<=)
      await post(TENANT_A, movement(locA1, "sale", "1")); // 4 -> stays low
      await post(TENANT_A, movement(locA1, "receive", "10")); // 14 -> recovers

      const signals = (await getAdminSql()`
        SELECT signal_kind FROM awcms_inventory_low_stock_signals
        WHERE tenant_id = ${TENANT_A} ORDER BY created_at, id
      `) as { signal_kind: string }[];
      expect(signals.map((s) => s.signal_kind).sort()).toEqual([
        "below",
        "recovered"
      ]);

      const lowEvents = await countRowsWhere(
        "awcms_domain_events",
        TENANT_A,
        "event_type = 'awcms.inventory.stock.low'"
      );
      expect(lowEvents).toBe(1);

      const low = await inTenant(TENANT_A, (tx) =>
        listBalances(tx, TENANT_A, { lowStockOnly: true })
      );
      expect(low.balances).toHaveLength(0);

      // The projection: signals are created "now", so waive the lag for the test.
      const descriptor = inventoryModule.reportingProjections![0]!;
      const previous = process.env.REPORTING_PROJECTION_LAG_SECONDS;
      process.env.REPORTING_PROJECTION_LAG_SECONDS = "0";

      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const outcome = await runIncrementalUpdateForTenant(
          getRuntimeSql(),
          descriptor,
          TENANT_A
        );
        expect(outcome.failed).toBe(false);
      } finally {
        if (previous === undefined) {
          delete process.env.REPORTING_PROJECTION_LAG_SECONDS;
        } else {
          process.env.REPORTING_PROJECTION_LAG_SECONDS = previous;
        }
      }

      const metrics = await inTenant(TENANT_A, (tx) =>
        getProjectionMetrics(tx, TENANT_A, descriptor.key)
      );
      expect(metrics.below_signals).toBe(1);
      expect(metrics.recovered_signals).toBe(1);

      // And the projection reconciles against its own source.
      const run = await inTenant(TENANT_A, (tx) =>
        reconcileProjection(tx, TENANT_A, descriptor, null)
      );
      expect(run.mismatch).toBe(false);
    });

    test("lowStockOnly lists exactly the balances at or below threshold", async () => {
      await post(TENANT_A, movement(locA1, "receive", "3"));
      await post(
        TENANT_A,
        movement(locA1, "receive", "50", { itemRef: "sku-2" })
      );
      await inTenant(TENANT_A, async (tx) => {
        await setLowStockThreshold(
          tx,
          TENANT_A,
          { locationId: locA1, ...ITEM, lowStockThreshold: "5" },
          ACTOR
        );
        await setLowStockThreshold(
          tx,
          TENANT_A,
          {
            locationId: locA1,
            ...ITEM,
            itemRef: "sku-2",
            lowStockThreshold: "5"
          },
          ACTOR
        );
      });

      const low = await inTenant(TENANT_A, (tx) =>
        listBalances(tx, TENANT_A, { lowStockOnly: true })
      );

      expect(low.balances.map((b) => b.itemRef)).toEqual(["sku-1"]);
    });

    test("a threshold alone never changes the quantity on hand", async () => {
      await post(TENANT_A, movement(locA1, "receive", "7"));
      await inTenant(TENANT_A, (tx) =>
        setLowStockThreshold(
          tx,
          TENANT_A,
          { locationId: locA1, ...ITEM, lowStockThreshold: "100" },
          ACTOR
        )
      );

      expect(await onHand(TENANT_A, locA1)).toBe("7");
    });
  });

  describe("domain events and the outbox", () => {
    test("a posting publishes exactly one movement.posted event in the same transaction", async () => {
      await post(TENANT_A, movement(locA1, "receive", "5"));

      expect(
        await countRowsWhere(
          "awcms_domain_events",
          TENANT_A,
          "event_type = 'awcms.inventory.movement.posted'"
        )
      ).toBe(1);
    });

    test("a refused posting leaves no event behind", async () => {
      await post(TENANT_A, movement(locA1, "sale", "5"));

      expect(await countRows("awcms_domain_events", TENANT_A)).toBe(0);
    });

    test("a transfer publishes one event per leg, and a replay publishes none", async () => {
      await post(TENANT_A, movement(locA1, "receive", "10"));
      const input = transfer(locA1, locA2, "2");
      await inTenant(TENANT_A, (tx) =>
        postTransfer(tx, TENANT_A, input, ACTOR)
      );
      await inTenant(TENANT_A, (tx) =>
        postTransfer(tx, TENANT_A, input, ACTOR)
      );

      // 1 receive + 2 transfer legs.
      expect(
        await countRowsWhere(
          "awcms_domain_events",
          TENANT_A,
          "event_type = 'awcms.inventory.movement.posted'"
        )
      ).toBe(3);
    });
  });

  describe("the consumer adapter port", () => {
    test("postSale through the port decrements, replays by source, and reports insufficient stock as a value", async () => {
      await inTenant(TENANT_A, (tx) =>
        inventoryLedgerPortAdapter.postReceipt(tx, TENANT_A, null, {
          locationId: locA1,
          ...ITEM,
          quantity: "2",
          source: { type: "grn", id: "grn-1" }
        })
      );

      const sale = {
        locationId: locA1,
        ...ITEM,
        quantity: "2",
        source: { type: "pos_order", id: "port-1", line: "1" }
      };
      const first = await inTenant(TENANT_A, (tx) =>
        inventoryLedgerPortAdapter.postSale(tx, TENANT_A, null, sale)
      );
      const again = await inTenant(TENANT_A, (tx) =>
        inventoryLedgerPortAdapter.postSale(tx, TENANT_A, null, sale)
      );
      const over = await inTenant(TENANT_A, (tx) =>
        inventoryLedgerPortAdapter.postSale(tx, TENANT_A, null, {
          ...sale,
          source: { type: "pos_order", id: "port-2", line: "1" }
        })
      );

      expect(first.outcome).toBe("posted");
      expect(again.outcome).toBe("replayed");
      expect(over.outcome).toBe("insufficient_stock");
      expect(
        await inTenant(TENANT_A, (tx) =>
          inventoryLedgerPortAdapter.getOnHand(tx, TENANT_A, locA1, ITEM)
        )
      ).toBe("0");
      expect(
        await inTenant(TENANT_A, (tx) =>
          inventoryLedgerPortAdapter.getOnHand(tx, TENANT_A, locA1, {
            ...ITEM,
            itemRef: "never-moved"
          })
        )
      ).toBe("0");
    });
  });

  describe("InventoryLedgerPort.listBalances (Issue #913)", () => {
    const port = inventoryLedgerPortAdapter;

    async function seed(
      tenantId: string,
      loc: string,
      refs: string[],
      type = ITEM.itemType
    ) {
      for (const ref of refs) {
        expectPosted(
          await post(
            tenantId,
            movement(loc, "receive", "2", { itemType: type, itemRef: ref })
          )
        );
      }
    }

    test("pages the whole set with no gaps or duplicates and next=null on the last page", async () => {
      const refs = Array.from({ length: 7 }, (_, i) => `ref-${i}`);
      await seed(TENANT_A, locA1, refs);

      const seen: string[] = [];
      let after: string | undefined;
      let pages = 0;

      do {
        const page = await inTenant(TENANT_A, (tx) =>
          port.listBalances(tx, TENANT_A, {
            locationId: locA1,
            limit: 3,
            after
          })
        );
        seen.push(...page.items.map((i) => i.itemRef));
        after = page.next ?? undefined;
        pages += 1;
      } while (after);

      expect(pages).toBe(3);
      expect(seen).toEqual(refs);
    });

    test("exact multiple of limit yields no phantom extra page", async () => {
      await seed(TENANT_A, locA1, ["a", "b"]);
      const page = await inTenant(TENANT_A, (tx) =>
        port.listBalances(tx, TENANT_A, { locationId: locA1, limit: 2 })
      );
      expect(page.items).toHaveLength(2);
      expect(page.next).toBeNull();
      expect(page.items[0]).toEqual({
        itemType: ITEM.itemType,
        itemRef: "a",
        unitCode: "unit",
        onHand: "2"
      });
    });

    test("itemTypePrefix is literal (underscore is not a wildcard) and nonZeroOnly drops zero balances", async () => {
      await seed(TENANT_A, locA1, ["x"], "commerce.variant");
      await seed(TENANT_A, locA1, ["y"], "commerce_variant");
      await seed(TENANT_A, locA1, ["z"], "other.thing");
      expectPosted(
        await post(
          TENANT_A,
          movement(locA1, "sale", "2", {
            itemType: "other.thing",
            itemRef: "z"
          })
        )
      );

      const byPrefix = await inTenant(TENANT_A, (tx) =>
        port.listBalances(tx, TENANT_A, {
          locationId: locA1,
          itemTypePrefix: "commerce_"
        })
      );
      expect(byPrefix.items.map((i) => i.itemRef)).toEqual(["y"]);

      const all = await inTenant(TENANT_A, (tx) =>
        port.listBalances(tx, TENANT_A, { locationId: locA1 })
      );
      expect(all.items.map((i) => i.itemRef).sort()).toEqual(["x", "y", "z"]);

      const nonZero = await inTenant(TENANT_A, (tx) =>
        port.listBalances(tx, TENANT_A, {
          locationId: locA1,
          nonZeroOnly: true
        })
      );
      expect(nonZero.items.map((i) => i.itemRef).sort()).toEqual(["x", "y"]);
    });

    test("is scoped to the location and to the tenant (RLS)", async () => {
      await seed(TENANT_A, locA1, ["a1"]);
      await seed(TENANT_A, locA2, ["a2"]);
      await seed(TENANT_B, locB1, ["b1"]);

      const a1 = await inTenant(TENANT_A, (tx) =>
        port.listBalances(tx, TENANT_A, { locationId: locA1 })
      );
      expect(a1.items.map((i) => i.itemRef)).toEqual(["a1"]);

      // Tenant B's location asked from tenant A's context: nothing leaks.
      const cross = await inTenant(TENANT_A, (tx) =>
        port.listBalances(tx, TENANT_A, { locationId: locB1 })
      );
      expect(cross.items).toEqual([]);
    });

    test("a cursor issued for another location is rejected", async () => {
      await seed(TENANT_A, locA1, ["a", "b", "c"]);
      await seed(TENANT_A, locA2, ["a"]);
      const page = await inTenant(TENANT_A, (tx) =>
        port.listBalances(tx, TENANT_A, { locationId: locA1, limit: 1 })
      );
      expect(page.next).not.toBeNull();

      await expect(
        inTenant(TENANT_A, (tx) =>
          port.listBalances(tx, TENANT_A, {
            locationId: locA2,
            after: page.next!
          })
        )
      ).rejects.toBeInstanceOf(InventoryPortRequestError);
    });
  });

  describe("security review hardening (PR #891 findings)", () => {
    test("M2: awcms_worker can SELECT every reporting projection source, and really runs the low-stock projection", async () => {
      const sources = [
        ...new Set(
          collectProjectionDescriptors(listModules())
            .flatMap((descriptor) => [
              ...(descriptor.source.strategy === "cursor_table"
                ? descriptor.source.streams
                : []),
              ...descriptor.rebuildSource.streams
            ])
            .map((stream) => stream.tableName)
        )
      ];

      for (const table of sources) {
        const rows = (await getAdminSql()`
          SELECT has_table_privilege('awcms_worker', ${table}, 'SELECT') AS ok
        `) as { ok: boolean }[];

        expect({ table, ok: rows[0]!.ok }).toEqual({ table, ok: true });
      }

      if (!harness.workerRoleActivated) {
        return;
      }

      // The behavioural half: refresh the projection AS the worker role. Before
      // sql/169 granted it, this failed with "permission denied for table".
      await post(TENANT_A, movement(locA1, "receive", "10"));
      await inTenant(TENANT_A, (tx) =>
        setLowStockThreshold(
          tx,
          TENANT_A,
          { locationId: locA1, ...ITEM, lowStockThreshold: "20" },
          ACTOR
        )
      );

      const previous = process.env.REPORTING_PROJECTION_LAG_SECONDS;
      process.env.REPORTING_PROJECTION_LAG_SECONDS = "0";

      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const outcome = await runIncrementalUpdateForTenant(
          getWorkerRoleSql(),
          inventoryModule.reportingProjections![0]!,
          TENANT_A
        );

        expect(outcome.failed).toBe(false);
        expect(outcome.rowsProcessed).toBeGreaterThan(0);
      } finally {
        if (previous === undefined) {
          delete process.env.REPORTING_PROJECTION_LAG_SECONDS;
        } else {
          process.env.REPORTING_PROJECTION_LAG_SECONDS = previous;
        }
      }
    });

    test("L1: a balance past numeric(20,6) is refused as quantity_out_of_range and writes nothing", async () => {
      await post(TENANT_A, movement(locA1, "receive", "99999999999999.999999"));
      const before = await countRows("awcms_inventory_movements", TENANT_A);

      const result = await post(TENANT_A, movement(locA1, "receive", "1"));

      expect(result.outcome).toBe("quantity_out_of_range");
      expect(await countRows("awcms_inventory_movements", TENANT_A)).toBe(
        before
      );
    });

    test("L2: a concurrent deactivation serialises with a posting — the location row is locked FOR SHARE", async () => {
      await post(TENANT_A, movement(locA1, "receive", "5"));

      let release!: () => void;
      let lockTaken!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      const locked = new Promise<void>((resolve) => (lockTaken = resolve));

      const flipper = getRuntimeSql().begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
        await tx`
          UPDATE awcms_inventory_locations SET status = 'inactive'
          WHERE tenant_id = ${TENANT_A} AND id = ${locA1}
        `;
        lockTaken();
        await hold;
      });

      await locked;

      let settled = false;
      const posting = post(TENANT_A, movement(locA1, "sale", "1")).then(
        (result) => {
          settled = true;

          return result;
        }
      );

      // With a plain read the posting would validate against the still-visible
      // `active` row and finish; FOR SHARE makes it wait for the flip.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);

      release();
      await flipper;

      expect((await posting).outcome).toBe("location_inactive");
      expect(await onHand(TENANT_A, locA1)).toBe("5");
    });

    test("L4: the same source identity with a different note or reason is a conflict, not a silent replay", async () => {
      const input = movement(locA1, "receive", "5", {
        note: "first",
        reasonCode: "supplier_delivery"
      });
      await post(TENANT_A, input);

      expect((await post(TENANT_A, input)).outcome).toBe("replayed");
      expect((await post(TENANT_A, { ...input, note: "second" })).outcome).toBe(
        "source_conflict"
      );
      expect(
        (await post(TENANT_A, { ...input, reasonCode: "other" })).outcome
      ).toBe("source_conflict");

      const adjusted = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          postAdjustment(tx, TENANT_A, adjustment(locA1, "1"), ACTOR)
        )
      )[0]!;
      const reverse = (reasonCode: string) =>
        inTenant(TENANT_A, (tx) =>
          reverseAdjustment(
            tx,
            TENANT_A,
            adjusted.id,
            { reasonCode, note: null },
            ACTOR
          )
        );

      expect((await reverse("first")).outcome).toBe("posted");
      expect((await reverse("first")).outcome).toBe("replayed");
      expect((await reverse("second")).outcome).toBe("source_conflict");
    });

    test("L7: the DATABASE refuses a row that claims to reverse a movement it does not match", async () => {
      const adjusted = expectPosted(
        await inTenant(TENANT_A, (tx) =>
          postAdjustment(tx, TENANT_A, adjustment(locA1, "4"), ACTOR)
        )
      )[0]!;
      const received = expectPosted(
        await post(TENANT_A, movement(locA1, "receive", "2"))
      )[0]!;

      const forge = (overrides: {
        target: string;
        location: string;
        item: string;
        delta: number;
      }) =>
        assertRejected(
          getOwnerSql().begin(async (tx) => {
            await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT_A}'`);
            await tx`
              INSERT INTO awcms_inventory_movements
                (tenant_id, location_id, item_type, item_ref, unit_code,
                 movement_type, quantity_delta, balance_after, source_type,
                 source_id, operation, reverses_movement_id, request_fingerprint)
              VALUES (${TENANT_A}, ${overrides.location}, ${ITEM.itemType},
                      ${overrides.item}, 'unit', 'adjustment', ${overrides.delta},
                      0, 'reversal', ${`forged-${Math.random()}`}, 'reversal',
                      ${overrides.target}, 'f')
            `;
          }),
          "a forged reversal"
        );

      const base = {
        target: adjusted.id,
        location: locA1,
        item: ITEM.itemRef,
        delta: -4
      };

      // Wrong location, wrong item, wrong quantity, and a non-adjustment target.
      for (const bad of [
        { ...base, location: locA2 },
        { ...base, item: "some-other-sku" },
        { ...base, delta: -3 },
        { ...base, target: received.id, delta: -2 }
      ]) {
        const error = await forge(bad);

        expect(String((error as { errno?: string }).errno)).toBe("23514");
      }
    });
  });

  describe("query plans and load for high-frequency stock mutation", () => {
    const BALANCE_ROWS = 4000;
    const MOVEMENT_ROWS = 24000;

    /** Collects every plan node's `Node Type` + relation, recursively. */
    function planNodes(plan: unknown): { type: string; relation?: string }[] {
      const nodes: { type: string; relation?: string }[] = [];
      const walk = (node: Record<string, unknown>) => {
        nodes.push({
          type: String(node["Node Type"]),
          relation: node["Relation Name"] as string | undefined
        });
        for (const child of (node["Plans"] as Record<string, unknown>[]) ??
          []) {
          walk(child);
        }
      };
      walk((plan as { Plan: Record<string, unknown> }[])[0]!.Plan);

      return nodes;
    }

    async function explain(
      statement: string
    ): Promise<ReturnType<typeof planNodes>> {
      return inTenant(TENANT_PLAN, async (tx) => {
        const rows = (await tx.unsafe(
          `EXPLAIN (FORMAT JSON) ${statement}`
        )) as { "QUERY PLAN": unknown }[];

        return planNodes(rows[0]!["QUERY PLAN"]);
      });
    }

    beforeEach(async () => {
      const admin = getAdminSql();
      const location = (await admin`
        INSERT INTO awcms_inventory_locations (tenant_id, code, name)
        VALUES (${TENANT_PLAN}, 'bulk', 'bulk') RETURNING id
      `) as { id: string }[];
      const locationId = location[0]!.id;

      await admin`
        INSERT INTO awcms_inventory_balances
          (tenant_id, location_id, item_type, item_ref, unit_code, on_hand)
        SELECT ${TENANT_PLAN}, ${locationId}, 'commerce.variant', 'sku-' || g, 'unit', 10
        FROM generate_series(1, ${BALANCE_ROWS}) g
      `;
      await admin`
        INSERT INTO awcms_inventory_movements
          (tenant_id, location_id, item_type, item_ref, unit_code, movement_type,
           quantity_delta, balance_after, source_type, source_id, source_line,
           operation, request_fingerprint, created_at)
        SELECT ${TENANT_PLAN}, ${locationId}, 'commerce.variant',
               'sku-' || (g % ${BALANCE_ROWS} + 1), 'unit', 'receive', 1, 1,
               'bulk', 'doc-' || g, '1', 'receive', 'f',
               now() - (g || ' seconds')::interval
        FROM generate_series(1, ${MOVEMENT_ROWS}) g
      `;
      await admin.unsafe("ANALYZE awcms_inventory_balances");
      await admin.unsafe("ANALYZE awcms_inventory_movements");
    });

    test("the guarded balance UPDATE is a primary-key Index Scan, not a Seq Scan", async () => {
      const nodes = await explain(`
        UPDATE awcms_inventory_balances
        SET on_hand = on_hand + 1, movement_count = movement_count + 1
        WHERE tenant_id = '${TENANT_PLAN}'
          AND location_id = (SELECT id FROM awcms_inventory_locations WHERE tenant_id = '${TENANT_PLAN}' AND code = 'bulk')
          AND item_type = 'commerce.variant' AND item_ref = 'sku-77'
          AND (1 >= 0 OR on_hand + 1 >= 0)
      `);
      const onBalances = nodes.filter(
        (n) => n.relation === "awcms_inventory_balances"
      );

      expect(onBalances.some((n) => n.type === "Index Scan")).toBe(true);
      expect(onBalances.some((n) => n.type === "Seq Scan")).toBe(false);
    });

    test("per-item history and the tenant listing read in index order with no Sort node", async () => {
      const history = await explain(`
        SELECT id FROM awcms_inventory_movements
        WHERE tenant_id = '${TENANT_PLAN}'
          AND location_id = (SELECT id FROM awcms_inventory_locations WHERE tenant_id = '${TENANT_PLAN}' AND code = 'bulk')
          AND item_type = 'commerce.variant' AND item_ref = 'sku-77'
        ORDER BY created_at DESC, id DESC LIMIT 100
      `);
      expect(history.some((n) => n.type.includes("Index"))).toBe(true);
      expect(history.some((n) => n.type === "Sort")).toBe(false);
      expect(
        history.some(
          (n) =>
            n.type === "Seq Scan" && n.relation === "awcms_inventory_movements"
        )
      ).toBe(false);

      const listing = await explain(`
        SELECT id FROM awcms_inventory_movements
        WHERE tenant_id = '${TENANT_PLAN}'
        ORDER BY created_at DESC, id DESC LIMIT 100
      `);
      expect(listing.some((n) => n.type.includes("Index"))).toBe(true);
      expect(listing.some((n) => n.type === "Sort")).toBe(false);
    });

    test("source-identity lookup (the idempotency probe) is an Index Scan on the unique key", async () => {
      const nodes = await explain(`
        SELECT id FROM awcms_inventory_movements
        WHERE tenant_id = '${TENANT_PLAN}' AND source_type = 'bulk'
          AND source_id = 'doc-500' AND source_line = '1' AND operation = 'receive'
      `);

      expect(nodes.some((n) => n.type.includes("Index"))).toBe(true);
      expect(
        nodes.some(
          (n) =>
            n.type === "Seq Scan" && n.relation === "awcms_inventory_movements"
        )
      ).toBe(false);
    });

    test("load: 8 concurrent workers post 480 sales across 12 items; nothing oversells and the ledger reconciles", async () => {
      const locationId = await newLocation(TENANT_A, "load");
      const items = Array.from({ length: 12 }, (_, i) => `load-${i}`);

      for (const itemRef of items) {
        await post(
          TENANT_A,
          movement(locationId, "receive", "30", { itemRef })
        );
      }

      const started = performance.now();
      const workers = Array.from({ length: 8 }, (_, worker) =>
        (async () => {
          const outcomes: string[] = [];
          for (let n = 0; n < 60; n += 1) {
            const itemRef = items[(worker + n) % items.length]!;
            const result = await post(
              TENANT_A,
              movement(locationId, "sale", "1", { itemRef })
            );
            outcomes.push(result.outcome);
          }
          return outcomes;
        })()
      );
      const outcomes = (await Promise.all(workers)).flat();
      const elapsedMs = performance.now() - started;

      const posted = outcomes.filter((o) => o === "posted").length;
      const refused = outcomes.filter((o) => o === "insufficient_stock").length;

      expect(posted + refused).toBe(480);
      // 12 items x 30 units = 360 available; 480 attempted.
      expect(posted).toBe(360);

      const report = await inTenant(TENANT_A, (tx) =>
        reconcileBalances(tx, TENANT_A, locationId)
      );
      expect(report.consistent).toBe(true);

      for (const itemRef of items) {
        expect(await onHand(TENANT_A, locationId, itemRef)).toBe("0");
      }

      console.log(
        `[inventory load] ${outcomes.length} postings by 8 workers in ${Math.round(elapsedMs)} ms ` +
          `(${Math.round((outcomes.length / elapsedMs) * 1000)} postings/s, ${posted} posted, ${refused} refused)`
      );
    }, 120_000);
  });
});

async function countRowsWhere(
  table: string,
  tenantId: string,
  predicate: string
): Promise<number> {
  const rows = (await getAdminSql().unsafe(
    `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND ${predicate}`,
    [tenantId]
  )) as { n: number }[];

  return rows[0]!.n;
}
