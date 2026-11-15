/**
 * Unit tests for `resolvePrimaryKeyColumns` (archive-purge-job): the generic
 * purge addresses rows by the table's real primary key, not an assumed `id`.
 * Fake `tx`, no DB.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearPrimaryKeyColumnsCache,
  lifecycleFailureCode,
  MissingPrimaryKeyError,
  resolvePrimaryKeyColumns
} from "../src/modules/data-lifecycle/application/archive-purge-job";

function fakeTx(rows: { column_name: string }[]) {
  const calls: { text: string; params: unknown[] }[] = [];
  const tx = {
    unsafe: async (text: string, params: unknown[]) => {
      calls.push({ text, params });
      return rows;
    }
  } as unknown as Bun.SQL;

  return { tx, calls };
}

describe("resolvePrimaryKeyColumns", () => {
  beforeEach(() => clearPrimaryKeyColumnsCache());

  test("returns a single key column, bound as a parameter", async () => {
    const { tx, calls } = fakeTx([{ column_name: "event_id" }]);

    expect(await resolvePrimaryKeyColumns(tx, "awcms_x")).toEqual(["event_id"]);
    expect(calls[0]!.params).toEqual(["awcms_x"]);
    expect(calls[0]!.text).toContain("indisprimary");
  });

  test("returns a composite key in catalog order", async () => {
    const { tx } = fakeTx([{ column_name: "a" }, { column_name: "b" }]);

    expect(await resolvePrimaryKeyColumns(tx, "awcms_x")).toEqual(["a", "b"]);
  });

  test("rejects a table without a primary key, and does not cache the miss", async () => {
    const none = fakeTx([]);

    await expect(resolvePrimaryKeyColumns(none.tx, "awcms_x")).rejects.toThrow(
      /no primary key/
    );

    const later = fakeTx([{ column_name: "id" }]);

    expect(await resolvePrimaryKeyColumns(later.tx, "awcms_x")).toEqual(["id"]);
  });

  test("caches a resolved key per process", async () => {
    const first = fakeTx([{ column_name: "id" }]);
    await resolvePrimaryKeyColumns(first.tx, "awcms_x");
    const second = fakeTx([{ column_name: "other" }]);

    expect(await resolvePrimaryKeyColumns(second.tx, "awcms_x")).toEqual([
      "id"
    ]);
    expect(second.calls).toHaveLength(0);
  });

  test("refuses an unsafe table name and an unsafe catalog column name", async () => {
    const { tx, calls } = fakeTx([{ column_name: 'x"; DROP TABLE y;--' }]);

    await expect(
      resolvePrimaryKeyColumns(tx, 'awcms_x"; DROP TABLE y;--')
    ).rejects.toThrow(/unsafe table identifier/);
    expect(calls).toHaveLength(0);
    await expect(resolvePrimaryKeyColumns(tx, "awcms_x")).rejects.toThrow(
      /unsafe column identifier/
    );
  });

  test("restricts the catalog query to key columns, not INCLUDE columns", async () => {
    const { tx, calls } = fakeTx([{ column_name: "id" }]);

    await resolvePrimaryKeyColumns(tx, "awcms_x");
    expect(calls[0]!.text).toContain("i.indisprimary");
    expect(calls[0]!.text).toContain(
      "array_position(i.indkey::int2[], a.attnum) < i.indnkeyatts"
    );
  });

  test("keys the cache per table (no cross-table reuse, no clear between)", async () => {
    const a = fakeTx([{ column_name: "k1" }]);
    const b = fakeTx([{ column_name: "k2" }]);

    expect(await resolvePrimaryKeyColumns(a.tx, "awcms_a")).toEqual(["k1"]);
    expect(await resolvePrimaryKeyColumns(b.tx, "awcms_b")).toEqual(["k2"]);
    expect(b.calls).toHaveLength(1);

    const none = fakeTx([]);

    await expect(resolvePrimaryKeyColumns(none.tx, "awcms_c")).rejects.toThrow(
      MissingPrimaryKeyError
    );
  });

  test("a missing primary key surfaces a stable, data-free failure code", async () => {
    const none = fakeTx([]);
    const error = await resolvePrimaryKeyColumns(none.tx, "awcms_x").catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(MissingPrimaryKeyError);
    expect(lifecycleFailureCode(error)).toBe("MissingPrimaryKeyError");
  });
});
