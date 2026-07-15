import { describe, expect, test } from "bun:test";

import {
  decodeKeysetCursor,
  encodeKeysetCursor
} from "../src/modules/_shared/keyset-pagination";

const id = "11111111-2222-4333-8444-555555555555";
const createdAt = new Date("2026-01-02T03:04:05.678Z");

describe("keyset pagination cursor", () => {
  test("round-trips (created_at, id) through an opaque cursor", () => {
    const decoded = decodeKeysetCursor(encodeKeysetCursor(createdAt, id));

    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(id);
    expect(decoded!.createdAt.toISOString()).toBe(createdAt.toISOString());
  });

  test("rejects a forged/garbage cursor with null (never treated as page 1)", () => {
    expect(decodeKeysetCursor("not-a-cursor")).toBeNull();
    expect(decodeKeysetCursor("")).toBeNull();
  });

  test("rejects a cursor whose id is not a UUID", () => {
    const bad = Buffer.from(
      `${createdAt.toISOString()}|not-a-uuid`,
      "utf-8"
    ).toString("base64url");
    expect(decodeKeysetCursor(bad)).toBeNull();
  });

  test("rejects a cursor whose timestamp is invalid", () => {
    const bad = Buffer.from(`not-a-date|${id}`, "utf-8").toString("base64url");
    expect(decodeKeysetCursor(bad)).toBeNull();
  });
});
