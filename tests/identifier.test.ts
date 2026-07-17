import { describe, expect, test } from "bun:test";

import {
  hashIdentifierValue,
  maskIdentifierValue,
  normalizeIdentifierValue
} from "../src/modules/profile-identity/domain/identifier";

describe("normalizeIdentifierValue", () => {
  test("lowercases and trims an email", () => {
    expect(normalizeIdentifierValue("email", "  Jane@Example.COM ")).toBe(
      "jane@example.com"
    );
  });

  test("strips non-digit characters from a phone number, keeping a leading +", () => {
    expect(normalizeIdentifierValue("phone", "+62 812-3456-7890")).toBe(
      "+6281234567890"
    );
  });

  test("only trims other identifier types", () => {
    expect(normalizeIdentifierValue("tax_id", " 01.234.567.8-901.000 ")).toBe(
      "01.234.567.8-901.000"
    );
  });
});

describe("hashIdentifierValue", () => {
  test("is deterministic for the same normalized value", () => {
    expect(hashIdentifierValue("jane@example.com")).toBe(
      hashIdentifierValue("jane@example.com")
    );
  });

  test("differs for different values", () => {
    expect(hashIdentifierValue("jane@example.com")).not.toBe(
      hashIdentifierValue("john@example.com")
    );
  });
});

describe("maskIdentifierValue", () => {
  test("never returns the raw value", () => {
    const masked = maskIdentifierValue("jane@example.com");

    expect(masked).not.toBe("jane@example.com");
    expect(masked.endsWith("com")).toBe(true);
  });

  test("handles short values without throwing, revealing no character", () => {
    expect(maskIdentifierValue("ab")).toBe("**");
    expect(maskIdentifierValue("")).toBe("");
  });
});
