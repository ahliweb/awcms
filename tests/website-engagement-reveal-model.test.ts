import { describe, expect, test } from "bun:test";

import {
  REVEAL_FIELDS,
  revealMessageKey,
  revealRows
} from "../src/lib/ui/website-engagement-reveal-model";

describe("revealMessageKey (Issue #1477)", () => {
  test("no permission, no such submission and a machine credential are ONE sentence (no existence oracle)", () => {
    const keys = new Set(
      [
        "ACCESS_DENIED",
        "RESOURCE_NOT_FOUND",
        "INTERACTIVE_SESSION_REQUIRED"
      ].map(revealMessageKey)
    );

    expect([...keys]).toEqual(["unavailable"]);
  });

  test("the specific, already-authorized outcomes keep their own sentences", () => {
    expect(revealMessageKey("SUBMISSION_WITHDRAWN")).toBe("withdrawn");
    expect(revealMessageKey("NOTHING_TO_REVEAL")).toBe("nothing");
    expect(revealMessageKey("RATE_LIMITED")).toBe("rateLimited");
  });

  test("an unknown code, null and a network failure are the generic failure, never the raw code", () => {
    for (const code of [null, "NETWORK_ERROR", "DECRYPTION_FAILED", "x"]) {
      expect(revealMessageKey(code)).toBe("failed");
    }
  });
});

describe("revealRows", () => {
  test("shows only the known, non-empty string fields, in order", () => {
    expect(
      revealRows({
        id: "x",
        contact: {
          message: "hello\nworld",
          name: "Ani",
          email: "ani@example.id",
          phone: "  ",
          company: null,
          subject: "Q",
          secret: "must not appear",
          __proto__: { polluted: "no" }
        }
      })
    ).toEqual([
      { field: "name", value: "Ani" },
      { field: "email", value: "ani@example.id" },
      { field: "subject", value: "Q" },
      { field: "message", value: "hello\nworld" }
    ]);
    expect(REVEAL_FIELDS).toHaveLength(6);
  });

  test("a response that is not a reveal is a failure (null), not an empty reveal", () => {
    for (const data of [
      null,
      undefined,
      "x",
      1,
      {},
      { contact: null },
      { contact: "x" }
    ]) {
      expect(revealRows(data)).toBeNull();
    }

    expect(revealRows({ contact: {} })).toEqual([]);
  });

  test("non-string values never reach the DOM", () => {
    expect(
      revealRows({ contact: { name: { toString: 1 }, email: 5, phone: ["a"] } })
    ).toEqual([]);
  });
});
