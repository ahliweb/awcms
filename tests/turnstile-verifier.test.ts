/**
 * Cloudflare Turnstile verifier unit tests (Issue #186).
 *
 * Drives `verifyTurnstileToken` against a LOCAL fake siteverify server
 * (`Bun.serve`) injected via `config.verifyUrl` — the same test seam the OIDC
 * fake-IdP and Cloudflare DNS adapter use, so no real network call is ever made
 * and Cloudflare's contract is stood in for deterministically.
 *
 * All secret/token values are generated at RUNTIME (no static literal that
 * GitGuardian could flag; `tests/` is also outside the secret scanner's paths).
 *
 * MUTATION PROOFS (repo security-readiness discipline — "abaikan hostname/action
 * harus membuat test merah"):
 *  - delete the hostname check in `verifyTurnstileToken` → "hostname mismatch"
 *    test goes RED (a wrong-hostname token is accepted).
 *  - delete the action check → "action mismatch" test goes RED.
 *  - delete the freshness check → "stale timestamp" test goes RED.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { verifyTurnstileToken } from "../src/lib/security/turnstile";
import { resetProviderCircuitBreakersForTests } from "../src/lib/database/circuit-breaker";
import { setLogSink, type LogEntry } from "../src/lib/logging/logger";

function randomOpaque(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}${crypto.randomUUID()}`.replace(
    /-/g,
    ""
  );
}

const SECRET = randomOpaque("sk");
const TOKEN = randomOpaque("tok");
const HOSTNAME = "app.example.test";
const ACTION = "login";
const FIXED_NOW = new Date("2026-07-19T00:00:00.000Z");

type FakeBehavior =
  | { kind: "json"; status?: number; body: unknown }
  | { kind: "text"; status?: number; body: string }
  | { kind: "delayMs"; ms: number; body: unknown }
  | { kind: "oversize"; bytes: number };

let behavior: FakeBehavior = { kind: "json", body: { success: true } };
let server: ReturnType<typeof Bun.serve>;
let verifyUrl = "";
let requestCount = 0;
let logs: LogEntry[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch() {
      requestCount += 1;

      if (behavior.kind === "delayMs") {
        await Bun.sleep(behavior.ms);
        return Response.json(behavior.body as Record<string, unknown>);
      }

      if (behavior.kind === "text") {
        return new Response(behavior.body, {
          status: behavior.status ?? 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (behavior.kind === "oversize") {
        return new Response("x".repeat(behavior.bytes), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return Response.json(behavior.body as Record<string, unknown>, {
        status: behavior.status ?? 200
      });
    }
  });
  verifyUrl = `http://127.0.0.1:${server.port}/siteverify`;
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  resetProviderCircuitBreakersForTests();
  requestCount = 0;
  logs = [];
  setLogSink((entry) => logs.push(entry));
});

afterEach(() => {
  setLogSink(null);
});

const config = () => ({ secretKey: SECRET, verifyUrl, timeoutMs: 500 });
const expectations = (over: Record<string, unknown> = {}) => ({
  action: ACTION,
  hostname: HOSTNAME,
  maxTokenAgeSec: 300,
  now: FIXED_NOW,
  ...over
});

describe("verifyTurnstileToken — success + Cloudflare-side rejection", () => {
  test("valid token with matching hostname + action + fresh timestamp → ok", async () => {
    behavior = {
      kind: "json",
      body: {
        success: true,
        hostname: HOSTNAME,
        action: ACTION,
        challenge_ts: FIXED_NOW.toISOString()
      }
    };

    const result = await verifyTurnstileToken(TOKEN, config(), expectations());

    expect(result.ok).toBe(true);
    expect(requestCount).toBe(1);
  });

  test("success:false (bad/expired/reused token) → rejected, not retryable", async () => {
    behavior = {
      kind: "json",
      body: { success: false, "error-codes": ["invalid-input-response"] }
    };

    const result = await verifyTurnstileToken(TOKEN, config(), expectations());

    expect(result).toMatchObject({
      ok: false,
      reason: "rejected",
      retryable: false
    });
  });
});

describe("verifyTurnstileToken — provider failures", () => {
  test("non-2xx status → provider_error (retryable on 5xx)", async () => {
    behavior = { kind: "json", status: 500, body: {} };

    const result = await verifyTurnstileToken(TOKEN, config(), expectations());

    expect(result).toMatchObject({ ok: false, reason: "provider_error" });
  });

  test("malformed (non-JSON) 2xx payload → provider_error", async () => {
    behavior = { kind: "text", status: 200, body: "definitely not json" };

    const result = await verifyTurnstileToken(TOKEN, config(), expectations());

    expect(result).toMatchObject({ ok: false, reason: "provider_error" });
  });

  test("timeout (slow provider) → provider_unavailable, retryable", async () => {
    behavior = {
      kind: "delayMs",
      ms: 400,
      body: { success: true, hostname: HOSTNAME, action: ACTION }
    };

    const result = await verifyTurnstileToken(
      TOKEN,
      { secretKey: SECRET, verifyUrl, timeoutMs: 40 },
      expectations()
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "provider_unavailable",
      retryable: true
    });
  });

  test("oversized response body (exceeds cap) → provider_error", async () => {
    behavior = { kind: "oversize", bytes: 100 };

    const result = await verifyTurnstileToken(
      TOKEN,
      { secretKey: SECRET, verifyUrl, timeoutMs: 500, maxResponseBytes: 10 },
      expectations()
    );

    expect(result).toMatchObject({ ok: false, reason: "provider_error" });
  });

  test("open circuit breaker fails closed without an outbound call and logs it", async () => {
    behavior = { kind: "json", status: 500, body: {} };

    // Trip the shared breaker (default threshold 5) at a fixed clock so it is
    // open for the 6th attempt.
    for (let i = 0; i < 5; i += 1) {
      await verifyTurnstileToken(TOKEN, config(), expectations());
    }
    const callsBefore = requestCount;

    const result = await verifyTurnstileToken(TOKEN, config(), expectations());

    expect(result).toMatchObject({
      ok: false,
      reason: "provider_unavailable"
    });
    expect(requestCount).toBe(callsBefore); // no 6th outbound call
    expect(
      logs.some((e) => e.message === "turnstile.circuit_breaker_open")
    ).toBe(true);
  });
});

describe("verifyTurnstileToken — expectation enforcement (MUTATION PROOFS)", () => {
  test("hostname mismatch → rejected (delete the hostname check ⇒ RED)", async () => {
    behavior = {
      kind: "json",
      body: {
        success: true,
        hostname: "attacker.example",
        action: ACTION,
        challenge_ts: FIXED_NOW.toISOString()
      }
    };

    const result = await verifyTurnstileToken(TOKEN, config(), expectations());

    expect(result).toMatchObject({ ok: false, reason: "hostname_mismatch" });
  });

  test("action mismatch → rejected (delete the action check ⇒ RED)", async () => {
    behavior = {
      kind: "json",
      body: {
        success: true,
        hostname: HOSTNAME,
        action: "setup",
        challenge_ts: FIXED_NOW.toISOString()
      }
    };

    const result = await verifyTurnstileToken(
      TOKEN,
      config(),
      expectations({ action: "login" })
    );

    expect(result).toMatchObject({ ok: false, reason: "action_mismatch" });
  });

  test("stale challenge_ts → rejected (delete the freshness check ⇒ RED)", async () => {
    behavior = {
      kind: "json",
      body: {
        success: true,
        hostname: HOSTNAME,
        action: ACTION,
        challenge_ts: new Date(FIXED_NOW.getTime() - 3_600_000).toISOString()
      }
    };

    const result = await verifyTurnstileToken(TOKEN, config(), expectations());

    expect(result).toMatchObject({ ok: false, reason: "stale" });
  });

  test("missing challenge_ts with freshness required → stale (fail closed)", async () => {
    behavior = {
      kind: "json",
      body: { success: true, hostname: HOSTNAME, action: ACTION }
    };

    const result = await verifyTurnstileToken(TOKEN, config(), expectations());

    expect(result).toMatchObject({ ok: false, reason: "stale" });
  });
});

describe("verifyTurnstileToken — token/secret never leak", () => {
  test("neither the token nor the secret appears in any log line or returned detail", async () => {
    // Exercise every log-emitting path: rejection, provider error, thrown
    // network error, and (indirectly) the success path (which logs nothing).
    behavior = { kind: "json", body: { success: false, "error-codes": ["x"] } };
    const rejected = await verifyTurnstileToken(
      TOKEN,
      config(),
      expectations()
    );

    behavior = { kind: "json", status: 502, body: {} };
    const providerError = await verifyTurnstileToken(
      TOKEN,
      config(),
      expectations()
    );

    // Unreachable endpoint → fetch throws → caught + logged (redacted).
    const thrown = await verifyTurnstileToken(
      TOKEN,
      {
        secretKey: SECRET,
        verifyUrl: "http://127.0.0.1:1/nope",
        timeoutMs: 200
      },
      expectations()
    );

    const haystacks = [
      ...logs.map((entry) => JSON.stringify(entry)),
      JSON.stringify(rejected),
      JSON.stringify(providerError),
      JSON.stringify(thrown)
    ];

    for (const text of haystacks) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(SECRET);
    }
    // Sanity: we actually produced log lines to scan.
    expect(logs.length).toBeGreaterThan(0);
  });

  test("if an error message ever echoes the token or secret, both are actively [redacted] (F4)", async () => {
    // Force the token AND secret into a thrown error message, then prove the
    // redaction set scrubs BOTH — not merely that they happened to be absent.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error(`boom response=${TOKEN} secret=${SECRET}`);
    }) as unknown as typeof fetch;

    try {
      const result = await verifyTurnstileToken(
        TOKEN,
        config(),
        expectations()
      );

      expect(result.ok).toBe(false);
      const detail = result.ok ? "" : result.detail;
      expect(detail).toContain("[redacted]");
      expect(detail).not.toContain(TOKEN);
      expect(detail).not.toContain(SECRET);

      const loggedError = logs.find(
        (e) => e.message === "turnstile.provider_call_errored"
      );
      expect(loggedError).toBeDefined();
      expect(JSON.stringify(loggedError)).not.toContain(TOKEN);
      expect(JSON.stringify(loggedError)).not.toContain(SECRET);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
