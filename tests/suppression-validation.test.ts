import { describe, expect, test } from "bun:test";

import { validateSuppressionInput } from "../src/modules/email/domain/suppression-validation";

describe("validateSuppressionInput", () => {
  test("accepts a valid manual suppression request", () => {
    const result = validateSuppressionInput({
      recipient: "user@example.com",
      reason: "manual"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({
        recipient: "user@example.com",
        reason: "manual"
      });
    }
  });

  test("accepts each known reason", () => {
    for (const reason of [
      "bounced",
      "complained",
      "manual",
      "unsubscribed"
    ] as const) {
      const result = validateSuppressionInput({
        recipient: "user@example.com",
        reason
      });

      expect(result.valid).toBe(true);
    }
  });

  test("rejects a missing recipient", () => {
    const result = validateSuppressionInput({ reason: "manual" });

    expect(result.valid).toBe(false);
  });

  test("rejects a malformed recipient", () => {
    const result = validateSuppressionInput({
      recipient: "not-an-email",
      reason: "manual"
    });

    expect(result.valid).toBe(false);
  });

  test("rejects an unrecognized reason", () => {
    const result = validateSuppressionInput({
      recipient: "user@example.com",
      reason: "because"
    });

    expect(result.valid).toBe(false);
  });

  test("rejects a missing reason", () => {
    const result = validateSuppressionInput({ recipient: "user@example.com" });

    expect(result.valid).toBe(false);
  });

  test("trims whitespace around the recipient", () => {
    const result = validateSuppressionInput({
      recipient: "  user@example.com  ",
      reason: "manual"
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.recipient).toBe("user@example.com");
    }
  });
});
