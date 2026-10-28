/**
 * The commission intake HTTP surface, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #1189, ADR-0147 sections 4 and 5) -- WORLD-2
 * of the harness.
 *
 *   * default-deny: no token is 401, a user with no role is 403;
 *   * both guards BITE (seeded AND enforced): `intake.read` reads and cannot
 *     switch, `intake.configure` switches and cannot read;
 *   * the switch is idempotent (a retry returns the stored response), strict
 *     about its body, audited at `warning` with the before and after, and the
 *     default is OFF;
 *   * the exceptions list shows a refused request with an outcome code and
 *     MASKED ids, never an amount, a rule, an actor or the raw source reference.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
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
import { createCommissionIntakePort } from "../../src/modules/hr-commission/application/hr-commission-intake-port-adapter";
import { runIntakePosterForTenant } from "../../src/modules/hr-commission/application/hr-commission-intake-poster";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { GET as listExceptions } from "../../src/pages/api/v1/hr-commission/intake/exceptions";
import {
  GET as getSetting,
  PUT as putSetting
} from "../../src/pages/api/v1/hr-commission/intake/settings";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

type Env = { tenantId: string; token: string; ownerTenantUserId: string };
type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;

const admin = () => getHandlerAdminSql();

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "ik-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "IK Co",
      tenantCode: "ik-co",
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

  const owner = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  return {
    tenantId,
    token: login.body.data.token,
    ownerTenantUserId: owner[0]!.id
  };
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
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `ik-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
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

function call<T = unknown>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    token?: string | null;
    idempotencyKey?: string | null;
    query?: string;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? nextKey()
      : options.idempotencyKey;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": env.tenantId
  };

  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers,
    body: options.body,
    locals: { correlationId: "corr-api-1189" }
  });
}

const SETTINGS = "/api/v1/hr-commission/intake/settings";
const EXCEPTIONS = "/api/v1/hr-commission/intake/exceptions";

/** `actor` defaults to the owner (an active user of the tenant); pass `undefined`-like `"omit"` to leave it out. */
const put = (
  enabled: unknown,
  token?: string | null,
  key?: string | null,
  actor: string | null | "omit" = "default"
) =>
  call<{
    commissionIntakeEnabled: boolean;
    intakeActorTenantUserId: string | null;
    updatedAt: string;
  }>(putSetting, {
    method: "PUT",
    path: SETTINGS,
    body: {
      commissionIntakeEnabled: enabled,
      ...(actor === "omit"
        ? {}
        : {
            intakeActorTenantUserId:
              actor === "default" ? env.ownerTenantUserId : actor
          })
    },
    token,
    idempotencyKey: key
  });

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr_commission intake HTTP surface (Issue #1189)", () => {
  let reader: { token: string; tenantUserId: string };
  let configurer: { token: string; tenantUserId: string };

  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    env = await bootstrap();
    reader = await seedUser(env.tenantId, "reader", [
      "hr_commission.intake.read"
    ]);
    configurer = await seedUser(env.tenantId, "configurer", [
      "hr_commission.intake.configure"
    ]);
  });

  test("default-deny: no token is 401 and a user with no role is 403", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);

    expect((await put(true, null)).status).toBe(401);
    expect(
      (await call(getSetting, { path: SETTINGS, token: null })).status
    ).toBe(401);
    expect((await put(true, noRole.token)).status).toBe(403);
    expect(
      (await call(getSetting, { path: SETTINGS, token: noRole.token })).status
    ).toBe(403);
    expect(
      (await call(listExceptions, { path: EXCEPTIONS, token: noRole.token }))
        .status
    ).toBe(403);
  });

  test("both guards bite: read cannot switch, configure cannot read", async () => {
    if (!handlerReady) return;

    expect(
      (await call(getSetting, { path: SETTINGS, token: reader.token })).status
    ).toBe(200);
    expect(
      (await call(listExceptions, { path: EXCEPTIONS, token: reader.token }))
        .status
    ).toBe(200);
    expect((await put(true, reader.token)).status).toBe(403);

    expect((await put(true, configurer.token)).status).toBe(200);
    expect(
      (await call(getSetting, { path: SETTINGS, token: configurer.token }))
        .status
    ).toBe(403);
    expect(
      (
        await call(listExceptions, {
          path: EXCEPTIONS,
          token: configurer.token
        })
      ).status
    ).toBe(403);
  });

  test("the switch defaults OFF, is strict about its body and requires an Idempotency-Key", async () => {
    if (!handlerReady) return;

    const initial = await call<{ commissionIntakeEnabled: boolean }>(
      getSetting,
      { path: SETTINGS, token: reader.token }
    );

    expect(initial.body.data!.commissionIntakeEnabled).toBe(false);

    expect((await put("true")).status).toBe(400);
    expect((await put(undefined)).status).toBe(400);
    expect(
      (
        await call(putSetting, {
          method: "PUT",
          path: SETTINGS,
          body: { commissionIntakeEnabled: true, extra: 1 }
        })
      ).status
    ).toBe(400);
    expect((await put(true, undefined, null)).status).toBe(400);
  });

  test("switching ON needs the intake system actor: missing, unknown and foreign actors are 400 and change nothing", async () => {
    if (!handlerReady) return;

    const missing = await put(true, undefined, undefined, "omit");

    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe("INTAKE_ACTOR_REQUIRED");
    expect(
      (
        await put(
          true,
          undefined,
          undefined,
          "99999999-9999-4999-8999-999999999999"
        )
      ).body.error?.code
    ).toBe("INTAKE_ACTOR_INVALID");
    expect(
      (await call(getSetting, { path: SETTINGS, token: reader.token })).body
        .data
    ).toMatchObject({ commissionIntakeEnabled: false });

    // Once stored, an omitted actor keeps it, so a later toggle needs no repeat.
    expect((await put(true)).status).toBe(200);
    expect((await put(false, undefined, undefined, "omit")).status).toBe(200);

    const kept = await call<{ intakeActorTenantUserId: string | null }>(
      getSetting,
      { path: SETTINGS, token: reader.token }
    );

    expect(kept.body.data!.intakeActorTenantUserId).toBe(env.ownerTenantUserId);
    expect(
      (kept.body.data as unknown as { intakeActorStatus: string })
        .intakeActorStatus
    ).toBe("active");
    expect((await put(true, undefined, undefined, "omit")).status).toBe(200);
  });

  test("switching is idempotent, takes effect and is audited at warning without any amount", async () => {
    if (!handlerReady) return;
    const key = nextKey();
    const first = await put(true, undefined, key);
    const replay = await put(true, undefined, key);

    expect(first.status).toBe(200);
    expect(first.body.data!.commissionIntakeEnabled).toBe(true);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    // The same key with a different request is a conflict, not a silent switch.
    expect((await put(false, undefined, key)).status).toBe(409);

    const stored = (await admin()`
      SELECT commission_intake_enabled FROM awcms_hr_commission_intake_settings
      WHERE tenant_id = ${env.tenantId}
    `) as { commission_intake_enabled: boolean }[];

    expect(stored).toEqual([{ commission_intake_enabled: true }]);

    const audits = (await admin()`
      SELECT severity, attributes::text AS attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND action = 'hr_commission.intake.configured'
    `) as { severity: string; attributes: string }[];

    // One audit row: the replay did not switch again.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.severity).toBe("warning");
    expect(JSON.parse(audits[0]!.attributes)).toEqual({
      commissionIntakeEnabled: true,
      previous: false,
      intakeActorTenantUserId: env.ownerTenantUserId,
      previousIntakeActorTenantUserId: null
    });

    // And off again.
    expect((await put(false)).body.data!.commissionIntakeEnabled).toBe(false);
  });

  test("the exceptions list shows a refused request with an outcome code and masked ids only", async () => {
    if (!handlerReady) return;

    const employment = await (async () => {
      const profile = (await admin()`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${env.tenantId}, 'person', 'Employee') RETURNING id
      `) as { id: string }[];
      const found = (await admin()`
        INSERT INTO awcms_hr_employments
          (tenant_id, profile_id, employee_no, hired_on)
        VALUES (${env.tenantId}, ${profile[0]!.id}, 'E-1', '2026-01-01')
        RETURNING id
      `) as { id: string }[];

      return found[0]!.id;
    })();

    expect((await put(true)).status).toBe(200);

    const at = new Date(Date.now() - 3600_000);
    const queued = await withTenantOrThrow(
      getHandlerDatabaseClient(),
      env.tenantId,
      (tx) =>
        createCommissionIntakePort().submitAccrual(tx, env.tenantId, null, {
          employmentId: employment,
          ruleKey: "no_such_rule",
          source: { type: "sale_line", ref: "ORD-CONFIDENTIAL-7", line: "1" },
          baseAmount: "424242.42",
          currencyCode: "XTS",
          occurredAt: at,
          occurredOn: at.toISOString().slice(0, 10)
        })
    );

    expect(queued.outcome).toBe("queued");

    const run = await runIntakePosterForTenant(
      getHandlerDatabaseClient(),
      env.tenantId
    );

    expect(run.refused).toBe(1);

    const response = await call<{
      exceptions: {
        outcomeCode: string;
        status: string;
        sourceRefMasked: string;
        employmentIdMasked: string;
      }[];
      nextCursor: string | null;
      summary: {
        commissionIntakeEnabled: boolean;
        counts: Record<string, number>;
      };
    }>(listExceptions, { path: EXCEPTIONS, token: reader.token });

    expect(response.status).toBe(200);
    expect(response.body.data!.exceptions).toHaveLength(1);
    expect(response.body.data!.exceptions[0]!.outcomeCode).toBe(
      "no_effective_rule"
    );
    expect(response.body.data!.exceptions[0]!.status).toBe("refused");
    expect(response.body.data!.summary.commissionIntakeEnabled).toBe(true);
    expect(response.body.data!.summary.counts.refused).toBe(1);

    const text = JSON.stringify(response.body);

    expect(text).not.toContain("424242");
    expect(text).not.toContain("ORD-CONFIDENTIAL-7");
    expect(text).not.toContain(employment);
    expect(text).not.toContain("no_such_rule");
    expect(response.body.data!.nextCursor).toBeNull();

    expect(
      (
        await call(listExceptions, {
          path: EXCEPTIONS,
          token: reader.token,
          query: "cursor=not-a-cursor"
        })
      ).status
    ).toBe(400);
  });
});
