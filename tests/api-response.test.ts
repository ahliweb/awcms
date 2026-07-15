import { describe, expect, test } from "bun:test";

import { fail, ok } from "../src/modules/_shared/api-response";

describe("api-response", () => {
  test("ok() wraps data in the success envelope with a 200 status", async () => {
    const response = ok({ hello: "world" }, { correlationId: "abc" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { hello: "world" },
      meta: { correlationId: "abc" }
    });
  });

  test("fail() wraps an error in the failure envelope with the given status", async () => {
    const response = fail(404, "RESOURCE_NOT_FOUND", "Not found.");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: { code: "RESOURCE_NOT_FOUND", message: "Not found." },
      meta: {}
    });
  });

  test("fail() includes details and custom headers when provided", async () => {
    const response = fail(
      400,
      "VALIDATION_ERROR",
      "Invalid.",
      {},
      [{ field: "x", message: "bad" }],
      {
        "retry-after": "5"
      }
    );
    const body = await response.json();

    expect(response.headers.get("retry-after")).toBe("5");
    expect(body.error.details).toEqual([{ field: "x", message: "bad" }]);
  });
});
