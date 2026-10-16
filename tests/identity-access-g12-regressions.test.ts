import { describe, expect, test } from "bun:test";
import { isIpInAnyCidr } from "../src/modules/identity-access/domain/machine-credential";

describe("isIpInAnyCidr malformed prefix (g12)", () => {
  test("empty or non-numeric prefix matches nothing", () => {
    for (const c of [
      "10.0.0.0/",
      "10.0.0.0/ ",
      "10.0.0.0/ 8",
      "10.0.0.0/x",
      "::/",
      "10.0.0.0/8.0",
      "10.0.0.0/-0"
    ]) {
      expect(isIpInAnyCidr("203.0.113.9", [c])).toBe(false);
    }
  });
  test("valid entries still match", () => {
    expect(isIpInAnyCidr("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(isIpInAnyCidr("10.1.2.3", ["10.1.2.3"])).toBe(true);
    expect(isIpInAnyCidr("203.0.113.9", ["0.0.0.0/0"])).toBe(true);
    expect(isIpInAnyCidr("10.1.2.3", ["10.0.0.0/33"])).toBe(false);
  });
});
