import { describe, expect, test } from "bun:test";

import {
  classifyHealthStatus,
  type ReadinessSignal
} from "../src/modules/module-management/domain/health-registry";

function signal(
  name: string,
  status: ReadinessSignal["status"]
): ReadinessSignal {
  return { name, status };
}

describe("classifyHealthStatus", () => {
  test("healthy when every applicable signal passes", () => {
    expect(
      classifyHealthStatus([signal("a", "pass"), signal("b", "pass")])
    ).toBe("healthy");
  });

  test("healthy when some signals are not_applicable and the rest pass", () => {
    expect(
      classifyHealthStatus([signal("a", "pass"), signal("b", "not_applicable")])
    ).toBe("healthy");
  });

  test("failed when every applicable signal fails", () => {
    expect(
      classifyHealthStatus([signal("a", "fail"), signal("b", "fail")])
    ).toBe("failed");
  });

  test("degraded when some applicable signals pass and some fail", () => {
    expect(
      classifyHealthStatus([signal("a", "pass"), signal("b", "fail")])
    ).toBe("degraded");
  });

  test("not_applicable signals never affect the verdict either way", () => {
    expect(
      classifyHealthStatus([
        signal("a", "pass"),
        signal("b", "fail"),
        signal("c", "not_applicable")
      ])
    ).toBe("degraded");
  });

  test("unknown when every signal is not_applicable (nothing checkable)", () => {
    expect(
      classifyHealthStatus([
        signal("a", "not_applicable"),
        signal("b", "not_applicable")
      ])
    ).toBe("unknown");
  });

  test("unknown for an empty signal list", () => {
    expect(classifyHealthStatus([])).toBe("unknown");
  });
});
