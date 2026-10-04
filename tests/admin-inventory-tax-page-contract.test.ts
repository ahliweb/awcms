/**
 * `/admin/inventory` and `/admin/tax` gate against the endpoints they drive —
 * Issue #894 (ADR-0126, ADR-0127).
 *
 * Sibling of the other page-contract tests. What is specific here: both screens
 * are several independently-readable views behind one any-of entry decision, so
 * the permission the page names must be one the endpoint behind the control
 * enforces, and the SEEDED one (a key nobody seeds denies even the owner while
 * the code looks right). The high-risk calls must carry an `Idempotency-Key`,
 * and neither screen may carry a control that writes a balance or a tax amount.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const INVENTORY = "src/pages/admin/inventory.astro";
const TAX = "src/pages/admin/tax.astro";

function declared(): Set<string> {
  const keys = new Set<string>();
  for (const module of listModules()) {
    for (const permission of module.permissions ?? []) {
      keys.add(`${module.key}.${permission.activityCode}.${permission.action}`);
    }
  }
  return keys;
}

const INVENTORY_KEYS = [
  "inventory.balances.read",
  "inventory.movements.read",
  "inventory.locations.read",
  "inventory.locations.create",
  "inventory.locations.update",
  "inventory.policy.read",
  "inventory.policy.configure",
  "inventory.movements.adjust",
  "inventory.movements.transfer",
  "inventory.balances.reconcile"
];
const TAX_KEYS = [
  "tax.rules.read",
  "tax.rules.configure",
  "tax.rules.publish",
  "tax.snapshots.read",
  "tax.reports.read"
];

describe("every key the screens name is declared, and the page names it", () => {
  for (const [file, keys] of [
    [INVENTORY, INVENTORY_KEYS],
    [TAX, TAX_KEYS]
  ] as const) {
    test(file, async () => {
      const page = await readFile(file, "utf8");
      const all = declared();

      for (const key of keys) {
        const [moduleKey, activityCode, action] = key.split(".");
        expect(all.has(key)).toBe(true);
        expect(page).toContain(`moduleKey: "${moduleKey}"`);
        expect(page).toContain(`activityCode: "${activityCode}"`);
        expect(page).toContain(`action: "${action}"`);
      }
    });
  }
});

describe("the entry decision is any-of over the read permissions", () => {
  test("inventory", async () => {
    const page = await readFile(INVENTORY, "utf8");
    expect(page).toMatch(/authorize: \[/);
    expect(page).toContain(
      "const [mayBalances, mayMovements, mayLocations] = entry"
    );
  });

  test("tax", async () => {
    const page = await readFile(TAX, "utf8");
    expect(page).toMatch(/authorize: \[/);
    expect(page).toContain(
      "const [mayRules, maySnapshots, mayReports] = entry"
    );
  });
});

describe("the controls call endpoints that exist, with an Idempotency-Key where the endpoint needs one", () => {
  test("inventory", async () => {
    const page = await readFile(INVENTORY, "utf8");

    for (const [url, route, keyed] of [
      ['/api/v1/inventory/locations"', "locations/index.ts", false],
      ["/api/v1/inventory/policy", "policy.ts", true],
      ["/api/v1/inventory/balances/threshold", "balances/threshold.ts", true],
      ['/api/v1/inventory/adjustments"', "adjustments/index.ts", true],
      ["/api/v1/inventory/transfers", "transfers/index.ts", true],
      ["/reversal", "adjustments/[id]/reversal.ts", true]
    ] as const) {
      expect(page).toContain(url);
      const source = await readFile(
        `src/pages/api/v1/inventory/${route}`,
        "utf8"
      );
      expect(source.includes("readIdempotencyKey")).toBe(keyed);
    }

    expect(page).toContain("Idempotency-Key");
  });

  test("tax", async () => {
    const page = await readFile(TAX, "utf8");

    expect(page).toContain("/api/v1/tax/rule-versions");
    expect(page).toContain("/publish");
    for (const route of [
      "rule-versions/index.ts",
      "rule-versions/[id]/publish.ts"
    ]) {
      expect(await readFile(`src/pages/api/v1/tax/${route}`, "utf8")).toContain(
        "idempotencyKeyRequired"
      );
    }
    expect(page).toContain("Idempotency-Key");
  });
});

describe("what neither screen may do", () => {
  test("no control writes a balance or a tax amount", async () => {
    const inventory = await readFile(INVENTORY, "utf8");
    const tax = await readFile(TAX, "utf8");

    expect(inventory).not.toMatch(/name="(onHand|on_hand|balance)"/);
    expect(inventory).not.toContain("/balances/rebuild");
    expect(inventory).not.toContain('/api/v1/inventory/movements"');
    expect(tax).not.toMatch(/name="(taxAmount|taxTotal|tax_total)"/);
    expect(tax).not.toContain("/api/v1/tax/quote");
    expect(tax).not.toContain("/reverse");
  });

  test("no own <h1>, no inline style attribute, no raw fetch, no window.confirm", async () => {
    for (const file of [INVENTORY, TAX]) {
      const page = await readFile(file, "utf8");

      expect(page).not.toContain("<h1");
      expect(page).not.toMatch(/\sstyle=/);
      expect(page).not.toMatch(/\bfetch\(/);
      expect(page).not.toContain("window.confirm");
      expect(page).toContain('from "../../lib/ui/admin-form-client"');
    }
  });

  test("the reversal goes through the reason panel", async () => {
    const page = await readFile(INVENTORY, "utf8");

    expect(page).toContain("<ReasonPanel");
    expect(page).toContain("data-reason-form");
    expect(page).toContain("initReasonPanel()");
  });

  test("the publish confirmation goes through confirmAction", async () => {
    expect(await readFile(TAX, "utf8")).toContain("confirmAction(");
  });
});

describe("the navigation entries point at these pages", () => {
  test("each module declares its own entry", () => {
    const byKey = new Map(listModules().map((module) => [module.key, module]));

    expect(byKey.get("inventory")!.navigation![0]!.path).toBe(
      "/admin/inventory"
    );
    expect(byKey.get("tax")!.navigation![0]!.path).toBe("/admin/tax");
    expect(byKey.get("inventory")!.status).toBe("active");
    expect(byKey.get("tax")!.status).toBe("active");
  });
});
