/**
 * The booking REPORT routes through the REAL handlers against a real PostgreSQL
 * (Issue #944, ADR-0131; booking.md section 7.2.1) -- WORLD-2 of the harness.
 *
 *   * default-deny: no token is 401, a user without `booking.reports.read` is 403
 *     on all three routes (and a user holding ONLY it is allowed);
 *   * a window over 92 days, a reversed window, a bad date, a bad resource id and
 *     an unknown parameter are 400 before any read;
 *   * the answer is `Cache-Control: private, no-store`.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import {
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { GET as occupancy } from "../../src/pages/api/v1/booking/reports/occupancy";
import { GET as reservations } from "../../src/pages/api/v1/booking/reports/reservations";
import { GET as utilization } from "../../src/pages/api/v1/booking/reports/utilization";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

type Env = { tenantId: string; token: string };
type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

let env: Env;
let userCounter = 0;

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "bk-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Booking Co",
      tenantCode: "booking-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
  const login = await invoke<{ data: { token: string } }>(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier, password: OWNER_PASSWORD },
    cookies: createCookieJar()
  });

  expect(login.status).toBe(200);

  return { tenantId, token: login.body.data.token };
}

async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const token = `bk-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`})
      RETURNING id
    `) as { id: string }[];

    for (const key of permissionKeys) {
      const [moduleKey, activityCode, action] = key.split(".");
      const permission = (await sql`
        SELECT id FROM awcms_permissions
        WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
          AND action = ${action!}
      `) as { id: string }[];

      if (!permission[0]) {
        throw new Error(`fixture: permission ${key} is not in the catalogue`);
      }

      await sql`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${tenantId}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
      grantRolePolicy(tx, tenantId, {
        tenantUserId: tenantUser[0]!.id,
        roleId: role[0]!.id,
        grantedByTenantUserId: null,
        reason: "partial-permission fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

const ROUTES = {
  occupancy,
  utilization,
  reservations
} as const;

function report(
  name: keyof typeof ROUTES,
  query: string,
  token: string | null = env.token
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": env.tenantId
  };

  if (token) headers.authorization = `Bearer ${token}`;

  return invoke<Envelope>(ROUTES[name], {
    method: "GET",
    path: `/api/v1/booking/reports/${name}?${query}`,
    headers,
    locals: { correlationId: crypto.randomUUID() }
  });
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;
let reader: { token: string };
let noRole: { token: string };
let reservationsOnly: { token: string };

suite("booking report routes (Issue #944)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();

    if (!handlerReady) {
      return;
    }

    await resetHandlerDatabase();
    env = await bootstrap();
    reader = await seedUser(env.tenantId, "reader", ["booking.reports.read"]);
    noRole = await seedUser(env.tenantId, "norole", []);
    reservationsOnly = await seedUser(env.tenantId, "resvonly", [
      "booking.reservations.read"
    ]);
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  const WINDOW = "from=2026-06-01&to=2026-06-08";

  for (const name of ["occupancy", "utilization", "reservations"] as const) {
    test(`${name}: no token is 401, no role or another booking permission is 403, booking.reports.read alone is 200`, async () => {
      if (!handlerReady) return;

      expect((await report(name, WINDOW, null)).status).toBe(401);
      expect((await report(name, WINDOW, noRole.token)).status).toBe(403);
      expect((await report(name, WINDOW, reservationsOnly.token)).status).toBe(
        403
      );

      const allowed = await report(name, WINDOW, reader.token);

      expect(allowed.status).toBe(200);
      expect(allowed.body.success).toBe(true);
      expect(allowed.response.headers.get("cache-control")).toBe(
        "private, no-store"
      );
    });

    test(`${name}: a bad window is 400 before any read`, async () => {
      if (!handlerReady) return;

      // 93 days, one over the cap.
      const tooLong = await report(
        name,
        "from=2026-01-01&to=2026-04-04",
        reader.token
      );

      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error?.code).toBe("VALIDATION_ERROR");

      for (const query of [
        "from=2026-06-08&to=2026-06-01",
        "from=2026-06-01&to=2026-06-01",
        "from=2026-02-30&to=2026-03-05",
        "from=2026-06-01",
        `${WINDOW}&resourceId=not-a-uuid`,
        `${WINDOW}&tenantId=x`
      ]) {
        expect((await report(name, query, reader.token)).status).toBe(400);
      }

      // 92 days exactly is allowed.
      expect(
        (await report(name, "from=2026-01-01&to=2026-04-03", reader.token))
          .status
      ).toBe(200);
    });
  }

  test("a 403 is decided before validation: an unauthorised caller learns nothing about the window rule", async () => {
    if (!handlerReady) return;

    expect(
      (await report("occupancy", "from=bad&to=worse", noRole.token)).status
    ).toBe(403);
  });
});
