/**
 * Route-level integration tests for Turnstile ENABLED (Issue #186, F2).
 *
 * Drives the ACTUAL Astro route handlers `auth/login.ts` and `setup/initialize.ts`
 * with the full-online profile gate ON and a FAKE Cloudflare siteverify (a
 * `globalThis.fetch` spy returning a controllable success/failure/action/hostname
 * — login/setup use `fetch` for NOTHING else, so the spy captures exactly the
 * siteverify call). Same fake-Astro-context pattern as `tests/mfa-login-e2e.test.ts`.
 *
 * Proves the wiring the unit tests cannot: that Turnstile runs BEFORE identity
 * lookup / password work on the real handler, fails closed with the right code,
 * lets a valid token PROCEED to the password path, and that each route binds to
 * its own action (login rejects a `setup` token and vice-versa).
 *
 * Env is set in beforeAll and restored in afterAll (no cross-file leak). Secret/
 * token values are generated at RUNTIME (no static literal for GitGuardian).
 *
 * MUTATION PROOF (repo discipline): delete the `if (!turnstileResult.ok) return
 * fail(...)` short-circuit in `login.ts` (or move Turnstile to AFTER password
 * verify) → the "missing token" and "rejected token" tests go RED.
 *
 * Requires a throwaway database with `sql/` applied; gated on `DATABASE_URL`.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import type { APIRoute } from "astro";

import { POST as loginPOST } from "../src/pages/api/v1/auth/login";
import { POST as setupPOST } from "../src/pages/api/v1/setup/initialize";
import { hashPassword } from "../src/lib/auth/password";
import { resetProviderCircuitBreakersForTests } from "../src/lib/database/circuit-breaker";

const DATABASE_URL =
  process.env.TURNSTILE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

function randomOpaque(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}${crypto.randomUUID()}`.replace(
    /-/g,
    ""
  );
}

const SECRET = randomOpaque("sk");
const SITE_KEY = randomOpaque("site");
const HOSTNAME = "app.example.test";
const PASSWORD = "correct horse battery staple";

/** Minimal AstroCookies stub — routes only use `.get(name)?.value` and `.set`. */
function fakeCookies() {
  const store = new Map<string, string>();
  return {
    store,
    get(name: string) {
      return store.has(name) ? { value: store.get(name)! } : undefined;
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    delete(name: string) {
      store.delete(name);
    },
    has(name: string) {
      return store.has(name);
    }
  };
}

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `192.0.2.${(ipCounter % 250) + 1}`;
}

type CallResult = { status: number; body: any };

async function callRoute(
  handler: APIRoute,
  opts: { headers?: Record<string, string>; body?: unknown }
): Promise<CallResult> {
  const headers = new Headers({
    "content-type": "application/json",
    ...(opts.headers ?? {})
  });
  const request = new Request("http://localhost/api/v1/route", {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const res = (await handler({
    request,
    cookies: fakeCookies(),
    clientAddress: nextIp(),
    locals: {}
  } as never)) as Response;
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// -- Fake Cloudflare siteverify (globalThis.fetch spy) ----------------------
const realFetch = globalThis.fetch;
let siteverifyBody: Record<string, unknown> = { success: true };
let siteverifyStatus = 200;
let fetchCalls = 0;
const outboundBodies: string[] = [];

function installFetchSpy(): void {
  globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
    fetchCalls += 1;
    if (init && typeof init.body === "string") {
      outboundBodies.push(init.body);
    }
    return Response.json(siteverifyBody, { status: siteverifyStatus });
  }) as unknown as typeof fetch;
}

function freshSuccess(action: string): Record<string, unknown> {
  return {
    success: true,
    hostname: HOSTNAME,
    action,
    challenge_ts: new Date().toISOString()
  };
}

describeOrSkip(
  "Turnstile ENABLED — route-level login + setup (real PostgreSQL)",
  () => {
    let sql: Bun.SQL;
    const createdTenantIds: string[] = [];
    const savedEnv: Record<string, string | undefined> = {};

    const TURNSTILE_ENV_KEYS = [
      "AUTH_ONLINE_SECURITY_ENABLED",
      "AUTH_ONLINE_SECURITY_PROFILE",
      "TURNSTILE_ENABLED",
      "TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "TURNSTILE_EXPECTED_HOSTNAME"
    ] as const;

    beforeAll(() => {
      sql = new Bun.SQL(DATABASE_URL!, { max: 4 });
      for (const key of TURNSTILE_ENV_KEYS) savedEnv[key] = process.env[key];
      process.env.AUTH_ONLINE_SECURITY_ENABLED = "true";
      process.env.AUTH_ONLINE_SECURITY_PROFILE = "full_online";
      process.env.TURNSTILE_ENABLED = "true";
      process.env.TURNSTILE_SITE_KEY = SITE_KEY;
      process.env.TURNSTILE_SECRET_KEY = SECRET;
      process.env.TURNSTILE_EXPECTED_HOSTNAME = HOSTNAME;
      installFetchSpy();
    });

    afterAll(async () => {
      globalThis.fetch = realFetch;
      for (const key of TURNSTILE_ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      // Clear the setup singleton FIRST: `awcms_setup_state.tenant_id` FK-refs a
      // bootstrapped tenant, so it must go before any `awcms_tenants` delete (and
      // restores the throwaway DB to its pre-test unclaimed state so it is not
      // left permanently "already initialized").
      await sql`DELETE FROM awcms_setup_state`;
      // Reverse any setup bootstrap that committed, and every seeded login tenant.
      // Child tables first (FK order): everything that references an identity/
      // role/tenant_user must be deleted before it.
      const setupTables = [
        "awcms_sessions",
        "awcms_audit_events",
        "awcms_abac_decision_logs",
        "awcms_access_assignments",
        "awcms_role_permissions",
        "awcms_roles",
        "awcms_tenant_users",
        "awcms_identities",
        "awcms_profiles",
        "awcms_offices",
        "awcms_tenant_settings"
      ];
      for (const tenantId of createdTenantIds) {
        await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
        for (const table of setupTables) {
          await sql.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [
            tenantId
          ]);
        }
        await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
      }
      await sql.close({ timeout: 5 });
    });

    beforeEach(() => {
      resetProviderCircuitBreakersForTests();
      fetchCalls = 0;
      outboundBodies.length = 0;
      siteverifyStatus = 200;
      siteverifyBody = freshSuccess("login");
    });

    async function seedTenantAndUser(): Promise<{
      tenantId: string;
      loginIdentifier: string;
    }> {
      const suffix = Math.random().toString(36).slice(2, 10);
      const tenant = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`turn-${suffix}`}, ${"Turnstile e2e"}) RETURNING id
    `) as { id: string }[];
      const tenantId = tenant[0]!.id;
      createdTenantIds.push(tenantId);
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      const loginIdentifier = `user-${suffix}`;
      const profile = (await sql`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', 'Turnstile User') RETURNING id
    `) as { id: string }[];
      const passwordHash = await hashPassword(PASSWORD);
      const identity = (await sql`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profile[0]!.id}, ${loginIdentifier}, ${passwordHash})
      RETURNING id
    `) as { id: string }[];
      await sql`
      INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
      VALUES (${tenantId}, ${identity[0]!.id}, 'active')
    `;
      return { tenantId, loginIdentifier };
    }

    // -- LOGIN ----------------------------------------------------------------

    test("(a) missing token → 400 TURNSTILE_REQUIRED, NO siteverify call, NO password acceptance", async () => {
      const { tenantId, loginIdentifier } = await seedTenantAndUser();

      // Correct password on purpose: if Turnstile did NOT short-circuit first,
      // this would succeed (200) — so a 400 TURNSTILE_REQUIRED proves the gate
      // ran BEFORE any identity lookup / password verification.
      const res = await callRoute(loginPOST, {
        headers: { "x-awcms-tenant-id": tenantId },
        body: { loginIdentifier, password: PASSWORD }
      });

      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe("TURNSTILE_REQUIRED");
      expect(fetchCalls).toBe(0);
    });

    test("(b) rejected token → 400 TURNSTILE_INVALID (siteverify called, login blocked)", async () => {
      const { tenantId, loginIdentifier } = await seedTenantAndUser();
      siteverifyBody = {
        success: false,
        "error-codes": ["invalid-input-response"]
      };

      const res = await callRoute(loginPOST, {
        headers: { "x-awcms-tenant-id": tenantId },
        body: {
          loginIdentifier,
          password: PASSWORD,
          turnstileToken: randomOpaque("tok")
        }
      });

      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe("TURNSTILE_INVALID");
      expect(fetchCalls).toBe(1);
    });

    test("(b') action mismatch (setup token at login) → 400 TURNSTILE_INVALID", async () => {
      const { tenantId, loginIdentifier } = await seedTenantAndUser();
      siteverifyBody = freshSuccess("setup"); // wrong action for the login route

      const res = await callRoute(loginPOST, {
        headers: { "x-awcms-tenant-id": tenantId },
        body: {
          loginIdentifier,
          password: PASSWORD,
          turnstileToken: randomOpaque("tok")
        }
      });

      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe("TURNSTILE_INVALID");
    });

    test("(c) valid token → login PROCEEDS to password path and succeeds (Turnstile is not the blocker)", async () => {
      const { tenantId, loginIdentifier } = await seedTenantAndUser();
      siteverifyBody = freshSuccess("login");

      const res = await callRoute(loginPOST, {
        headers: { "x-awcms-tenant-id": tenantId },
        body: {
          loginIdentifier,
          password: PASSWORD,
          turnstileToken: randomOpaque("tok")
        }
      });

      expect(res.status).toBe(200);
      expect(res.body?.success).toBe(true);
      expect(res.body?.data?.token).toBeTruthy();
      expect(fetchCalls).toBe(1);
    });

    test("(c') valid token + WRONG password → PROCEEDS past Turnstile to 401 AUTH_INVALID_CREDENTIALS", async () => {
      const { tenantId, loginIdentifier } = await seedTenantAndUser();
      siteverifyBody = freshSuccess("login");

      const res = await callRoute(loginPOST, {
        headers: { "x-awcms-tenant-id": tenantId },
        body: {
          loginIdentifier,
          password: "wrong-password",
          turnstileToken: randomOpaque("tok")
        }
      });

      // Not a Turnstile error — it got past Turnstile and password verification
      // is what denied it (proving Turnstile is not the account-enumeration gate).
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    test("(d) outbound siteverify carries the client token as `response` (never a secret leak beyond `secret`)", async () => {
      const { tenantId, loginIdentifier } = await seedTenantAndUser();
      const token = randomOpaque("tok");
      siteverifyBody = freshSuccess("login");

      await callRoute(loginPOST, {
        headers: { "x-awcms-tenant-id": tenantId },
        body: { loginIdentifier, password: PASSWORD, turnstileToken: token }
      });

      expect(outboundBodies.length).toBe(1);
      const params = new URLSearchParams(outboundBodies[0]);
      expect(params.get("response")).toBe(token);
      expect(params.get("secret")).toBe(SECRET);
    });

    // -- SETUP ----------------------------------------------------------------

    const setupBody = (turnstileToken?: string) => ({
      tenantCode: `stc-${Math.random().toString(36).slice(2, 8)}`,
      tenantName: "Setup Turnstile",
      officeCode: "HQ",
      officeName: "Head Office",
      ownerLoginIdentifier: `owner-${Math.random().toString(36).slice(2, 8)}`,
      ownerPassword: "owner-password-123",
      ownerDisplayName: "Owner",
      ...(turnstileToken ? { turnstileToken } : {})
    });

    test("setup: missing token → 400 TURNSTILE_REQUIRED, NO siteverify, NO bootstrap", async () => {
      const res = await callRoute(setupPOST, { body: setupBody() });

      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe("TURNSTILE_REQUIRED");
      expect(fetchCalls).toBe(0);
    });

    test("setup: a LOGIN-action token is rejected here (action bound to `setup`) → 400 TURNSTILE_INVALID", async () => {
      siteverifyBody = freshSuccess("login"); // wrong action for the setup route

      const res = await callRoute(setupPOST, {
        body: setupBody(randomOpaque("tok"))
      });

      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe("TURNSTILE_INVALID");
    });

    test("setup: valid `setup`-action token PROCEEDS past Turnstile to the bootstrap", async () => {
      siteverifyBody = freshSuccess("setup");

      const res = await callRoute(setupPOST, {
        body: setupBody(randomOpaque("tok"))
      });

      // Proceeded past Turnstile: either it bootstrapped (200) or the singleton
      // was already claimed (403) — never a Turnstile 400.
      expect(
        res.status === 200 || res.status === 403,
        `expected 200/403, got ${res.status} ${JSON.stringify(res.body?.error)}`
      ).toBe(true);
      expect(res.body?.error?.code).not.toBe("TURNSTILE_INVALID");
      expect(res.body?.error?.code).not.toBe("TURNSTILE_REQUIRED");
      if (res.status === 200 && res.body?.data?.tenantId) {
        createdTenantIds.push(res.body.data.tenantId);
      }
    });
  }
);
