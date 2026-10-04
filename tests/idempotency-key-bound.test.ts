import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  invalidIdempotencyKeyResponse,
  isIdempotencyKeyHeaderAcceptable
} from "../src/lib/security/idempotency-key-bound";

function requestWith(key: string | null): Request {
  return new Request("http://localhost/api/v1/anything", {
    method: "POST",
    headers: key === null ? {} : { "Idempotency-Key": key }
  });
}

describe("Idempotency-Key header bound", () => {
  test("accepts an absent header, UUIDs, and short readable keys", () => {
    expect(isIdempotencyKeyHeaderAcceptable(requestWith(null))).toBe(true);
    expect(
      isIdempotencyKeyHeaderAcceptable(requestWith(crypto.randomUUID()))
    ).toBe(true);
    expect(isIdempotencyKeyHeaderAcceptable(requestWith("forged-stop-1"))).toBe(
      true
    );
    expect(
      isIdempotencyKeyHeaderAcceptable(requestWith("sync:node-1:batch-42"))
    ).toBe(true);
    expect(isIdempotencyKeyHeaderAcceptable(requestWith("a".repeat(255)))).toBe(
      true
    );
  });

  test("rejects an oversized key (256 chars and ~3 KB)", () => {
    expect(isIdempotencyKeyHeaderAcceptable(requestWith("a".repeat(256)))).toBe(
      false
    );
    expect(
      isIdempotencyKeyHeaderAcceptable(requestWith("a".repeat(3000)))
    ).toBe(false);
  });

  test("rejects an empty key and keys with whitespace or non-ASCII", () => {
    expect(isIdempotencyKeyHeaderAcceptable(requestWith(""))).toBe(false);
    expect(isIdempotencyKeyHeaderAcceptable(requestWith("a b"))).toBe(false);
    expect(isIdempotencyKeyHeaderAcceptable(requestWith("kunci-é"))).toBe(
      false
    );
  });

  test("the refusal is a 400 in the standard error envelope", async () => {
    const response = invalidIdempotencyKeyResponse();

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_INVALID");
  });
});

describe("Idempotency-Key bound is wired into the middleware in the right order", () => {
  const source = readFileSync("src/middleware.ts", "utf8");
  const bound = source.indexOf("isIdempotencyKeyHeaderAcceptable(context");
  const bodyCeiling = source.indexOf("checkContentLengthCeiling(context");
  const authBoundary = source.indexOf("requiresAuthenticatedCallerBeforeBody(");
  const publicBranch = source.indexOf("resolvePublicRedirectForRequest(");

  test("the check exists, is scoped to /api/, and returns before any route runs", () => {
    expect(bound).toBeGreaterThan(-1);
    const window = source.slice(bound - 120, bound + 200);
    expect(window).toContain("API_PREFIX");
    expect(window).toContain("invalidIdempotencyKeyResponse()");
  });

  test("it runs after the body ceiling and before authentication and routing", () => {
    expect(bodyCeiling).toBeGreaterThan(-1);
    expect(bound).toBeGreaterThan(bodyCeiling);
    expect(bound).toBeLessThan(authBoundary);
    expect(bound).toBeLessThan(publicBranch);
  });
});
