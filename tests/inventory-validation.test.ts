/**
 * Pure (no database) tests for the stock ledger (Issue #887, ADR-0126): exact
 * quantity arithmetic, the strict request validators, the replay fingerprint,
 * and the shape of the module descriptor against the SQL it ships with.
 *
 * The behavioural invariants — concurrency, atomicity, immutability, isolation —
 * need a real PostgreSQL and live in
 * `tests/integration/inventory-ledger.integration.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  formatQuantityUnits,
  negateQuantity,
  normalizeQuantityInput,
  parseQuantityUnits,
  quantitySign
} from "../src/modules/inventory/domain/inventory-quantity";
import {
  exceedsBackdateWindow,
  resolveBackdateWindowDays
} from "../src/modules/inventory/domain/inventory-backdate";
import {
  movementFingerprint,
  validateAdjustmentInput,
  validateCreateLocationInput,
  validateLocationPolicyInput,
  validateOpeningInput,
  validatePostMovementInput,
  validateReversalInput,
  validateTenantPolicyInput,
  validateThresholdInput,
  validateTransferInput,
  validateUpdateLocationInput
} from "../src/modules/inventory/domain/inventory-validation";
import {
  MOVEMENT_SIGN,
  MOVEMENT_TYPES,
  POSTABLE_MOVEMENT_TYPES
} from "../src/modules/inventory/domain/inventory-types";
import { INVENTORY_GUARDS } from "../src/modules/inventory/domain/inventory-permissions";
import { inventoryModule } from "../src/modules/inventory/module";
import { validateProjectionRegistry } from "../src/modules/reporting/domain/projection-registry";
import { isHighRiskAction } from "../src/modules/identity-access/domain/access-control";
import { stripSqlComments } from "../scripts/sql-grants";

const LOCATION = "11111111-1111-4111-8111-111111111111";
const OTHER_LOCATION = "22222222-2222-4222-8222-222222222222";

const validMovement = {
  locationId: LOCATION,
  itemType: "commerce.variant",
  itemRef: "sku-1",
  movementType: "sale",
  quantity: "2",
  source: { type: "pos_order", id: "order-1", line: "1" }
};

function root(...segments: string[]): string {
  return path.join(import.meta.dir, "..", ...segments);
}

describe("exact decimal quantities", () => {
  test("round-trips without float error", () => {
    expect(formatQuantityUnits(parseQuantityUnits("0.1")!)).toBe("0.1");
    expect(formatQuantityUnits(parseQuantityUnits("0.1")! * 3n)).toBe("0.3");
    expect(formatQuantityUnits(parseQuantityUnits("12.500000")!)).toBe("12.5");
    expect(formatQuantityUnits(parseQuantityUnits("-3")!)).toBe("-3");
    expect(formatQuantityUnits(0n)).toBe("0");
  });

  test("never yields a negative zero", () => {
    expect(negateQuantity("0")).toBe("0");
    expect(negateQuantity("0.000000")).toBe("0");
  });

  test("accepts what a JSON client sends, and refuses exponent notation", () => {
    expect(normalizeQuantityInput(3)).toBe("3");
    expect(normalizeQuantityInput(0.25)).toBe("0.25");
    expect(normalizeQuantityInput(" 7.5 ")).toBe("7.5");
    expect(normalizeQuantityInput(1e-7)).toBeNull();
    expect(normalizeQuantityInput(1e21)).toBeNull();
    expect(normalizeQuantityInput("1e3")).toBeNull();
    expect(normalizeQuantityInput("0.1234567")).toBeNull();
    expect(normalizeQuantityInput("")).toBeNull();
    expect(normalizeQuantityInput("abc")).toBeNull();
    expect(normalizeQuantityInput(Number.NaN)).toBeNull();
    expect(normalizeQuantityInput(null)).toBeNull();
    expect(normalizeQuantityInput({})).toBeNull();
  });

  test("honours the numeric(20,6) ceiling", () => {
    expect(normalizeQuantityInput("99999999999999.999999")).toBe(
      "99999999999999.999999"
    );
    expect(normalizeQuantityInput("100000000000000")).toBeNull();
  });

  test("sign and negation", () => {
    expect(quantitySign("5")).toBe(1);
    expect(quantitySign("-5")).toBe(-1);
    expect(quantitySign("0")).toBe(0);
    expect(negateQuantity("5")).toBe("-5");
    expect(negateQuantity("-2.5")).toBe("2.5");
    expect(() => negateQuantity("nope")).toThrow();
  });
});

describe("movement vocabulary", () => {
  test("every non-adjustment type owns a sign, and the postable subset excludes transfers and adjustments", () => {
    for (const type of MOVEMENT_TYPES) {
      if (type !== "adjustment") {
        expect([1, -1]).toContain(
          MOVEMENT_SIGN[type as keyof typeof MOVEMENT_SIGN]
        );
      }
    }

    expect(POSTABLE_MOVEMENT_TYPES).not.toContain("adjustment" as never);
    expect(POSTABLE_MOVEMENT_TYPES).not.toContain("transfer_out" as never);
    expect(POSTABLE_MOVEMENT_TYPES).not.toContain("transfer_in" as never);
  });
});

describe("validatePostMovementInput — strict, and a balance can never be asserted", () => {
  test("accepts a well-formed movement and canonicalises the quantity", () => {
    const result = validatePostMovementInput({
      ...validMovement,
      quantity: 2
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.quantity).toBe("2");
      expect(result.value.unitCode).toBe("unit");
      expect(result.value.source.sourceLine).toBe("1");
    }
  });

  test.each(["onHand", "balanceAfter", "balance", "quantityOnHand", "stock"])(
    "a body naming %s is refused, by name",
    (field) => {
      const result = validatePostMovementInput({
        ...validMovement,
        [field]: 40
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.map((e) => e.field)).toContain(field);
      }
    }
  );

  test("the request carries a POSITIVE quantity — the type decides direction", () => {
    for (const quantity of ["-1", "0", 0, -3]) {
      expect(
        validatePostMovementInput({ ...validMovement, quantity }).valid
      ).toBe(false);
    }
  });

  test("an opening is NOT postable on the generic endpoint — it needs its own, with adjust", () => {
    expect(
      validatePostMovementInput({ ...validMovement, movementType: "opening" })
        .valid
    ).toBe(false);

    const { movementType: _omitted, ...withoutType } = validMovement;
    const opening = validateOpeningInput({ ...withoutType, quantity: "5" });

    expect(opening.valid).toBe(true);
    if (opening.valid) {
      expect(opening.value.movementType).toBe("opening");
    }

    // The openings endpoint fixes the type; naming one is refused, not ignored.
    expect(
      validateOpeningInput({ ...withoutType, movementType: "sale" }).valid
    ).toBe(false);
    expect(
      validateOpeningInput({ ...withoutType, movementType: "opening" }).valid
    ).toBe(false);
  });

  test("source.type 'reversal' is reserved for the server on every entry point", () => {
    for (const result of [
      validatePostMovementInput({
        ...validMovement,
        source: { type: "reversal", id: "x" }
      }),
      validateAdjustmentInput({
        locationId: LOCATION,
        itemType: "commerce.variant",
        itemRef: "sku-1",
        quantityDelta: "1",
        reasonCode: "x",
        source: { type: "reversal", id: "x" }
      }),
      validateTransferInput({
        fromLocationId: LOCATION,
        toLocationId: OTHER_LOCATION,
        itemType: "commerce.variant",
        itemRef: "sku-1",
        quantity: "1",
        source: { type: "reversal", id: "x" }
      })
    ]) {
      expect(result.valid).toBe(false);
    }
  });

  test("a type with its own endpoint is refused on the generic one", () => {
    for (const movementType of [
      "adjustment",
      "transfer_out",
      "transfer_in",
      "x"
    ]) {
      expect(
        validatePostMovementInput({ ...validMovement, movementType }).valid
      ).toBe(false);
    }
  });

  test("a source identity is required, and bounded", () => {
    const { source: _omitted, ...withoutSource } = validMovement;

    expect(validatePostMovementInput(withoutSource).valid).toBe(false);
    expect(
      validatePostMovementInput({
        ...validMovement,
        source: { type: "pos_order" }
      }).valid
    ).toBe(false);
    expect(
      validatePostMovementInput({
        ...validMovement,
        source: { type: "pos_order", id: "x".repeat(201) }
      }).valid
    ).toBe(false);
    expect(
      validatePostMovementInput({
        ...validMovement,
        source: { type: "Pos Order", id: "x" }
      }).valid
    ).toBe(false);
  });

  test("an opaque id that looks like a credential is a validation error, not a later 500", () => {
    const jwtShaped = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk"
    ].join(".");

    expect(
      validatePostMovementInput({ ...validMovement, itemRef: jwtShaped }).valid
    ).toBe(false);
    // `/`, `+` and `=` are not in the alphabet at all.
    for (const itemRef of ["a/b", "a+b", "a=b", "a b", "ä"]) {
      expect(
        validatePostMovementInput({ ...validMovement, itemRef }).valid
      ).toBe(false);
    }
  });

  test("occurredAt must be an ISO timestamp that is not in the future", () => {
    const now = new Date("2026-10-04T12:00:00Z");

    expect(
      validatePostMovementInput(
        { ...validMovement, occurredAt: "2026-10-04T11:00:00Z" },
        now
      ).valid
    ).toBe(true);
    expect(
      validatePostMovementInput(
        { ...validMovement, occurredAt: "2026-10-05T11:00:00Z" },
        now
      ).valid
    ).toBe(false);
    expect(
      validatePostMovementInput(
        { ...validMovement, occurredAt: "yesterday" },
        now
      ).valid
    ).toBe(false);
  });

  test("a non-object body is refused", () => {
    for (const body of [null, undefined, "x", 3, []]) {
      expect(validatePostMovementInput(body).valid).toBe(false);
    }
  });
});

describe("adjustments, reversals and transfers", () => {
  const adjustment = {
    locationId: LOCATION,
    itemType: "commerce.variant",
    itemRef: "sku-1",
    quantityDelta: "-2",
    reasonCode: "shrinkage",
    source: { type: "stock_count", id: "count-1" }
  };

  test("an adjustment carries a SIGNED non-zero delta and a REQUIRED reason", () => {
    expect(validateAdjustmentInput(adjustment).valid).toBe(true);
    expect(
      validateAdjustmentInput({ ...adjustment, quantityDelta: "0" }).valid
    ).toBe(false);
    expect(
      validateAdjustmentInput({ ...adjustment, quantityDelta: "abc" }).valid
    ).toBe(false);

    const { reasonCode: _omitted, ...withoutReason } = adjustment;
    expect(validateAdjustmentInput(withoutReason).valid).toBe(false);
  });

  test("an adjustment cannot assert a balance either", () => {
    const result = validateAdjustmentInput({ ...adjustment, onHand: 10 });

    expect(result.valid).toBe(false);
  });

  test("a reversal needs a reason and nothing else of consequence", () => {
    expect(validateReversalInput({ reasonCode: "miscount" }).valid).toBe(true);
    expect(validateReversalInput({}).valid).toBe(false);
    expect(
      validateReversalInput({ reasonCode: "miscount", quantityDelta: 5 }).valid
    ).toBe(false);
  });

  test("a transfer needs two DIFFERENT locations and a positive quantity", () => {
    const transfer = {
      fromLocationId: LOCATION,
      toLocationId: OTHER_LOCATION,
      itemType: "commerce.variant",
      itemRef: "sku-1",
      quantity: "4",
      source: { type: "transfer_request", id: "tr-1" }
    };

    expect(validateTransferInput(transfer).valid).toBe(true);
    expect(
      validateTransferInput({ ...transfer, toLocationId: LOCATION }).valid
    ).toBe(false);
    expect(validateTransferInput({ ...transfer, quantity: "-4" }).valid).toBe(
      false
    );
    expect(validateTransferInput({ ...transfer, quantity: "0" }).valid).toBe(
      false
    );
  });
});

describe("locations, policy and thresholds", () => {
  test("a location code is a lower-case slug", () => {
    expect(
      validateCreateLocationInput({ code: "main-store", name: "Main" }).valid
    ).toBe(true);
    for (const code of ["Main", "-x", "a b", "", "x".repeat(65)]) {
      expect(validateCreateLocationInput({ code, name: "N" }).valid).toBe(
        false
      );
    }
    expect(validateCreateLocationInput({ code: "x", name: "" }).valid).toBe(
      false
    );
  });

  test("the policy cannot be smuggled in through the location PATCH", () => {
    expect(validateUpdateLocationInput({ name: "X" }).valid).toBe(true);
    expect(
      validateUpdateLocationInput({ negativeStockPolicy: "allow" }).valid
    ).toBe(false);
    expect(validateUpdateLocationInput({}).valid).toBe(false);
    expect(validateUpdateLocationInput({ status: "gone" }).valid).toBe(false);
  });

  test("negative-stock policy values", () => {
    expect(
      validateTenantPolicyInput({ defaultNegativeStockPolicy: "allow" }).valid
    ).toBe(true);
    expect(
      validateTenantPolicyInput({ defaultNegativeStockPolicy: "maybe" }).valid
    ).toBe(false);
    expect(
      validateLocationPolicyInput({ negativeStockPolicy: null }).valid
    ).toBe(true);
    expect(validateLocationPolicyInput({}).valid).toBe(false);
  });

  test("a threshold is non-negative or null, and never carries a quantity on hand", () => {
    const base = {
      locationId: LOCATION,
      itemType: "commerce.variant",
      itemRef: "sku-1"
    };

    expect(
      validateThresholdInput({ ...base, lowStockThreshold: "5" }).valid
    ).toBe(true);
    expect(
      validateThresholdInput({ ...base, lowStockThreshold: null }).valid
    ).toBe(true);
    expect(
      validateThresholdInput({ ...base, lowStockThreshold: "-1" }).valid
    ).toBe(false);
    expect(validateThresholdInput(base).valid).toBe(false);
    expect(
      validateThresholdInput({ ...base, lowStockThreshold: "5", onHand: 99 })
        .valid
    ).toBe(false);
  });
});

describe("movementFingerprint — what makes two requests the same posting", () => {
  const base = {
    operation: "sale" as const,
    locationIds: [LOCATION],
    itemType: "commerce.variant",
    itemRef: "sku-1",
    unitCode: "unit",
    quantity: "-2",
    source: { sourceType: "pos_order", sourceId: "o-1", sourceLine: "1" },
    reasonCode: null as string | null,
    note: null as string | null
  };

  test("is stable", () => {
    expect(movementFingerprint(base)).toBe(movementFingerprint({ ...base }));
  });

  test("changes with anything that changes stock", () => {
    const original = movementFingerprint(base);

    for (const variant of [
      { ...base, quantity: "-3" },
      { ...base, itemRef: "sku-2" },
      { ...base, unitCode: "box" },
      { ...base, locationIds: [OTHER_LOCATION] },
      { ...base, operation: "sale_return" as const },
      // A different reason or note is a different request: a silent replay would
      // tell the caller their new reason was recorded when it was not.
      { ...base, reasonCode: "damaged" },
      { ...base, note: "customer changed their mind" },
      { ...base, source: { ...base.source, sourceLine: "2" } }
    ]) {
      expect(movementFingerprint(variant)).not.toBe(original);
    }
  });
});

describe("backdating window", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  test("defaults to 7 days, is configurable, and falls back on junk", () => {
    expect(resolveBackdateWindowDays({})).toBe(7);
    expect(
      resolveBackdateWindowDays({ INVENTORY_BACKDATE_WINDOW_DAYS: "30" })
    ).toBe(30);
    expect(
      resolveBackdateWindowDays({ INVENTORY_BACKDATE_WINDOW_DAYS: "0" })
    ).toBe(0);
    for (const junk of ["-1", "x", "1.5", ""]) {
      expect(
        resolveBackdateWindowDays({ INVENTORY_BACKDATE_WINDOW_DAYS: junk })
      ).toBe(7);
    }
    expect(
      resolveBackdateWindowDays({ INVENTORY_BACKDATE_WINDOW_DAYS: "999999" })
    ).toBe(3650);
  });

  test("a date inside the window is fine; outside it needs adjust; null never does", () => {
    expect(exceedsBackdateWindow(null, now, 7)).toBe(false);
    expect(
      exceedsBackdateWindow(new Date("2026-10-01T12:00:00Z"), now, 7)
    ).toBe(false);
    expect(
      exceedsBackdateWindow(new Date("2026-09-20T12:00:00Z"), now, 7)
    ).toBe(true);
    expect(
      exceedsBackdateWindow(new Date("2026-10-03T12:00:00Z"), now, 0)
    ).toBe(true);
  });
});

describe("module descriptor", () => {
  test("declares exactly the twelve permissions the migration seeds, verbatim", () => {
    const sql = readFileSync(
      root("sql", "170_awcms_inventory_permissions.sql"),
      "utf8"
    );
    const seeded = [
      ...sql.matchAll(
        /\('inventory', '(\w+)', '(\w+)',\s*\n?\s*'((?:[^']|'')*)'\)/g
      )
    ].map(([, activity, action, description]) => ({
      activityCode: activity!,
      action: action!,
      description: description!.replace(/''/g, "'")
    }));

    expect(seeded).toHaveLength(12);
    expect(inventoryModule.permissions).toEqual(seeded);
  });

  test("every declared permission has a literal guard in INVENTORY_GUARDS, and vice versa", () => {
    const guards = Object.values(INVENTORY_GUARDS).flatMap((group) =>
      Object.values(group).map(
        (guard) => `${guard.moduleKey}.${guard.activityCode}.${guard.action}`
      )
    );
    const declared = inventoryModule.permissions!.map(
      (permission) =>
        `inventory.${permission.activityCode}.${permission.action}`
    );

    expect(guards.sort()).toEqual(declared.sort());
  });

  test("adjust, transfer and rebuild are high-risk", () => {
    expect(isHighRiskAction("adjust")).toBe(true);
    expect(isHighRiskAction("transfer")).toBe(true);
    expect(isHighRiskAction("rebuild")).toBe(true);
    expect(isHighRiskAction("create")).toBe(false);
  });

  test("declares one navigation entry, gated on balances.read, and the page it points at exists", async () => {
    expect(inventoryModule.navigation).toHaveLength(1);
    expect(inventoryModule.navigation![0]!.path).toBe("/admin/inventory");
    expect(inventoryModule.navigation![0]!.requiredPermission).toBe(
      "inventory.balances.read"
    );
    expect(await Bun.file("src/pages/admin/inventory.astro").exists()).toBe(
      true
    );
    expect(inventoryModule.status).toBe("active");
  });

  test("its low-stock projection passes the reporting registry validation", () => {
    const result = validateProjectionRegistry([inventoryModule]);

    expect(result.issues).toEqual([]);
    expect(result.descriptors.map((d) => d.key)).toEqual([
      "inventory.low_stock"
    ]);
  });

  test("every table the migration creates answers the retention and subject-data questions", () => {
    const sql = readFileSync(
      root("sql", "169_awcms_inventory_schema.sql"),
      "utf8"
    );
    const tables = [
      ...sql.matchAll(/CREATE TABLE IF NOT EXISTS (awcms_\w+)/g)
    ].map((match) => match[1]!);
    const lifecycle = new Set(
      inventoryModule.dataLifecycle!.map((d) => d.tableName)
    );

    expect(tables).toHaveLength(5);
    for (const table of tables) {
      expect(lifecycle.has(table)).toBe(true);
    }
  });
});

describe("sql/169 — the schema carries the invariants, not just the code", () => {
  const sql = readFileSync(
    root("sql", "169_awcms_inventory_schema.sql"),
    "utf8"
  );
  const tables = [
    ...sql.matchAll(/CREATE TABLE IF NOT EXISTS (awcms_\w+)/g)
  ].map((match) => match[1]!);

  test("every table is tenant-scoped with ENABLE and FORCE RLS and a WITH CHECK", () => {
    for (const table of tables) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY ${table}_tenant_isolation\\s+ON ${table}\\s+USING \\(tenant_id = current_setting\\('app.current_tenant_id'\\)::uuid\\)\\s+WITH CHECK`
        )
      );
    }
  });

  test("the ledger is immutable by trigger AND by privileges", () => {
    for (const table of [
      "awcms_inventory_movements",
      "awcms_inventory_low_stock_signals"
    ]) {
      expect(sql).toContain(`BEFORE UPDATE OR DELETE ON ${table}`);
      expect(sql).toContain(
        `REVOKE UPDATE, DELETE, TRUNCATE ON ${table} FROM awcms_app`
      );
    }
  });

  test("a transfer is a balanced pair enforced at COMMIT by a deferred constraint trigger", () => {
    expect(sql).toContain("CREATE CONSTRAINT TRIGGER");
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
  });

  test("the idempotent source identity is a unique key, with a non-null line", () => {
    expect(sql).toContain(
      "UNIQUE (tenant_id, source_type, source_id, source_line, operation)"
    );
    expect(sql).toContain("source_line text NOT NULL DEFAULT ''");
  });

  test("references are composite (tenant_id, id) foreign keys, never a bare id", () => {
    const bareFkToLocations = /REFERENCES awcms_inventory_locations \(id\)/;

    expect(sql).not.toMatch(bareFkToLocations);
    expect(sql).toContain(
      "REFERENCES awcms_inventory_locations (tenant_id, id)"
    );
    expect(sql).toContain(
      "REFERENCES awcms_inventory_movements (tenant_id, id)"
    );
  });

  test("quantities are numeric, never float", () => {
    // Comments are stripped: the header legitimately says "never float".
    const code = stripSqlComments(sql);

    expect(code).not.toMatch(/\b(real|double precision|float)\b/i);
    expect(code).toContain("quantity_delta numeric(20, 6)");
  });

  test("timestamps are timestamptz", () => {
    expect(stripSqlComments(sql)).not.toMatch(/\btimestamp\b(?! with)/i);
  });
});
