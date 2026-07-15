import { describe, expect, test } from "bun:test";

import { computeRequestHash } from "../src/modules/_shared/idempotency";

describe("computeRequestHash", () => {
  test("is deterministic and independent of key order", () => {
    const a = computeRequestHash({ amount: 100, currency: "IDR" });
    const b = computeRequestHash({ currency: "IDR", amount: 100 });

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("normalizes nested object key order too", () => {
    const a = computeRequestHash({
      meta: { b: 1, a: 2 },
      items: [{ y: 1, x: 2 }]
    });
    const b = computeRequestHash({
      items: [{ x: 2, y: 1 }],
      meta: { a: 2, b: 1 }
    });

    expect(a).toBe(b);
  });

  test("differs for different payloads", () => {
    expect(computeRequestHash({ amount: 100 })).not.toBe(
      computeRequestHash({ amount: 101 })
    );
  });

  test("preserves array order (arrays are ordered, not sorted)", () => {
    expect(computeRequestHash([1, 2, 3])).not.toBe(
      computeRequestHash([3, 2, 1])
    );
  });
});
