/**
 * The REAL pre-session routes behind the public-form challenge seam (Issue
 * #1353). No database: a refused challenge returns BEFORE any database work, so
 * a refusal reaching the client with no database configured also proves the
 * ordering (challenge before the identity lookup / email enqueue / password
 * hash). The success path through these routes is covered by
 * `turnstile-login-e2e.test.ts` and the password-reset / registration suites.
 *
 * MUTATION PROOF: delete the `if (challengeRefusal) return ...` of
 * `password/forgot.ts` and the forgot cases go RED.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { APIRoute } from "astro";

import { POST as forgotPOST } from "../src/pages/api/v1/auth/password/forgot";
import { POST as resetPOST } from "../src/pages/api/v1/auth/password/reset";
import { POST as loginPOST } from "../src/pages/api/v1/auth/login";
import { resetPublicFormChallengeForTests } from "../src/lib/security/public-form-challenge";
import { resetRateLimitForTests } from "../src/lib/security/rate-limit";
import { resetProviderCircuitBreakersForTests } from "../src/lib/database/circuit-breaker";
import { installExtensionPointSource } from "../src/modules/_shared/extension-point-source";
import { listModules } from "../src/modules";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ENV_KEYS = [
  "AUTH_ONLINE_SECURITY_ENABLED",
  "AUTH_ONLINE_SECURITY_PROFILE",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_EXPECTED_HOSTNAME"
] as const;

let ipCounter = 0;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let fetchCalls = 0;

function cookies() {
  return {
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
    has: () => false
  };
}

async function call(
  handler: APIRoute,
  body: unknown,
  headers: Record<string, string> = { "x-awcms-tenant-id": TENANT }
) {
  ipCounter += 1;
  const response = (await handler({
    request: new Request("http://localhost/api/v1/route", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body)
    }),
    cookies: cookies(),
    clientAddress: `198.51.100.${(ipCounter % 250) + 1}`,
    locals: {}
  } as never)) as Response;

  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null
  };
}

beforeEach(() => {
  installExtensionPointSource(listModules);
  resetPublicFormChallengeForTests();
  resetRateLimitForTests();
  resetProviderCircuitBreakersForTests();
  fetchCalls = 0;

  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
  }

  process.env.AUTH_ONLINE_SECURITY_ENABLED = "true";
  process.env.AUTH_ONLINE_SECURITY_PROFILE = "full_online";
  process.env.TURNSTILE_ENABLED = "true";
  process.env.TURNSTILE_SITE_KEY = "site";
  process.env.TURNSTILE_SECRET_KEY = `sk_${crypto.randomUUID()}`;
  process.env.TURNSTILE_EXPECTED_HOSTNAME = "app.example.test";
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return Response.json({ success: false, "error-codes": ["invalid-input"] });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;

  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const FORMS: ReadonlyArray<
  [string, APIRoute, unknown, Record<string, string>?]
> = [
  ["forgot", forgotPOST, { loginIdentifier: "someone@example.test" }],
  [
    "reset",
    resetPOST,
    { token: "tok", newPassword: "a-long-enough-password-1" }
  ],
  [
    "login",
    loginPOST,
    { loginIdentifier: "someone", password: "pw-long-enough-1" }
  ],
  [
    "tenantless login",
    loginPOST,
    { loginIdentifier: "someone", password: "pw-long-enough-1" },
    {}
  ]
];

describe("Turnstile through the seam keeps its published contract", () => {
  for (const [name, handler, body, headers] of FORMS) {
    test(`${name}: no token -> 400 TURNSTILE_REQUIRED, no siteverify call`, async () => {
      const result = await call(handler, body, headers);

      expect(result.status).toBe(400);
      expect(result.body?.error?.code).toBe("TURNSTILE_REQUIRED");
      expect(fetchCalls).toBe(0);
    });

    test(`${name}: a rejected token -> 400 TURNSTILE_INVALID, then replay is refused without a second siteverify`, async () => {
      const token = `tok_${crypto.randomUUID()}`;
      const first = await call(
        handler,
        { ...(body as object), turnstileToken: token },
        headers
      );
      const replay = await call(
        handler,
        { ...(body as object), turnstileToken: token },
        headers
      );

      expect(first.status).toBe(400);
      expect(first.body?.error?.code).toBe("TURNSTILE_INVALID");
      expect(replay.body?.error?.code).toBe("TURNSTILE_INVALID");
      expect(fetchCalls).toBe(1);
    });

    test(`${name}: the neutral challengeToken field is read as well`, async () => {
      const result = await call(
        handler,
        { ...(body as object), challengeToken: `tok_${crypto.randomUUID()}` },
        headers
      );

      expect(result.body?.error?.code).toBe("TURNSTILE_INVALID");
      expect(fetchCalls).toBe(1);
    });
  }

  test("Turnstile off: forgot is not challenged at all (it proceeds to the database step, which this suite has none of)", async () => {
    process.env.TURNSTILE_ENABLED = "false";

    await expect(
      call(forgotPOST, { loginIdentifier: "someone@example.test" })
    ).rejects.toThrow(/DATABASE_URL/);
    expect(fetchCalls).toBe(0);
  });
});

describe("every platform pre-session route goes through the seam", () => {
  const ROUTES: ReadonlyArray<[string, number]> = [
    ["src/pages/api/v1/auth/login.ts", 2],
    ["src/pages/api/v1/auth/register.ts", 1],
    ["src/pages/api/v1/auth/password/forgot.ts", 1],
    ["src/pages/api/v1/auth/password/reset.ts", 1],
    ["src/pages/api/v1/auth/invitations/[token]/accept.ts", 1],
    ["src/pages/api/v1/setup/initialize.ts", 1]
  ];

  for (const [file, expected] of ROUTES) {
    test(`${file}: ${expected} seam call(s), no direct Turnstile call`, () => {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const calls = text.match(/await enforcePublicFormCaptcha\(/g) ?? [];

      expect(calls).toHaveLength(expected);
      expect(text).not.toContain("enforceTurnstileIfRequired");
    });
  }
});
