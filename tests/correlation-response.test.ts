import { describe, expect, test } from "bun:test";

import {
  isApiJsonResponseCandidate,
  mergeCorrelationIdIntoApiPayload
} from "../src/lib/logging/correlation-response";

describe("isApiJsonResponseCandidate", () => {
  test("true for /api/* JSON responses", () => {
    expect(
      isApiJsonResponseCandidate(
        "/api/v1/logs/audit",
        "application/json; charset=utf-8"
      )
    ).toBe(true);
  });

  test("false outside /api/*", () => {
    expect(
      isApiJsonResponseCandidate("/admin/dashboard", "application/json")
    ).toBe(false);
  });

  test("false for non-JSON content types under /api/*", () => {
    expect(
      isApiJsonResponseCandidate("/api/v1/health", "text/html; charset=utf-8")
    ).toBe(false);
  });

  test("false when content-type is missing", () => {
    expect(isApiJsonResponseCandidate("/api/v1/health", null)).toBe(false);
  });
});

describe("mergeCorrelationIdIntoApiPayload", () => {
  test("fills meta.correlationId when missing (the common case — every endpoint except the one demo endpoint before Issue #447)", () => {
    const result = mergeCorrelationIdIntoApiPayload(
      { success: true, data: { ok: true }, meta: {} },
      "corr-1"
    );

    expect(result.changed).toBe(true);
    expect(result.payload).toEqual({
      success: true,
      data: { ok: true },
      meta: { correlationId: "corr-1" }
    });
  });

  test("does not overwrite a correlationId a handler already set explicitly", () => {
    const result = mergeCorrelationIdIntoApiPayload(
      { success: true, data: {}, meta: { correlationId: "explicit-1" } },
      "middleware-generated"
    );

    expect(result.changed).toBe(false);
    expect(
      (result.payload as { meta: { correlationId: string } }).meta.correlationId
    ).toBe("explicit-1");
  });

  test("preserves other meta fields untouched", () => {
    const result = mergeCorrelationIdIntoApiPayload(
      { success: true, data: {}, meta: { requestId: "req-1" } },
      "corr-2"
    );

    expect(result.payload).toEqual({
      success: true,
      data: {},
      meta: { requestId: "req-1", correlationId: "corr-2" }
    });
  });

  test("leaves a payload without a meta object untouched (defensive, shouldn't happen for ok()/fail())", () => {
    const payload = { success: true, data: {} };
    const result = mergeCorrelationIdIntoApiPayload(payload, "corr-3");

    expect(result.changed).toBe(false);
    expect(result.payload).toBe(payload);
  });

  test("leaves non-object payloads untouched", () => {
    expect(mergeCorrelationIdIntoApiPayload(null, "corr-4")).toEqual({
      changed: false,
      payload: null
    });
    expect(mergeCorrelationIdIntoApiPayload("plain string", "corr-4")).toEqual({
      changed: false,
      payload: "plain string"
    });
    expect(mergeCorrelationIdIntoApiPayload([1, 2, 3], "corr-4")).toEqual({
      changed: false,
      payload: [1, 2, 3]
    });
  });

  test("does not mutate the original payload object", () => {
    const payload = { success: true, data: {}, meta: {} };
    mergeCorrelationIdIntoApiPayload(payload, "corr-5");

    expect(payload.meta).toEqual({});
  });
});
