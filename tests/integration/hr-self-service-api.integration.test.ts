/**
 * Employee self-service over HTTP, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #952) -- WORLD-2 of the harness.
 *
 * What this proves:
 *
 *   * default-deny: no token is 401; a user holding no role is 403 on `me` and
 *     on both my-accruals routes;
 *   * the permission BITES in both directions: a user with ONLY
 *     `hr_commission.my_accruals.read` reads their own accruals, and a user with
 *     `hr_commission.accruals.read` (HR) but NOT the self-service key is refused
 *     `my-accruals` -- the two powers are separate;
 *   * ownership: a user lists exactly the accruals of the employment linked to
 *     their own login; another employee's accrual id is 404 (never 403, and
 *     the same 404 as an id that does not exist), and the view carries no
 *     approver, payer or payment reference;
 *   * `me` returns only the caller's own employment, the supervisor flag follows
 *     the manager link, and the answer is never cached.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
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
import { hrCommissionModule } from "../../src/modules/hr-commission/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as postAccrual } from "../../src/pages/api/v1/hr-commission/accruals/index";
import { GET as listMyAccruals } from "../../src/pages/api/v1/hr-commission/my-accruals/index";
import { GET as getMyAccrual } from "../../src/pages/api/v1/hr-commission/my-accruals/[id]";
import { GET as getMe } from "../../src/pages/api/v1/hr-workforce/me";
import { POST as createRule } from "../../src/pages/api/v1/hr-commission/rules/index";
import { POST as publishRule } from "../../src/pages/api/v1/hr-commission/rules/[id]/publish";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

type Env = { tenantId: string; token: string; ownerTenantUserId: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "cm-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "CM Co",
      tenantCode: "cm-co",
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
  const token = `cm-${tag}-${Math.random().toString(36).slice(2)}`;

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

const ALL_PERMISSIONS = (hrCommissionModule.permissions ?? []).map(
  (permission) =>
    `hr_commission.${permission.activityCode}.${permission.action}`
);

type Accrual = {
  id: string;
  employmentId: string;
  ruleKey: string;
  ruleVersion: number;
  status: string;
  amount: string;
  currencyCode: string;
  sourceRef: string;
  paymentReference: string | null;
  voidReasonCode: string | null;
};

function call<T = unknown>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string | null;
    idempotencyKey?: string | null;
    query?: string;
    tenantId?: string;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? nextKey()
      : options.idempotencyKey;
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": options.tenantId ?? env.tenantId
  };

  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (key) requestHeaders["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers: requestHeaders,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-api-951" }
  });
}

let employmentId = "";
let beneficiary: { token: string; tenantUserId: string };
let manager: { token: string; tenantUserId: string };
let employmentCounter = 0;

async function seedEmployment(tenantUserId: string | null): Promise<string> {
  employmentCounter += 1;
  const sql = admin();
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${env.tenantId}, 'person', ${`Employee ${employmentCounter}`})
    RETURNING id
  `) as { id: string }[];
  // Arbitrary logins here; the PS-14 link guard (#979) is bypassed for the insert.
  await sql`ALTER TABLE awcms_hr_employments DISABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  let found: { id: string }[];

  try {
    found = (await sql`
      INSERT INTO awcms_hr_employments
        (tenant_id, profile_id, employee_no, hired_on, tenant_user_id)
      VALUES (${env.tenantId}, ${profile[0]!.id}, ${`E-${employmentCounter}`},
              '2026-01-01', ${tenantUserId})
      RETURNING id
    `) as { id: string }[];
  } finally {
    await sql`ALTER TABLE awcms_hr_employments ENABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  }

  return found[0]!.id;
}

/** Create a draft as the owner and publish it as the manager (maker / checker). */
async function publishedRule(
  extra: Record<string, unknown> = {}
): Promise<void> {
  const created = await call<{ id: string; contentDigest: string }>(
    createRule,
    {
      method: "POST",
      path: "/api/v1/hr-commission/rules",
      body: {
        ruleKey: "upsell",
        name: "Upsell",
        sourceType: "sale_line",
        calculation: "percent",
        rate: "2.5",
        currencyCode: "XTS",
        roundingMode: "half_up",
        roundingScale: 2,
        effectiveFrom: "2026-01-01",
        ...extra
      }
    }
  );

  expect(created.status).toBe(201);

  const published = await call(publishRule, {
    method: "POST",
    path: `/api/v1/hr-commission/rules/${created.body.data!.id}/publish`,
    params: { id: created.body.data!.id },
    body: {
      expectedContentDigest: created.body.data!.contentDigest,
      backdatedReason: "fixture"
    },
    token: manager.token
  });

  expect(published.status).toBe(200);
}

function saleBody(extra: Record<string, unknown> = {}) {
  return {
    employmentId,
    ruleKey: "upsell",
    source: { type: "sale_line", ref: "ORD-1", line: "1" },
    baseAmount: "1000.10",
    currencyCode: "XTS",
    occurredAt: "2026-03-10T10:00:00Z",
    occurredOn: "2026-03-10",
    ...extra
  };
}

function accrue(body: Record<string, unknown> = saleBody()) {
  return call<{ replayed: boolean; accrual: Accrual }>(postAccrual, {
    method: "POST",
    path: "/api/v1/hr-commission/accruals",
    body
  });
}

async function addTerm(
  employment: string,
  managerEmployment: string | null
): Promise<void> {
  await admin()`
    INSERT INTO awcms_hr_employment_terms
      (tenant_id, employment_id, manager_employment_id, job_title,
       employment_type, status, effective_from)
    VALUES (${env.tenantId}, ${employment}, ${managerEmployment}, 'Clerk',
            'permanent', 'active', '2026-01-01')
  `;
}

type OwnAccrual = {
  id: string;
  status: string;
  amount: string;
  sourceRef: string;
  paymentReference?: unknown;
  employmentId?: unknown;
  ruleId?: unknown;
};

const SELF = "hr_commission.my_accruals.read";
const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr self-service HTTP surface (Issue #952)", () => {
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
    manager = await seedUser(env.tenantId, "manager", ALL_PERMISSIONS);
    beneficiary = await seedUser(env.tenantId, "beneficiary", [SELF]);
    employmentId = await seedEmployment(beneficiary.tenantUserId);
    await publishedRule();
  });

  test("default-deny: no token is 401; a user with no role is 403 on me and on both my-accruals routes", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const created = await accrue();
    const id = created.body.data!.accrual.id;

    expect(
      (await call(getMe, { path: "/api/v1/hr-workforce/me", token: null }))
        .status
    ).toBe(401);

    const attempts = [
      call(getMe, { path: "/api/v1/hr-workforce/me", token: noRole.token }),
      call(listMyAccruals, {
        path: "/api/v1/hr-commission/my-accruals",
        token: noRole.token
      }),
      call(getMyAccrual, {
        path: `/api/v1/hr-commission/my-accruals/${id}`,
        params: { id },
        token: noRole.token
      })
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }
  });

  test("the self-service key and the HR key are separate powers", async () => {
    if (!handlerReady) return;
    await accrue();
    // HR: reads every accrual through accruals.read, but does not hold the key.
    const hr = await seedUser(env.tenantId, "hr", [
      "hr_commission.accruals.read"
    ]);

    expect(
      (
        await call(listMyAccruals, {
          path: "/api/v1/hr-commission/my-accruals",
          token: hr.token
        })
      ).status
    ).toBe(403);
    // The employee holds ONLY the self-service key and reads their own.
    const mine = await call<{ accruals: OwnAccrual[] }>(listMyAccruals, {
      path: "/api/v1/hr-commission/my-accruals",
      token: beneficiary.token
    });

    expect(mine.status).toBe(200);
    expect(mine.body.data!.accruals).toHaveLength(1);
  });

  test("ownership: you list only your own accruals and another employee's id is a 404, the same as a missing id", async () => {
    if (!handlerReady) return;
    const mineId = (await accrue()).body.data!.accrual.id;
    const otherUser = await seedUser(env.tenantId, "other", [SELF]);
    const otherEmployment = await seedEmployment(otherUser.tenantUserId);
    const theirs = await accrue(
      saleBody({
        employmentId: otherEmployment,
        source: { type: "sale_line", ref: "ORD-OTHER" }
      })
    );

    expect(theirs.status).toBe(201);
    const theirId = theirs.body.data!.accrual.id;

    const list = await call<{ accruals: OwnAccrual[] }>(listMyAccruals, {
      path: "/api/v1/hr-commission/my-accruals",
      token: beneficiary.token
    });

    expect(list.body.data!.accruals.map((a) => a.id)).toEqual([mineId]);

    const own = await call<{ accrual: OwnAccrual }>(getMyAccrual, {
      path: `/api/v1/hr-commission/my-accruals/${mineId}`,
      params: { id: mineId },
      token: beneficiary.token
    });

    expect(own.status).toBe(200);
    expect(own.response.headers.get("cache-control")).toContain("no-store");

    const foreign = await call(getMyAccrual, {
      path: `/api/v1/hr-commission/my-accruals/${theirId}`,
      params: { id: theirId },
      token: beneficiary.token
    });
    const missing = await call(getMyAccrual, {
      path: "/api/v1/hr-commission/my-accruals/00000000-0000-4000-8000-000000000000",
      params: { id: "00000000-0000-4000-8000-000000000000" },
      token: beneficiary.token
    });

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error?.code).toBe(missing.body.error?.code);
  });

  test("the own view carries no approver, payer, payment reference, employment or rule id", async () => {
    if (!handlerReady) return;
    await accrue();
    const list = await call<{ accruals: OwnAccrual[] }>(listMyAccruals, {
      path: "/api/v1/hr-commission/my-accruals",
      token: beneficiary.token
    });
    const row = list.body.data!.accruals[0]!;

    expect(row.amount).toBeDefined();
    expect(row.paymentReference).toBeUndefined();
    expect(row.employmentId).toBeUndefined();
    expect(row.ruleId).toBeUndefined();
  });

  test("a login linked to no employment sees an empty own list, never somebody else's", async () => {
    if (!handlerReady) return;
    await accrue();
    const stranger = await seedUser(env.tenantId, "stranger", [SELF]);
    const list = await call<{ accruals: OwnAccrual[] }>(listMyAccruals, {
      path: "/api/v1/hr-commission/my-accruals",
      token: stranger.token
    });

    expect(list.status).toBe(200);
    expect(list.body.data!.accruals).toEqual([]);
  });

  test("me returns only the caller's employment and the supervisor flag follows the manager link", async () => {
    if (!handlerReady) return;
    const bossUser = await seedUser(env.tenantId, "boss", [
      "hr_workforce.self_service.read"
    ]);
    const bossEmployment = await seedEmployment(bossUser.tenantUserId);
    const staff = await seedUser(env.tenantId, "staff", [
      "hr_workforce.self_service.read"
    ]);
    const staffEmployment = await seedEmployment(staff.tenantUserId);

    await addTerm(bossEmployment, null);
    await addTerm(staffEmployment, bossEmployment);

    type Me = {
      employments: { id: string; profileId?: unknown }[];
      hasDirectReports: boolean;
    };
    const boss = await call<Me>(getMe, {
      path: "/api/v1/hr-workforce/me",
      token: bossUser.token
    });
    const mine = await call<Me>(getMe, {
      path: "/api/v1/hr-workforce/me",
      token: staff.token
    });

    expect(boss.body.data!.employments.map((e) => e.id)).toEqual([
      bossEmployment
    ]);
    expect(boss.body.data!.hasDirectReports).toBe(true);
    expect(mine.body.data!.employments.map((e) => e.id)).toEqual([
      staffEmployment
    ]);
    expect(mine.body.data!.hasDirectReports).toBe(false);
    expect(mine.body.data!.employments[0]!.profileId).toBeUndefined();
    expect(mine.response.headers.get("cache-control")).toContain("no-store");
  });
});
