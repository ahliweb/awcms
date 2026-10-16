import { describe, expect, test } from "bun:test";

import { grantEntitlementRow } from "../src/modules/identity-access/application/entitlement-backfill-job";

function fakeTx(result: unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(result);
  }) as unknown as Bun.TransactionSQL;
  return { tx, calls };
}

const grant = { tenantId: "t-1", entitlementKey: "blog" };
const now = new Date("2025-01-01T00:00:00Z");

describe("g09: entitlement backfill renews expired rows", () => {
  test("conflict renews only expired rows and returns written rows", async () => {
    const { tx, calls } = fakeTx([{ entitlement_key: "blog" }]);
    expect(await grantEntitlementRow(tx, grant, now)).toBe(true);
    const text = calls[0]!.text.replace(/\s+/g, " ");
    expect(text).not.toContain("DO NOTHING");
    expect(text).toContain("DO UPDATE");
    expect(text).toContain("expires_at = NULL");
    expect(text).toContain("expires_at <= ?");
    expect(text).toContain("RETURNING");
    expect(calls[0]!.values).toContain(now);
  });

  test("a no-op conflict (live row) is not counted as granted", async () => {
    const { tx } = fakeTx([]);
    expect(await grantEntitlementRow(tx, grant, now)).toBe(false);
  });
});
