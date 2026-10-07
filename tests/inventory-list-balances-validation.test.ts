import { describe, expect, test } from "bun:test";
import {
  InventoryPortRequestError,
  inventoryLedgerPortAdapter
} from "../src/modules/inventory/application/inventory-ledger-port-adapter";
import { encodeBalanceCursor } from "../src/modules/inventory/application/inventory-balance-directory";

const TENANT = "a8870000-0000-4000-8000-00000000000a";
const LOC = "b8870000-0000-4000-8000-0000000000a1";
const OTHER = "b8870000-0000-4000-8000-0000000000a2";

// Validation runs before any SQL, so a throwing tx proves no query is issued.
const tx = (() => {
  throw new Error("tx must not be touched");
}) as unknown as Bun.SQL;

function call(
  query: Parameters<typeof inventoryLedgerPortAdapter.listBalances>[2]
) {
  return inventoryLedgerPortAdapter.listBalances(tx, TENANT, query);
}

describe("listBalances input validation (Issue #913)", () => {
  const bad: [string, Parameters<typeof call>[0]][] = [
    ["non-UUID location", { locationId: "nope" }],
    ["limit 0", { locationId: LOC, limit: 0 }],
    ["limit above 500", { locationId: LOC, limit: 501 }],
    ["fractional limit", { locationId: LOC, limit: 1.5 }],
    ["prefix with wildcard", { locationId: LOC, itemTypePrefix: "a%" }],
    ["empty prefix", { locationId: LOC, itemTypePrefix: "" }],
    ["malformed cursor", { locationId: LOC, after: "@@@" }],
    [
      "cursor for another location",
      {
        locationId: LOC,
        after: encodeBalanceCursor({
          locationId: OTHER,
          itemType: "a.b",
          itemRef: "x"
        })
      }
    ]
  ];

  for (const [name, query] of bad) {
    test(`rejects ${name} without a query`, async () => {
      await expect(call(query)).rejects.toBeInstanceOf(
        InventoryPortRequestError
      );
    });
  }
});
