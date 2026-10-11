/**
 * The accrual ledger's HTTP surface, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #951, ADR-0132) — WORLD-2 of the harness.
 *
 * What this proves that the unit and database tests cannot:
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every verb
 *     and writes nothing;
 *   * every guard BITES: a user holding every hr_commission permission EXCEPT
 *     one is refused that action, while a user holding ONLY that one succeeds
 *     (so "seeded" and "enforced" are the same fact);
 *   * a double delivery is one accrual (201 then 200 replayed) whatever
 *     Idempotency-Key it arrives under, a conflicting redelivery is 409, and the
 *     body can never assert an amount, a version or a status;
 *   * the lifecycle through the real handlers, the beneficiary refusal, a voided
 *     accrual that can never be paid, and replay-safe transitions;
 *   * the audit rows carry what happened and never an amount, a base, a rate, a
 *     source reference or a payment reference;
 *   * the back-dated publish rule at the HTTP boundary (409 without a reason,
 *     stored with one, audited as a flag only).
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
import { hrCommissionModule } from "../../src/modules/hr-commission/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import {
  GET as listAccruals,
  POST as postAccrual
} from "../../src/pages/api/v1/hr-commission/accruals/index";
import { GET as getAccrual } from "../../src/pages/api/v1/hr-commission/accruals/[id]";
import { POST as approveAccrual } from "../../src/pages/api/v1/hr-commission/accruals/[id]/approve";
import { POST as releaseAccrual } from "../../src/pages/api/v1/hr-commission/accruals/[id]/release";
import { POST as voidAccrual } from "../../src/pages/api/v1/hr-commission/accruals/[id]/void";
import { POST as payAccrual } from "../../src/pages/api/v1/hr-commission/accruals/[id]/pay";
import { POST as createRule } from "../../src/pages/api/v1/hr-commission/rules/index";
import { GET as getRule } from "../../src/pages/api/v1/hr-commission/rules/[id]";
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

type Detail = {
  accrual: Accrual;
  transitions: { fromStatus: string | null; toStatus: string }[];
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
/** Pays: segregation of duties forbids the approver (manager) and the beneficiary. */
let payer: { token: string; tenantUserId: string };
let employmentCounter = 0;

async function seedEmployment(tenantUserId: string | null): Promise<string> {
  employmentCounter += 1;
  const sql = admin();
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${env.tenantId}, 'person', ${`Employee ${employmentCounter}`})
    RETURNING id
  `) as { id: string }[];
  const found = (await sql`
    INSERT INTO awcms_hr_employments
      (tenant_id, profile_id, employee_no, hired_on, tenant_user_id)
    VALUES (${env.tenantId}, ${profile[0]!.id}, ${`E-${employmentCounter}`},
            '2026-01-01', ${tenantUserId})
    RETURNING id
  `) as { id: string }[];

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

function accrue(
  body: Record<string, unknown> = saleBody(),
  token?: string | null,
  key?: string | null
) {
  return call<{ replayed: boolean; accrual: Accrual }>(postAccrual, {
    method: "POST",
    path: "/api/v1/hr-commission/accruals",
    body,
    token,
    idempotencyKey: key
  });
}

async function accrued(ref = "ORD-1"): Promise<string> {
  const response = await accrue(
    saleBody({ source: { type: "sale_line", ref } })
  );

  expect(response.status).toBe(201);

  return response.body.data!.accrual.id;
}

type Verb = "approve" | "release" | "void" | "pay";
const VERBS: Record<Verb, Parameters<typeof invoke>[0]> = {
  approve: approveAccrual,
  release: releaseAccrual,
  void: voidAccrual,
  pay: payAccrual
};

function act(
  verb: Verb,
  id: string,
  token?: string,
  body?: unknown,
  key?: string | null
) {
  return call<Accrual>(VERBS[verb], {
    method: "POST",
    path: `/api/v1/hr-commission/accruals/${id}/${verb}`,
    params: { id },
    body: body ?? {},
    token: token ?? (verb === "pay" ? payer.token : manager.token),
    idempotencyKey: key
  });
}

function detail(id: string, token?: string) {
  return call<Detail>(getAccrual, {
    path: `/api/v1/hr-commission/accruals/${id}`,
    params: { id },
    token
  });
}

async function advance(id: string, to: "approved" | "payable" | "paid") {
  const path: Verb[] =
    to === "approved"
      ? ["approve"]
      : to === "payable"
        ? ["approve", "release"]
        : ["approve", "release", "pay"];

  for (const verb of path) {
    expect((await act(verb, id)).status).toBe(200);
  }
}

async function ledgerRows(): Promise<number> {
  const rows = (await admin()`
    SELECT count(*)::int AS n FROM awcms_hr_commission_accruals
    WHERE tenant_id = ${env.tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr_commission accrual HTTP surface (Issue #951)", () => {
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
    payer = await seedUser(env.tenantId, "payer", ALL_PERMISSIONS);
    beneficiary = await seedUser(env.tenantId, "beneficiary", ALL_PERMISSIONS);
    employmentId = await seedEmployment(beneficiary.tenantUserId);
    await publishedRule();
  });

  test("default-deny: no token is 401; a user with no role is 403 on every verb and writes nothing", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const id = await accrued();
    const before = await ledgerRows();

    expect((await accrue(saleBody(), null)).status).toBe(401);

    const attempts = [
      call(listAccruals, {
        path: "/api/v1/hr-commission/accruals",
        token: noRole.token
      }),
      accrue(
        saleBody({ source: { type: "sale_line", ref: "ORD-2" } }),
        noRole.token
      ),
      detail(id, noRole.token),
      act("approve", id, noRole.token),
      act("release", id, noRole.token),
      act("void", id, noRole.token),
      act("pay", id, noRole.token)
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await ledgerRows()).toBe(before);
    expect((await detail(id)).body.data!.accrual.status).toBe("pending");
  });

  describe("every guard bites (seeded AND enforced)", () => {
    const accrualPermissions = ALL_PERMISSIONS.filter((key) =>
      key.startsWith("hr_commission.accruals.")
    );

    // Each action runs against an accrual already in the state it needs.
    const actions: [
      string,
      (token: string) => Promise<{ status: number }>,
      "pending" | "approved" | "payable"
    ][] = [
      [
        "hr_commission.accruals.read",
        (token) =>
          call(listAccruals, { path: "/api/v1/hr-commission/accruals", token }),
        "pending"
      ],
      [
        "hr_commission.accruals.accrue",
        (token) =>
          accrue(
            saleBody({ source: { type: "sale_line", ref: "G-NEW" } }),
            token
          ),
        "pending"
      ],
      [
        "hr_commission.accruals.approve",
        (token) => act("approve", target, token),
        "pending"
      ],
      [
        "hr_commission.accruals.release",
        (token) => act("release", target, token),
        "approved"
      ],
      [
        "hr_commission.accruals.cancel",
        (token) => act("void", target, token),
        "pending"
      ],
      [
        "hr_commission.accruals.pay",
        (token) => act("pay", target, token),
        "payable"
      ]
    ];
    let target = "";

    for (const [permission, run, state] of actions) {
      test(`${permission}: holding every OTHER permission is refused; holding only it succeeds`, async () => {
        if (!handlerReady) return;
        target = await accrued(`G-${permission}`);

        if (state !== "pending") {
          await advance(target, state);
        }

        const others = await seedUser(
          env.tenantId,
          "others",
          ALL_PERMISSIONS.filter((key) => key !== permission)
        );
        const only = await seedUser(env.tenantId, "only", [permission]);

        expect((await run(others.token)).status).toBe(403);
        expect((await run(only.token)).status).toBeLessThan(300);
      });
    }

    test("reading the rules does not read the ledger, and the reverse", async () => {
      if (!handlerReady) return;
      const rulesOnly = await seedUser(env.tenantId, "rules-only", [
        "hr_commission.rules.read"
      ]);
      const accrualsOnly = await seedUser(
        env.tenantId,
        "accruals-only",
        accrualPermissions.filter((key) => key.endsWith(".read"))
      );

      expect(
        (
          await call(listAccruals, {
            path: "/api/v1/hr-commission/accruals",
            token: rulesOnly.token
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(getRule, {
            path: "/api/v1/hr-commission/rules/x",
            params: { id: "11111111-1111-4111-8111-111111111111" },
            token: accrualsOnly.token
          })
        ).status
      ).toBe(403);
    });

    test("the seeded permissions match the descriptor verbatim", async () => {
      if (!handlerReady) return;
      const rows = (await admin()`
        SELECT activity_code, action, description FROM awcms_permissions
        WHERE module_key = 'hr_commission' AND activity_code = 'accruals'
        ORDER BY action
      `) as { activity_code: string; action: string; description: string }[];
      const declared = (hrCommissionModule.permissions ?? [])
        .filter((permission) => permission.activityCode === "accruals")
        .sort((a, b) => a.action.localeCompare(b.action));

      expect(
        rows.map((row) => [row.activity_code, row.action, row.description])
      ).toEqual(declared.map((p) => [p.activityCode, p.action, p.description]));
    });
  });

  describe("accrue", () => {
    test("201 with the COMPUTED amount, the rule version applied and a pending status", async () => {
      if (!handlerReady) return;
      const response = await accrue();

      expect(response.status).toBe(201);
      expect(response.body.data!.replayed).toBe(false);
      expect(response.body.data!.accrual).toMatchObject({
        status: "pending",
        amount: "25.000000",
        ruleKey: "upsell",
        ruleVersion: 1,
        currencyCode: "XTS",
        employmentId
      });
    });

    test("a double delivery is one accrual: 200 replayed with the original, whatever Idempotency-Key it arrives under", async () => {
      if (!handlerReady) return;
      const first = await accrue();
      const second = await accrue();

      expect(second.status).toBe(200);
      expect(second.body.data!.replayed).toBe(true);
      expect(second.body.data!.accrual.id).toBe(first.body.data!.accrual.id);
      expect(await ledgerRows()).toBe(1);
    });

    test("the same Idempotency-Key replays the stored response; the same key with another request is 409", async () => {
      if (!handlerReady) return;
      const key = nextKey();
      const first = await accrue(saleBody(), undefined, key);
      const again = await accrue(saleBody(), undefined, key);
      const other = await accrue(
        saleBody({ source: { type: "sale_line", ref: "ORD-9" } }),
        undefined,
        key
      );

      expect(first.status).toBe(201);
      expect(again.status).toBe(201);
      expect(again.body.data!.accrual.id).toBe(first.body.data!.accrual.id);
      expect(other.status).toBe(409);
      expect(other.body.error!.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(await ledgerRows()).toBe(1);
    });

    test("a missing Idempotency-Key is 400 on every mutation", async () => {
      if (!handlerReady) return;
      const id = await accrued();

      expect((await accrue(saleBody(), undefined, null)).status).toBe(400);

      for (const verb of ["approve", "release", "void", "pay"] as const) {
        const response = await act(verb, id, undefined, {}, null);

        expect(response.status).toBe(400);
        expect(response.body.error!.code).toBe("IDEMPOTENCY_REQUIRED");
      }
    });

    test("the same source with a different amount, date or rule is 409 SOURCE_CONFLICT and writes nothing", async () => {
      if (!handlerReady) return;
      await accrue();

      const conflict = await accrue(saleBody({ baseAmount: "2000" }));

      expect(conflict.status).toBe(409);
      expect(conflict.body.error!.code).toBe("SOURCE_CONFLICT");
      expect(await ledgerRows()).toBe(1);
    });

    test("refusals are specific: no rule, wrong type, wrong currency, unknown or ineligible employment", async () => {
      if (!handlerReady) return;
      const code = async (extra: Record<string, unknown>) => {
        const response = await accrue(saleBody(extra));

        return `${response.status} ${response.body.error?.code}`;
      };

      expect(await code({ ruleKey: "nope" })).toBe("409 NO_EFFECTIVE_RULE");
      expect(
        await code({
          source: { type: "booking", ref: "B1" }
        })
      ).toBe("409 SOURCE_TYPE_MISMATCH");
      expect(await code({ currencyCode: "XXX" })).toBe("409 CURRENCY_MISMATCH");
      expect(
        await code({ employmentId: "22222222-2222-4222-8222-222222222222" })
      ).toBe("404 EMPLOYMENT_NOT_FOUND");
      expect(
        await code({
          occurredAt: "2025-12-31T10:00:00Z",
          occurredOn: "2025-12-31"
        })
      ).toBe("409 EMPLOYMENT_NOT_ELIGIBLE");
      expect(await ledgerRows()).toBe(0);
    });

    test("the body cannot assert an amount, a version, a status or a stamp; money is a string", async () => {
      if (!handlerReady) return;
      for (const extra of [
        { amount: "999" },
        { ruleVersion: 1 },
        { status: "paid" },
        { approvedBy: beneficiary.tenantUserId },
        { baseAmount: 1000.1 },
        { occurredAt: "yesterday" },
        { units: 2 }
      ]) {
        expect((await accrue(saleBody(extra))).status).toBe(400);
      }

      expect(await ledgerRows()).toBe(0);
    });

    test("an event in the far future is refused", async () => {
      if (!handlerReady) return;
      expect(
        (
          await accrue(
            saleBody({
              occurredAt: "2999-01-01T00:00:00Z",
              occurredOn: "2999-01-01"
            })
          )
        ).status
      ).toBe(400);
    });
  });

  describe("the lifecycle", () => {
    test("pending -> approved -> payable -> paid, each by a person, with the log to match", async () => {
      if (!handlerReady) return;
      const id = await accrued();

      expect((await act("approve", id)).body.data!.status).toBe("approved");
      expect((await act("release", id)).body.data!.status).toBe("payable");

      const paid = await act("pay", id, undefined, {
        paymentReference: "batch-2026/10"
      });

      expect(paid.body.data).toMatchObject({
        status: "paid",
        paymentReference: "batch-2026/10"
      });

      const found = (await detail(id)).body.data!;

      expect(
        found.transitions.map((t) => `${t.fromStatus}>${t.toStatus}`)
      ).toEqual([
        "null>pending",
        "pending>approved",
        "approved>payable",
        "payable>paid"
      ]);
    });

    test("the beneficiary cannot approve their own accrual, even holding the permission", async () => {
      if (!handlerReady) return;
      const id = await accrued();
      const refused = await act("approve", id, beneficiary.token);

      expect(refused.status).toBe(403);
      expect(refused.body.error!.code).toBe("APPROVE_OWN_ACCRUAL_FORBIDDEN");
      expect((await detail(id)).body.data!.accrual.status).toBe("pending");
    });

    test("a voided accrual can never be paid, released or approved", async () => {
      if (!handlerReady) return;
      const id = await accrued();
      const voided = await act("void", id, undefined, {
        reasonCode: "sale_cancelled"
      });

      expect(voided.body.data).toMatchObject({
        status: "voided",
        voidReasonCode: "sale_cancelled"
      });

      for (const verb of ["pay", "release", "approve", "void"] as const) {
        const refused = await act(verb, id);

        expect(refused.status).toBe(409);
        expect(refused.body.error!.code).toBe("ACCRUAL_INVALID_STATE");
      }

      expect((await detail(id)).body.data!.accrual.status).toBe("voided");
    });

    test("a payable accrual cannot be voided, and nothing leaves paid", async () => {
      if (!handlerReady) return;
      const id = await accrued();
      await advance(id, "payable");

      expect((await act("void", id)).status).toBe(409);
      expect((await act("pay", id)).status).toBe(200);

      for (const verb of ["void", "pay", "release", "approve"] as const) {
        expect((await act(verb, id)).status).toBe(409);
      }
    });

    test("pay and release skip nothing: pay on a pending accrual is 409", async () => {
      if (!handlerReady) return;
      const id = await accrued();

      expect((await act("pay", id)).status).toBe(409);
      expect((await act("release", id)).status).toBe(409);
    });

    test("replaying a transition with the same key returns the stored 200 instead of a 409, and audits once", async () => {
      if (!handlerReady) return;
      const id = await accrued();
      const key = nextKey();
      const first = await act("approve", id, undefined, {}, key);
      const again = await act("approve", id, undefined, {}, key);

      expect(first.status).toBe(200);
      expect(again.status).toBe(200);
      expect(again.body.data!.status).toBe("approved");

      const audits = (await admin()`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'hr_commission.accrual.approved'
      `) as { n: number }[];

      expect(audits[0]!.n).toBe(1);
    });

    test("void and pay accept a code or a reference, never free text, and no other field", async () => {
      if (!handlerReady) return;
      const id = await accrued();

      expect(
        (await act("void", id, undefined, { reasonCode: "He was rude" })).status
      ).toBe(400);
      expect((await act("void", id, undefined, { note: "x" })).status).toBe(
        400
      );

      await advance(id, "payable");

      expect(
        (
          await act("pay", id, undefined, {
            paymentReference: "acct 1234 5678"
          })
        ).status
      ).toBe(400);
      expect((await act("pay", id, undefined, { amount: "1" })).status).toBe(
        400
      );
      expect((await act("pay", id)).status).toBe(200);
    });

    test("an unknown accrual is 404 and a bad id is 400", async () => {
      if (!handlerReady) return;
      expect(
        (await act("approve", "33333333-3333-4333-8333-333333333333")).status
      ).toBe(404);
      expect(
        (await detail("33333333-3333-4333-8333-333333333333")).status
      ).toBe(404);
      expect((await act("approve", "not-a-uuid")).status).toBe(400);
    });

    test("an accrual in another tenant is invisible", async () => {
      if (!handlerReady) return;
      const id = await accrued();
      const other = (await admin()`
        INSERT INTO awcms_tenants (tenant_code, tenant_name)
        VALUES ('cm-other', 'Other') RETURNING id
      `) as { id: string }[];

      const response = await call(getAccrual, {
        path: `/api/v1/hr-commission/accruals/${id}`,
        params: { id },
        tenantId: other[0]!.id
      });

      expect([401, 403, 404]).toContain(response.status);
    });
  });

  describe("segregation of duties and the other guards", () => {
    test("whoever created the accrual cannot approve it; the beneficiary can approve, release or pay none of it", async () => {
      if (!handlerReady) return;
      // The owner created it (env.token): the owner may not approve it.
      const id = await accrued();
      const creatorApproves = await act("approve", id, env.token);

      expect(creatorApproves.status).toBe(403);
      expect(creatorApproves.body.error!.code).toBe("SEGREGATION_OF_DUTIES");

      await act("approve", id);

      const beneficiaryReleases = await act("release", id, beneficiary.token);

      expect(beneficiaryReleases.status).toBe(403);
      expect(beneficiaryReleases.body.error!.code).toBe(
        "SEGREGATION_OF_DUTIES"
      );

      await act("release", id);

      for (const token of [beneficiary.token, manager.token]) {
        const refused = await act("pay", id, token);

        expect(refused.status).toBe(403);
        expect(refused.body.error!.code).toBe("SEGREGATION_OF_DUTIES");
      }

      expect((await detail(id)).body.data!.accrual.status).toBe("payable");
      expect((await act("pay", id)).status).toBe(200);
    });

    test("the beneficiary and the creator may still void", async () => {
      if (!handlerReady) return;
      const a = await accrued("SOD-V1");
      const b = await accrued("SOD-V2");

      expect((await act("void", a, beneficiary.token)).status).toBe(200);
      expect((await act("void", b, env.token)).status).toBe(200);
    });

    test("an event older than 730 days is 400 and writes nothing", async () => {
      if (!handlerReady) return;
      const old = new Date(Date.now() - 800 * 86_400_000);

      expect(
        (
          await accrue(
            saleBody({
              occurredAt: old.toISOString(),
              occurredOn: old.toISOString().slice(0, 10)
            })
          )
        ).status
      ).toBe(400);
      expect(await ledgerRows()).toBe(0);
    });

    test("a non-string where a string is expected is 400, never a 500 and never a coerced pass", async () => {
      if (!handlerReady) return;
      for (const extra of [
        { employmentId: [employmentId] },
        { employmentId: { a: 1 } },
        { ruleKey: ["upsell"] },
        { currencyCode: ["XTS"] },
        { occurredOn: ["2026-03-10"] },
        { source: ["sale_line"] },
        { source: { type: ["sale_line"], ref: "x" } },
        { source: { type: "sale_line", ref: ["ORD-1"] } },
        { source: { type: "sale_line", ref: { a: 1 } } },
        { source: { type: "sale_line", ref: "x", line: ["1"] } }
      ]) {
        expect((await accrue(saleBody(extra))).status).toBe(400);
      }

      expect(await ledgerRows()).toBe(0);
    });

    test("posting is its own permission: holding every permission except accrue is refused", async () => {
      if (!handlerReady) return;
      const user = await seedUser(
        env.tenantId,
        "no-accrue",
        ALL_PERMISSIONS.filter((key) => key !== "hr_commission.accruals.accrue")
      );

      expect((await accrue(saleBody(), user.token)).status).toBe(403);
    });
  });

  describe("reading", () => {
    test("lists newest first with filters and a keyset cursor", async () => {
      if (!handlerReady) return;
      const first = await accrued("L-1");
      const second = await accrued("L-2");
      await accrued("L-3");
      await act("void", first);

      const all = await call<{
        accruals: Accrual[];
        nextCursor: string | null;
      }>(listAccruals, { path: "/api/v1/hr-commission/accruals" });

      expect(all.status).toBe(200);
      expect(all.body.data!.accruals.map((a) => a.sourceRef)).toEqual([
        "L-3",
        "L-2",
        "L-1"
      ]);
      expect(all.body.data!.nextCursor).toBeNull();

      const voided = await call<{ accruals: Accrual[] }>(listAccruals, {
        path: "/api/v1/hr-commission/accruals",
        query: "status=voided"
      });

      expect(voided.body.data!.accruals.map((a) => a.id)).toEqual([first]);

      const mine = await call<{ accruals: Accrual[] }>(listAccruals, {
        path: "/api/v1/hr-commission/accruals",
        query: `employmentId=${employmentId}&sourceType=sale_line`
      });

      expect(mine.body.data!.accruals).toHaveLength(3);
      expect(second).toBeTruthy();

      for (const query of [
        "status=bogus",
        "employmentId=nope",
        "cursor=garbage",
        "sourceType=Bad"
      ]) {
        expect(
          (
            await call(listAccruals, {
              path: "/api/v1/hr-commission/accruals",
              query
            })
          ).status
        ).toBe(400);
      }
    });
  });

  describe("audit", () => {
    test("rows say what happened to which accrual and carry no amount, base, rate, source reference or payment reference", async () => {
      if (!handlerReady) return;
      const id = (
        await accrue(
          saleBody({
            baseAmount: "7654321.09",
            source: { type: "sale_line", ref: "SECRET-ORDER-REF" }
          })
        )
      ).body.data!.accrual.id;
      await advance(id, "payable");
      await act("pay", id, undefined, { paymentReference: "SECRET-PAYOUT-77" });

      const second = (
        await accrue(saleBody({ source: { type: "sale_line", ref: "ORD-V" } }))
      ).body.data!.accrual.id;
      await act("void", second, undefined, { reasonCode: "sale_cancelled" });

      const rows = (await admin()`
        SELECT action, severity, resource_id, attributes::text AS attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND resource_type = 'hr_commission_accrual'
        ORDER BY created_at, action
      `) as {
        action: string;
        severity: string;
        resource_id: string;
        attributes: string | null;
      }[];

      expect(rows.map((row) => row.action).sort()).toEqual(
        [
          "hr_commission.accrual.accrued",
          "hr_commission.accrual.accrued",
          "hr_commission.accrual.approved",
          "hr_commission.accrual.released",
          "hr_commission.accrual.paid",
          "hr_commission.accrual.voided"
        ].sort()
      );
      expect(
        rows.find((r) => r.action === "hr_commission.accrual.paid")!.severity
      ).toBe("warning");
      expect(
        rows.find((r) => r.action === "hr_commission.accrual.accrued")!.severity
      ).toBe("info");

      const text = JSON.stringify(rows);

      for (const forbidden of [
        "7654321",
        "191.",
        "SECRET-ORDER-REF",
        "SECRET-PAYOUT-77",
        "2.5",
        "baseAmount",
        "amount"
      ]) {
        expect(text).not.toContain(forbidden);
      }

      expect(
        JSON.parse(
          rows.find((r) => r.action === "hr_commission.accrual.approved")!
            .attributes!
        )
      ).toMatchObject({
        employmentId,
        ruleKey: "upsell",
        ruleVersion: 1,
        fromStatus: "pending",
        toStatus: "approved"
      });
    });

    test("a replayed delivery audits nothing", async () => {
      if (!handlerReady) return;
      await accrue();
      await accrue();
      await accrue();

      const audits = (await admin()`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'hr_commission.accrual.accrued'
      `) as { n: number }[];

      expect(audits[0]!.n).toBe(1);
    });
  });

  describe("the back-dated publish rule", () => {
    async function draftIn(
      ruleKey: string,
      effectiveFrom: string
    ): Promise<{ id: string; contentDigest: string }> {
      const created = await call<{ id: string; contentDigest: string }>(
        createRule,
        {
          method: "POST",
          path: "/api/v1/hr-commission/rules",
          body: {
            ruleKey,
            name: "Late",
            sourceType: "sale_line",
            calculation: "percent",
            rate: "3",
            currencyCode: "XTS",
            roundingMode: "half_up",
            roundingScale: 2,
            effectiveFrom
          }
        }
      );

      return created.body.data!;
    }

    function publishWith(
      rule: { id: string; contentDigest: string },
      extra: Record<string, unknown> = {}
    ) {
      return call<{
        publishBackdated: boolean;
        backdatedReason: string | null;
      }>(publishRule, {
        method: "POST",
        path: `/api/v1/hr-commission/rules/${rule.id}/publish`,
        params: { id: rule.id },
        body: { expectedContentDigest: rule.contentDigest, ...extra },
        token: manager.token
      });
    }

    test("a window starting in the past is 409 without a reason, and nothing is published", async () => {
      if (!handlerReady) return;
      const rule = await draftIn("late", "2026-02-01");
      const refused = await publishWith(rule);

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("RULE_BACKDATED_REASON_REQUIRED");

      const stored = (await admin()`
        SELECT status FROM awcms_hr_commission_rules WHERE id = ${rule.id}
      `) as { status: string }[];

      expect(stored[0]!.status).toBe("draft");
      expect((await publishWith(rule, { backdatedReason: "   " })).status).toBe(
        400
      );
    });

    test("with a reason it publishes, the rule says so, and the audit row carries the flag, never the reason", async () => {
      if (!handlerReady) return;
      const rule = await draftIn("late", "2026-02-01");
      const published = await publishWith(rule, {
        backdatedReason: "Agreed with finance: PRIVATE-JUSTIFICATION"
      });

      expect(published.status).toBe(200);
      expect(published.body.data).toMatchObject({
        publishBackdated: true,
        backdatedReason: "Agreed with finance: PRIVATE-JUSTIFICATION"
      });

      const rows = (await admin()`
        SELECT attributes::text AS attributes FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'hr_commission.rule.published'
          AND resource_id = ${rule.id}
      `) as { attributes: string }[];

      expect(JSON.parse(rows[0]!.attributes)).toMatchObject({
        backdated: true
      });
      expect(rows[0]!.attributes).not.toContain("PRIVATE-JUSTIFICATION");

      // ...and a late sale in the window now accrues under it.
      const late = await accrue(
        saleBody({
          ruleKey: "late",
          occurredAt: "2026-02-10T10:00:00Z",
          occurredOn: "2026-02-10",
          source: { type: "sale_line", ref: "LATE-1" }
        })
      );

      expect(late.status).toBe(201);
      expect(late.body.data!.accrual.amount).toBe("30.000000");
    });

    test("a window starting today or later needs no reason, is not flagged and drops one if sent", async () => {
      if (!handlerReady) return;
      const future = await draftIn("future", "2199-01-01");
      const published = await publishWith(future, {
        backdatedReason: "not needed"
      });

      expect(published.status).toBe(200);
      expect(published.body.data).toMatchObject({
        publishBackdated: false,
        backdatedReason: null
      });
    });

    test("replaying a back-dated publish returns the stored 200", async () => {
      if (!handlerReady) return;
      const rule = await draftIn("late", "2026-02-01");
      const key = nextKey();
      const send = () =>
        call(publishRule, {
          method: "POST",
          path: `/api/v1/hr-commission/rules/${rule.id}/publish`,
          params: { id: rule.id },
          body: {
            expectedContentDigest: rule.contentDigest,
            backdatedReason: "why"
          },
          token: manager.token,
          idempotencyKey: key
        });

      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(200);
    });
  });
});
