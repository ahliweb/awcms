import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Read the descriptors as source so this runs without node_modules.
function navOrders(file: string): { labelKey: string; order: number }[] {
  const src = readFileSync(file, "utf8");
  const out: { labelKey: string; order: number }[] = [];
  const re = /labelKey:\s*"([^"]+)"[\s\S]*?order:\s*(\d+)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.push({ labelKey: m[1]!, order: Number(m[2]) });
  }
  return out;
}

const modulesDir = join(import.meta.dir, "..", "src", "modules");

describe("identity_access navigation orders (g15)", () => {
  const ia = navOrders(join(modulesDir, "identity-access", "module.ts"));

  test("no two identity_access nav entries share an order", () => {
    const orders = ia.map((e) => e.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  test("nav_registrations does not collide with any other module's nav order", () => {
    const reg = ia.find((e) => e.labelKey === "admin.layout.nav_registrations");
    expect(reg).toBeDefined();
    const others: string[] = [];
    for (const dir of readdirSync(modulesDir)) {
      let entries: { labelKey: string; order: number }[];
      try {
        entries = navOrders(join(modulesDir, dir, "module.ts"));
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.labelKey !== reg!.labelKey && e.order === reg!.order) {
          others.push(`${dir}:${e.labelKey}`);
        }
      }
    }
    expect(others).toEqual([]);
  });
});
