import { afterEach, describe, expect, test } from "bun:test";

import {
  getAllowedVariablesForCategory,
  isKnownEmailTemplateCategory,
  registerDerivedEmailTemplateCategory,
  resetDerivedEmailTemplateCategoriesForTests
} from "../src/modules/email/domain/email-template-categories";

afterEach(() => {
  resetDerivedEmailTemplateCategoriesForTests();
});

describe("isKnownEmailTemplateCategory / getAllowedVariablesForCategory", () => {
  test("base categories are known with a fixed allowlist", () => {
    expect(isKnownEmailTemplateCategory("auth.password_reset")).toBe(true);
    expect(getAllowedVariablesForCategory("auth.password_reset")).toEqual([
      "userName",
      "resetUrl",
      "expiresInMinutes"
    ]);
  });

  test("an unrecognized category is unknown and has no allowlist", () => {
    expect(isKnownEmailTemplateCategory("nope.unknown")).toBe(false);
    expect(getAllowedVariablesForCategory("nope.unknown")).toBeNull();
  });

  test("an unregistered derived.* category is unknown", () => {
    expect(isKnownEmailTemplateCategory("derived.not_registered")).toBe(false);
    expect(getAllowedVariablesForCategory("derived.not_registered")).toBeNull();
  });

  test("registering a derived category makes it known with its own allowlist", () => {
    registerDerivedEmailTemplateCategory("derived.order_confirmation", [
      "orderNumber",
      "total"
    ]);

    expect(isKnownEmailTemplateCategory("derived.order_confirmation")).toBe(
      true
    );
    expect(
      getAllowedVariablesForCategory("derived.order_confirmation")
    ).toEqual(["orderNumber", "total"]);
  });

  test("registering a non-derived category throws", () => {
    expect(() =>
      registerDerivedEmailTemplateCategory("system.not_derived", ["x"])
    ).toThrow();
  });
});
