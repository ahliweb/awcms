/**
 * Mailketing v2 pure contract (Issue #1159, ADR-0151 §1). Fixtures are built
 * from the DOCUMENTED contract; nothing here was checked against the live API.
 */
import { describe, expect, test } from "bun:test";

import {
  MAILKETING_V2_MAX_RETRY_AFTER_MS,
  MAILKETING_V2_MIN_RETRY_AFTER_MS,
  buildMailketingV2Headers,
  buildMailketingV2SendBody,
  classifyMailketingV2Response,
  parseRetryAfterMs,
  resolveMailketingApiVersion,
  resolveMailketingV2BaseUrl
} from "../src/modules/email/domain/mailketing-v2-contract";

const NOW = new Date("2026-11-02T10:00:00.000Z");
const env = (v?: string) =>
  ({ EMAIL_MAILKETING_API_VERSION: v }) as unknown as NodeJS.ProcessEnv;

describe("resolveMailketingApiVersion (fail-closed switch)", () => {
  test("unset / blank = v1, the documented default", () => {
    expect(resolveMailketingApiVersion(env())).toEqual({
      ok: true,
      version: "v1"
    });
    expect(resolveMailketingApiVersion(env("  "))).toEqual({
      ok: true,
      version: "v1"
    });
  });

  test("v1 and v2 are accepted exactly", () => {
    expect(resolveMailketingApiVersion(env("v1"))).toEqual({
      ok: true,
      version: "v1"
    });
    expect(resolveMailketingApiVersion(env(" v2 "))).toEqual({
      ok: true,
      version: "v2"
    });
  });

  test.each(["V2", "2", "v3", "true", "v2.0.2"])(
    "%p is an error, never silently v1",
    (value) => {
      expect(resolveMailketingApiVersion(env(value)).ok).toBe(false);
    }
  );
});

describe("resolveMailketingV2BaseUrl (fixed allow-listed host)", () => {
  test("unset = the fixed production host", () => {
    expect(resolveMailketingV2BaseUrl(undefined)).toEqual({
      ok: true,
      baseUrl: "https://api.mailketing.co.id"
    });
  });

  test.each([
    "https://api.mailketing.co.id",
    "https://api.mailketing.co.id/",
    "https://API.MAILKETING.CO.ID"
  ])("accepts %p", (raw) => {
    expect(resolveMailketingV2BaseUrl(raw).ok).toBe(true);
  });

  test.each([
    "http://api.mailketing.co.id",
    "https://evil.example",
    "https://api.mailketing.co.id.evil.example",
    "https://evil.example/@api.mailketing.co.id",
    "https://user:pw@api.mailketing.co.id",
    "https://api.mailketing.co.id:8443",
    "https://api.mailketing.co.id/api/v2",
    "https://api.mailketing.co.id/?x=1",
    "https://api.mailketing.co.id/#x",
    "http://127.0.0.1:9000",
    "https://169.254.169.254",
    "not a url"
  ])("rejects %p", (raw) => {
    expect(resolveMailketingV2BaseUrl(raw).ok).toBe(false);
  });

  test("the rejection reason never echoes the supplied value", () => {
    const result = resolveMailketingV2BaseUrl("https://user:secret@evil.test");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("evil.test");
  });
});

describe("request building", () => {
  test("the token is in the Authorization header only", () => {
    const headers = buildMailketingV2Headers("tok-123", true);
    expect(headers.Authorization).toBe("Bearer tok-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(buildMailketingV2Headers("tok-123", false)["Content-Type"]).toBe(
      undefined
    );
  });

  test("the JSON body has no credential field", () => {
    const body = buildMailketingV2SendBody({
      recipient: "a@example.com",
      fromEmail: "f@example.com",
      fromName: "F",
      subject: "s",
      content: "c"
    });
    expect(body).not.toMatch(/token|api_key|authorization/i);
    expect(JSON.parse(body).recipient).toBe("a@example.com");
  });
});

describe("parseRetryAfterMs", () => {
  test("seconds, clamped", () => {
    expect(parseRetryAfterMs("30", NOW)).toBe(30_000);
    expect(parseRetryAfterMs("0", NOW)).toBe(MAILKETING_V2_MIN_RETRY_AFTER_MS);
    expect(parseRetryAfterMs("999999999", NOW)).toBe(
      MAILKETING_V2_MAX_RETRY_AFTER_MS
    );
  });

  test("HTTP-date relative to now", () => {
    expect(
      parseRetryAfterMs(new Date(NOW.getTime() + 90_000).toUTCString(), NOW)
    ).toBe(90_000);
  });

  test("absent or garbage = undefined", () => {
    expect(parseRetryAfterMs(null, NOW)).toBeUndefined();
    expect(parseRetryAfterMs("soon", NOW)).toBeUndefined();
    expect(parseRetryAfterMs("-5", NOW)).toBeUndefined();
  });
});

describe("classifyMailketingV2Response", () => {
  const classify = (
    status: number,
    body: string,
    retryAfter: string | null = null
  ) => classifyMailketingV2Response(status, body, retryAfter, NOW);

  test("200 success:true = accepted, message_id kept", () => {
    expect(
      classify(200, '{"success":true,"data":{"message_id":"msg_abc-123"}}')
    ).toEqual({ kind: "accepted", messageId: "msg_abc-123" });
  });

  test("200 success:true with an unsafe or missing message_id is still accepted, id dropped", () => {
    expect(
      classify(200, '{"success":true,"data":{"message_id":"a b\\n<script>"}}')
    ).toEqual({ kind: "accepted", messageId: undefined });
    expect(classify(200, '{"success":true}')).toEqual({
      kind: "accepted",
      messageId: undefined
    });
  });

  test("200 success:false = refused; only a safe code survives", () => {
    expect(
      classify(
        200,
        '{"success":false,"error":{"code":"INVALID_RECIPIENT","message":"user@example.com is bad"}}'
      )
    ).toEqual({ kind: "refused", code: "INVALID_RECIPIENT" });
    expect(
      classify(
        200,
        '{"success":false,"error":{"code":"has space and user@example.com"}}'
      )
    ).toEqual({ kind: "refused", code: undefined });
  });

  test("200 with non-JSON, a non-object, or no boolean success = malformed", () => {
    expect(classify(200, "<html>")).toEqual({ kind: "malformed" });
    expect(classify(200, "[]")).toEqual({ kind: "malformed" });
    expect(classify(200, '{"success":"yes"}')).toEqual({ kind: "malformed" });
    expect(classify(200, "")).toEqual({ kind: "malformed" });
  });

  test.each([
    [401, "auth"],
    [402, "credit"],
    [403, "sender"],
    [404, "invalid"],
    [422, "invalid"],
    [400, "invalid"],
    [500, "server"],
    [503, "server"],
    [302, "redirect"]
  ])("HTTP %i = %s", (status, category) => {
    expect(classify(status, "{}")).toMatchObject({
      kind: "http",
      status,
      category
    });
  });

  test("429 carries the clamped Retry-After", () => {
    expect(classify(429, "{}", "12")).toMatchObject({
      category: "rate_limited",
      retryAfterMs: 12_000
    });
    expect(classify(429, "{}")).toMatchObject({
      category: "rate_limited",
      retryAfterMs: undefined
    });
  });
});
