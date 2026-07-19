/**
 * Turnstile enforcement + config/preflight matrix (Issue #186).
 *
 * `enforceTurnstileIfRequired` is the one function the login and setup routes
 * call. These tests prove:
 *  - DISABLED/LAN profile → ok with ZERO outbound call (a `globalThis.fetch`
 *    spy asserts the count is 0), and this holds even when TURNSTILE_ENABLED is
 *    "true" but the deployment profile is not full_online (fully OFF on LAN);
 *  - the full-online profile fails closed on missing token / misconfiguration /
 *    Cloudflare rejection / hostname+action mismatch, always with ONE generic
 *    code (no oracle);
 *  - config:validate + security:readiness agree across the LAN / full-online
 *    valid / full-online misconfigured matrix, and never print the secret.
 *
 * Secret/token are generated at RUNTIME (no static literal for GitGuardian).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  enforceTurnstileIfRequired,
  LOGIN_TURNSTILE_ACTION,
  isTurnstileRequired
} from "../src/lib/security/turnstile";
import { resetProviderCircuitBreakersForTests } from "../src/lib/database/circuit-breaker";
import { setLogSink } from "../src/lib/logging/logger";
import { validateEnv } from "../scripts/validate-env";
import {
  checkOnlineAuthSecurityReady,
  checkTurnstileReady
} from "../scripts/security-readiness";

function randomOpaque(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}${crypto.randomUUID()}`.replace(
    /-/g,
    ""
  );
}

const SECRET = randomOpaque("sk");
const TOKEN = randomOpaque("tok");
const HOSTNAME = "app.example.test";

const realFetch = globalThis.fetch;
let fetchCalls = 0;
let siteverify: () => Response = () =>
  Response.json({ success: true, hostname: HOSTNAME, action: "login" });

function installFetchSpy(): void {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return siteverify();
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetProviderCircuitBreakersForTests();
  setLogSink(() => undefined); // swallow logs; assertions below don't need them
  installFetchSpy();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setLogSink(null);
});

const fullOnlineEnv = (
  over: Record<string, string> = {}
): NodeJS.ProcessEnv => ({
  AUTH_ONLINE_SECURITY_ENABLED: "true",
  AUTH_ONLINE_SECURITY_PROFILE: "full_online",
  TURNSTILE_ENABLED: "true",
  TURNSTILE_SITE_KEY: "public-site-key",
  TURNSTILE_SECRET_KEY: SECRET,
  TURNSTILE_EXPECTED_HOSTNAME: HOSTNAME,
  ...over
});

const login = { action: LOGIN_TURNSTILE_ACTION };

describe("enforceTurnstileIfRequired — disabled / LAN makes NO outbound call", () => {
  test("empty env (LAN/offline default) → ok, zero fetch calls", async () => {
    const env: NodeJS.ProcessEnv = {};
    expect(isTurnstileRequired(env)).toBe(false);

    const result = await enforceTurnstileIfRequired(TOKEN, "1.2.3.4", {
      ...login,
      env
    });

    expect(result).toEqual({ ok: true });
    expect(fetchCalls).toBe(0);
  });

  test("TURNSTILE_ENABLED=true but LAN profile → still fully OFF, zero fetch calls", async () => {
    // The flag alone must never activate Turnstile without the full-online
    // deployment profile — this is the "fully off on LAN even if the key is
    // present" guarantee.
    const env = fullOnlineEnv({
      AUTH_ONLINE_SECURITY_ENABLED: "false",
      AUTH_ONLINE_SECURITY_PROFILE: "disabled"
    });
    expect(isTurnstileRequired(env)).toBe(false);

    const result = await enforceTurnstileIfRequired(TOKEN, "1.2.3.4", {
      ...login,
      env
    });

    expect(result).toEqual({ ok: true });
    expect(fetchCalls).toBe(0);
  });
});

describe("enforceTurnstileIfRequired — full-online fail-closed", () => {
  test("missing token → TURNSTILE_REQUIRED, no outbound call", async () => {
    const result = await enforceTurnstileIfRequired(undefined, "1.2.3.4", {
      ...login,
      env: fullOnlineEnv()
    });

    expect(result).toEqual({ ok: false, code: "TURNSTILE_REQUIRED" });
    expect(fetchCalls).toBe(0);
  });

  test("misconfigured (no secret) → TURNSTILE_INVALID, no outbound call", async () => {
    const result = await enforceTurnstileIfRequired(TOKEN, "1.2.3.4", {
      ...login,
      env: fullOnlineEnv({ TURNSTILE_SECRET_KEY: "" })
    });

    expect(result).toEqual({ ok: false, code: "TURNSTILE_INVALID" });
    expect(fetchCalls).toBe(0);
  });

  test("misconfigured (no expected hostname) → TURNSTILE_INVALID, no outbound call", async () => {
    const result = await enforceTurnstileIfRequired(TOKEN, "1.2.3.4", {
      ...login,
      env: fullOnlineEnv({ TURNSTILE_EXPECTED_HOSTNAME: "" })
    });

    expect(result).toEqual({ ok: false, code: "TURNSTILE_INVALID" });
    expect(fetchCalls).toBe(0);
  });

  test("valid token → ok, exactly one outbound verification call", async () => {
    siteverify = () =>
      Response.json({
        success: true,
        hostname: HOSTNAME,
        action: "login",
        challenge_ts: new Date().toISOString()
      });

    const result = await enforceTurnstileIfRequired(TOKEN, "1.2.3.4", {
      ...login,
      env: fullOnlineEnv()
    });

    expect(result).toEqual({ ok: true });
    expect(fetchCalls).toBe(1);
  });

  test("Cloudflare rejection → generic TURNSTILE_INVALID (no oracle)", async () => {
    siteverify = () => Response.json({ success: false, "error-codes": ["x"] });

    const result = await enforceTurnstileIfRequired(TOKEN, "1.2.3.4", {
      ...login,
      env: fullOnlineEnv()
    });

    expect(result).toEqual({ ok: false, code: "TURNSTILE_INVALID" });
  });

  test("hostname/action mismatch collapse to the SAME generic code as a rejection", async () => {
    siteverify = () =>
      Response.json({
        success: true,
        hostname: "attacker.example",
        action: "phishing",
        challenge_ts: new Date().toISOString()
      });

    const result = await enforceTurnstileIfRequired(TOKEN, "1.2.3.4", {
      ...login,
      env: fullOnlineEnv()
    });

    // Same code as a plain rejection above — an unauthenticated caller can not
    // tell "hostname wrong" from "token bad" from "server misconfigured".
    expect(result).toEqual({ ok: false, code: "TURNSTILE_INVALID" });
  });
});

describe("config/preflight matrix — LAN / full-online valid / full-online misconfigured", () => {
  const base = {
    APP_ENV: "development",
    APP_URL: "http://localhost:4321",
    DATABASE_URL: "postgres://a:b@localhost:5432/c"
  } as Record<string, string | undefined>;

  test("LAN: validate-env clean; both readiness checks are informational passes (disabled intentionally)", () => {
    expect(validateEnv(base)).toEqual([]);

    const gate = checkOnlineAuthSecurityReady(base);
    const turnstile = checkTurnstileReady(base);

    expect(gate).toMatchObject({ severity: "info", status: "pass" });
    expect(turnstile).toMatchObject({ severity: "info", status: "pass" });
    expect(gate.evidence).toContain("disabled intentionally");
    expect(turnstile.evidence).toContain("disabled intentionally");
  });

  test("full-online valid: validate-env clean; both readiness checks pass at critical severity; secret never printed", () => {
    const env = {
      ...base,
      AUTH_ONLINE_SECURITY_ENABLED: "true",
      AUTH_ONLINE_SECURITY_PROFILE: "full_online",
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "public-site-key",
      TURNSTILE_SECRET_KEY: SECRET,
      TURNSTILE_EXPECTED_HOSTNAME: HOSTNAME
    };

    expect(validateEnv(env)).toEqual([]);

    const gate = checkOnlineAuthSecurityReady(env);
    const turnstile = checkTurnstileReady(env);

    expect(gate).toMatchObject({ severity: "critical", status: "pass" });
    expect(turnstile).toMatchObject({ severity: "critical", status: "pass" });
    expect(JSON.stringify(turnstile)).not.toContain(SECRET);
  });

  test("full-online MISCONFIGURED: profile wrong + Turnstile keys missing → both fail critical, and validate-env reports both", () => {
    const env = {
      ...base,
      AUTH_ONLINE_SECURITY_ENABLED: "true",
      AUTH_ONLINE_SECURITY_PROFILE: "disabled", // contradictory
      TURNSTILE_ENABLED: "true"
      // no site key / secret / hostname
    };

    const problems = validateEnv(env);
    expect(
      problems.some((p) => p.startsWith("AUTH_ONLINE_SECURITY_ENABLED=true"))
    ).toBe(true);
    expect(problems.some((p) => p.startsWith("TURNSTILE_SITE_KEY"))).toBe(true);
    expect(problems.some((p) => p.startsWith("TURNSTILE_SECRET_KEY"))).toBe(
      true
    );
    expect(
      problems.some((p) => p.startsWith("TURNSTILE_EXPECTED_HOSTNAME"))
    ).toBe(true);

    const gate = checkOnlineAuthSecurityReady(env);
    const turnstile = checkTurnstileReady(env);

    expect(gate).toMatchObject({ severity: "critical", status: "fail" });
    expect(turnstile).toMatchObject({ severity: "critical", status: "fail" });
    // Distinguishes misconfigured from "disabled intentionally".
    expect(gate.evidence).toContain("MISCONFIGURED");
  });

  test("Turnstile fully configured but profile gate OFF → warning INERT, not a silent green (F3)", () => {
    // Keys staged, TURNSTILE_ENABLED=true, but the full-online profile gate is
    // off — isTurnstileRequired() is false, so login runs WITHOUT Turnstile.
    const env = {
      ...base,
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "public-site-key",
      TURNSTILE_SECRET_KEY: SECRET,
      TURNSTILE_EXPECTED_HOSTNAME: HOSTNAME
      // AUTH_ONLINE_SECURITY_* unset → gate off
    };

    // validate-env stays clean (staging is legitimate), but readiness must warn.
    expect(validateEnv(env)).toEqual([]);

    const turnstile = checkTurnstileReady(env);
    expect(turnstile).toMatchObject({ severity: "warning", status: "fail" });
    expect(turnstile.evidence).toContain("INERT");
    expect(JSON.stringify(turnstile)).not.toContain(SECRET);
  });
});
