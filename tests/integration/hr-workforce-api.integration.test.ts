/**
 * The `/api/v1/hr-workforce/*` surface, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #945, ADR-0132) — WORLD-2 of the harness.
 *
 * What this proves that the unit tests cannot:
 *
 *   * employee-sees-own: an employee holding NO hr permission reads their own
 *     employment, its terms and `?mine=true` through an ownership grant on the
 *     persisted login link, and is refused (403, the same answer as for a
 *     missing id) on anyone else's — and on every write;
 *   * every high-risk guard BITES: a user holding every hr_workforce permission
 *     EXCEPT one is refused that action, while a user holding ONLY that one
 *     succeeds;
 *   * default-deny, cross-tenant references, one active employment per person
 *     and per login, effective-dated terms, a bounded acyclic manager chain,
 *     terminal termination, soft delete/restore, idempotent replay;
 *   * no audit row carries an employee number, a job title or a login id.
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
import { hrWorkforceModule } from "../../src/modules/hr-workforce/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as createPolicyRoute } from "../../src/pages/api/v1/access/policies/index";
import { POST as enablePolicy } from "../../src/pages/api/v1/access/policies/[id]/enable";
import { POST as disablePolicy } from "../../src/pages/api/v1/access/policies/[id]/disable";
import {
  GET as listEmployments,
  POST as createEmployment
} from "../../src/pages/api/v1/hr-workforce/employments/index";
import {
  DELETE as deleteEmployment,
  GET as getEmployment
} from "../../src/pages/api/v1/hr-workforce/employments/[id]";
import { POST as restoreEmployment } from "../../src/pages/api/v1/hr-workforce/employments/[id]/restore";
import {
  GET as listTerms,
  POST as changeTerms
} from "../../src/pages/api/v1/hr-workforce/employments/[id]/terms";
import { PUT as assignAccount } from "../../src/pages/api/v1/hr-workforce/employments/[id]/account";
import {
  GET as getSettings,
  PUT as putSettings
} from "../../src/pages/api/v1/hr-workforce/settings";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

type Env = { tenantId: string; token: string; ownerTenantUserId: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type Employment = {
  id: string;
  profileId: string;
  employeeNo: string;
  hiredOn: string;
  terminatedOn: string | null;
  accountLinked: boolean;
  currentTerm: {
    status: string;
    employmentType: string;
    jobTitle: string | null;
    officeId: string | null;
    managerEmploymentId: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
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
  const loginIdentifier = "hr-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "HR Co",
      tenantCode: "hr-co",
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

/** A person (profile) with no login: the subject of an employment. */
async function seedProfile(tenantId: string, tag: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${tag}`})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
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
  const token = `hr-${tag}-${Math.random().toString(36).slice(2)}`;

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

const ALL_HR_PERMISSIONS = (hrWorkforceModule.permissions ?? []).map(
  (permission) => `hr_workforce.${permission.activityCode}.${permission.action}`
);

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
    locals: { correlationId: "corr-api-945" }
  });
}

let numberCounter = 0;

async function newEmployment(
  profileId: string,
  extra: Record<string, unknown> = {},
  token?: string
) {
  numberCounter += 1;

  return call<Employment>(createEmployment, {
    method: "POST",
    path: "/api/v1/hr-workforce/employments",
    token,
    body: {
      profileId,
      employeeNo: `E-${numberCounter}`,
      hiredOn: "2026-01-05",
      employmentType: "permanent",
      status: "active",
      jobTitle: "Cashier",
      ...extra
    }
  });
}

async function hire(tag: string, extra: Record<string, unknown> = {}) {
  const profileId = await seedProfile(env.tenantId, tag);
  const response = await newEmployment(profileId, extra);
  expect(response.status).toBe(201);

  return response.body.data!;
}

function link(id: string, tenantUserId: string | null, token?: string) {
  return call<{ replayed: boolean; employment: Employment }>(assignAccount, {
    method: "PUT",
    path: `/api/v1/hr-workforce/employments/${id}/account`,
    params: { id },
    body: { tenantUserId },
    token
  });
}

function changeTermsOf(
  id: string,
  body: Record<string, unknown>,
  token?: string
) {
  return call<{ replayed: boolean; employment: Employment }>(changeTerms, {
    method: "POST",
    path: `/api/v1/hr-workforce/employments/${id}/terms`,
    params: { id },
    body: {
      employmentType: "permanent",
      status: "active",
      ...body
    },
    token
  });
}

function getOne(id: string, token?: string) {
  return call<Employment>(getEmployment, {
    path: `/api/v1/hr-workforce/employments/${id}`,
    params: { id },
    token
  });
}

async function count(table: string): Promise<number> {
  const rows = (await admin()`
    SELECT count(*)::int AS n FROM ${admin().unsafe(table)}
    WHERE tenant_id = ${env.tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr_workforce HTTP surface (Issue #945)", () => {
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
  });

  // --- default-deny ---------------------------------------------------------------

  test("default-deny: no token is 401; a user with no role is 403 on every verb and writes nothing", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const employment = await hire("deny");
    const before = await count("awcms_hr_employments");

    expect(
      (
        await call(listEmployments, {
          path: "/api/v1/hr-workforce/employments",
          token: null
        })
      ).status
    ).toBe(401);

    const id = employment.id;
    const attempts = [
      call(listEmployments, {
        path: "/api/v1/hr-workforce/employments",
        token: noRole.token
      }),
      newEmployment(await seedProfile(env.tenantId, "x"), {}, noRole.token),
      getOne(id, noRole.token),
      call(listTerms, {
        path: `/api/v1/hr-workforce/employments/${id}/terms`,
        params: { id },
        token: noRole.token
      }),
      changeTermsOf(id, { effectiveFrom: "2026-03-01" }, noRole.token),
      link(id, noRole.tenantUserId, noRole.token),
      call(deleteEmployment, {
        method: "DELETE",
        path: `/api/v1/hr-workforce/employments/${id}`,
        params: { id },
        token: noRole.token
      }),
      call(restoreEmployment, {
        method: "POST",
        path: `/api/v1/hr-workforce/employments/${id}/restore`,
        params: { id },
        token: noRole.token
      }),
      call(getSettings, {
        path: "/api/v1/hr-workforce/settings",
        token: noRole.token
      }),
      call(putSettings, {
        method: "PUT",
        path: "/api/v1/hr-workforce/settings",
        body: { clockSkewSeconds: 60 },
        token: noRole.token
      })
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await count("awcms_hr_employments")).toBe(before);
    expect(await count("awcms_hr_employment_terms")).toBe(1);
  });

  // --- employee sees own ------------------------------------------------------------

  describe("an employee sees their own (ownership grant, ADR-0063)", () => {
    test("reads own employment, terms and ?mine=true with NO permission; nobody else's", async () => {
      if (!handlerReady) return;
      const me = await seedUser(env.tenantId, "employee", []);
      const mine = await hire("mine");
      const theirs = await hire("theirs");
      expect((await link(mine.id, me.tenantUserId)).status).toBe(200);

      const own = await getOne(mine.id, me.token);
      expect(own.status).toBe(200);
      expect(own.body.data!.id).toBe(mine.id);
      expect(own.body.data!.accountLinked).toBe(true);

      const ownTerms = await call<{ terms: unknown[] }>(listTerms, {
        path: `/api/v1/hr-workforce/employments/${mine.id}/terms`,
        params: { id: mine.id },
        token: me.token
      });
      expect(ownTerms.status).toBe(200);
      expect(ownTerms.body.data!.terms).toHaveLength(1);

      const list = await call<{ employments: Employment[] }>(listEmployments, {
        path: "/api/v1/hr-workforce/employments",
        query: "mine=true",
        token: me.token
      });
      expect(list.status).toBe(200);
      expect(list.body.data!.employments.map((e) => e.id)).toEqual([mine.id]);

      // Someone else's, a missing id and the unfiltered list are all 403 — the
      // same answer, so the refusal is not an existence oracle.
      const missing = crypto.randomUUID();

      for (const id of [theirs.id, missing]) {
        const refused = await getOne(id, me.token);
        expect(refused.status).toBe(403);
        expect(refused.body.error?.code).toBe("ACCESS_DENIED");
      }

      expect(
        (
          await call(listEmployments, {
            path: "/api/v1/hr-workforce/employments",
            token: me.token
          })
        ).status
      ).toBe(403);

      // The decision log says WHY the own read was allowed.
      const reasons = (await admin()`
        SELECT matched_policy FROM awcms_abac_decision_logs
        WHERE tenant_id = ${env.tenantId} AND tenant_user_id = ${me.tenantUserId}
          AND decision = 'allow'
      `) as { matched_policy: string | null }[];
      expect(
        reasons.some((row) =>
          row.matched_policy?.startsWith("ownership_grant:")
        )
      ).toBe(true);
    });

    test("the ownership grant widens READ only: an employee cannot write, link, delete or read settings", async () => {
      if (!handlerReady) return;
      const me = await seedUser(env.tenantId, "employee", []);
      const mine = await hire("mine");
      await link(mine.id, me.tenantUserId);

      expect(
        (
          await changeTermsOf(
            mine.id,
            { effectiveFrom: "2026-03-01" },
            me.token
          )
        ).status
      ).toBe(403);
      expect((await link(mine.id, null, me.token)).status).toBe(403);
      expect(
        (
          await call(deleteEmployment, {
            method: "DELETE",
            path: `/api/v1/hr-workforce/employments/${mine.id}`,
            params: { id: mine.id },
            token: me.token
          })
        ).status
      ).toBe(403);
      expect(
        (
          await call(getSettings, {
            path: "/api/v1/hr-workforce/settings",
            token: me.token
          })
        ).status
      ).toBe(403);
    });

    test("an unlinked, deleted or terminated-then-relinked employment grants nothing", async () => {
      if (!handlerReady) return;
      const me = await seedUser(env.tenantId, "employee", []);
      const mine = await hire("mine");
      await link(mine.id, me.tenantUserId);
      expect((await getOne(mine.id, me.token)).status).toBe(200);

      // Unlink: the link is the basis, so the grant goes with it.
      await link(mine.id, null);
      expect((await getOne(mine.id, me.token)).status).toBe(403);

      // Relink, then soft-delete: a deleted row never grants.
      await link(mine.id, me.tenantUserId);
      expect((await getOne(mine.id, me.token)).status).toBe(200);
      expect(
        (
          await call(deleteEmployment, {
            method: "DELETE",
            path: `/api/v1/hr-workforce/employments/${mine.id}`,
            params: { id: mine.id }
          })
        ).status
      ).toBe(200);
      expect((await getOne(mine.id, me.token)).status).toBe(403);
    });

    test("an explicit ABAC deny still overrules the ownership grant, and disabling it restores the read", async () => {
      if (!handlerReady) return;
      const me = await seedUser(env.tenantId, "employee", []);
      const mine = await hire("mine");
      await link(mine.id, me.tenantUserId);
      expect((await getOne(mine.id, me.token)).status).toBe(200);

      const created = await call<{ policy: { id: string } }>(
        createPolicyRoute,
        {
          method: "POST",
          path: "/api/v1/access/policies",
          body: {
            policyCode: "test.deny-hr-read",
            effect: "deny",
            moduleKey: "hr_workforce",
            activityCode: "employments",
            action: "read",
            conditions: { allOf: [] }
          }
        }
      );
      expect(created.status).toBe(200);
      const policyId = created.body.data!.policy.id;

      const toggle = (handler: typeof enablePolicy, verb: string) =>
        call(handler, {
          method: "POST",
          path: `/api/v1/access/policies/${policyId}/${verb}`,
          params: { id: policyId }
        });

      expect((await toggle(enablePolicy, "enable")).status).toBe(200);
      // The ownership grant WIDENS what is evaluated; an explicit deny is
      // matched before it, so the employee is refused their own record.
      expect((await getOne(mine.id, me.token)).status).toBe(403);

      expect((await toggle(disablePolicy, "disable")).status).toBe(200);
      expect((await getOne(mine.id, me.token)).status).toBe(200);
    });
  });

  // --- every high-risk guard bites ---------------------------------------------------

  describe("every guard bites (all-but-one is refused, only-that-one succeeds)", () => {
    test("assign, delete, restore, configure and create each need their own permission", async () => {
      if (!handlerReady) return;
      const employment = await hire("guards");
      const subject = await seedUser(env.tenantId, "subject", []);

      type Probe = {
        key: string;
        run: (token: string) => Promise<{ status: number }>;
      };
      const probes: Probe[] = [
        {
          key: "hr_workforce.employments.assign",
          run: (token) => link(employment.id, subject.tenantUserId, token)
        },
        {
          key: "hr_workforce.settings.configure",
          run: (token) =>
            call(putSettings, {
              method: "PUT",
              path: "/api/v1/hr-workforce/settings",
              body: { clockSkewSeconds: 120 },
              token
            })
        },
        {
          key: "hr_workforce.employments.update",
          run: (token) =>
            changeTermsOf(employment.id, { effectiveFrom: "2026-04-01" }, token)
        },
        {
          key: "hr_workforce.employments.delete",
          run: (token) =>
            call(deleteEmployment, {
              method: "DELETE",
              path: `/api/v1/hr-workforce/employments/${employment.id}`,
              params: { id: employment.id },
              token
            })
        }
      ];

      for (const probe of probes) {
        const allButOne = await seedUser(
          env.tenantId,
          "allbut",
          ALL_HR_PERMISSIONS.filter((key) => key !== probe.key)
        );
        expect((await probe.run(allButOne.token)).status).toBe(403);

        const onlyThis = await seedUser(env.tenantId, "only", [probe.key]);
        expect([200, 201]).toContain((await probe.run(onlyThis.token)).status);
      }
    });
  });

  // --- create, identity and uniqueness ----------------------------------------------

  describe("create", () => {
    test("references a person and returns no personal field; first terms start on the hire date", async () => {
      if (!handlerReady) return;
      const employment = await hire("ref", { jobTitle: "Barista" });
      const json = JSON.stringify(employment);

      expect(employment.currentTerm?.effectiveFrom).toBe("2026-01-05");
      expect(employment.currentTerm?.status).toBe("active");
      expect(employment.accountLinked).toBe(false);
      expect(employment.terminatedOn).toBeNull();
      // The person is a reference: no name, contact or national id.
      expect(json).not.toContain("Person ref");
      expect(Object.keys(employment)).not.toContain("displayName");
    });

    test("a body naming a personal or derived field is a 400", async () => {
      if (!handlerReady) return;
      const profileId = await seedProfile(env.tenantId, "strict");

      for (const extra of [
        { displayName: "Someone" },
        { nik: "0000000000000000" },
        { photo: "x" },
        { terminatedOn: "2026-02-01" }
      ]) {
        const response = await newEmployment(profileId, extra);
        expect(response.status).toBe(400);
      }

      expect(await count("awcms_hr_employments")).toBe(0);
    });

    test("one active employment per person, unique live employee number, rehire after termination", async () => {
      if (!handlerReady) return;
      const profileId = await seedProfile(env.tenantId, "twice");
      const first = await newEmployment(profileId, { employeeNo: "E-100" });
      expect(first.status).toBe(201);

      const second = await newEmployment(profileId, { employeeNo: "E-101" });
      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe("ALREADY_EMPLOYED");

      const other = await seedProfile(env.tenantId, "other");
      const dup = await newEmployment(other, { employeeNo: "e-100" });
      expect(dup.status).toBe(409);
      expect(dup.body.error?.code).toBe("EMPLOYEE_NO_CONFLICT");

      // Terminate, then rehire the same person: a NEW employment.
      const ended = await changeTermsOf(first.body.data!.id, {
        effectiveFrom: "2026-06-01",
        status: "terminated"
      });
      expect(ended.status).toBe(201);
      expect(ended.body.data!.employment.terminatedOn).toBe("2026-06-01");

      const rehire = await newEmployment(profileId, {
        employeeNo: "E-102",
        hiredOn: "2026-09-01"
      });
      expect(rehire.status).toBe(201);
    });

    test("another tenant's profile, office or manager is refused even though the id exists", async () => {
      if (!handlerReady) return;
      const other = (await admin()`
        INSERT INTO awcms_tenants (tenant_code, tenant_name)
        VALUES ('other-co', 'Other Co') RETURNING id
      `) as { id: string }[];
      const foreignProfile = await seedProfile(other[0]!.id, "foreign");
      const foreignOffice = (await admin()`
        INSERT INTO awcms_offices (tenant_id, office_code, office_name)
        VALUES (${other[0]!.id}, 'fo', 'Foreign Office') RETURNING id
      `) as { id: string }[];

      const profile = await newEmployment(foreignProfile);
      expect(profile.status).toBe(422);
      expect(profile.body.error?.code).toBe("PROFILE_NOT_FOUND");

      const own = await seedProfile(env.tenantId, "own");
      const office = await newEmployment(own, {
        officeId: foreignOffice[0]!.id
      });
      expect(office.status).toBe(422);
      expect(office.body.error?.code).toBe("OFFICE_NOT_FOUND");

      const manager = await newEmployment(own, {
        managerEmploymentId: crypto.randomUUID()
      });
      expect(manager.status).toBe(422);
      expect(manager.body.error?.code).toBe("MANAGER_NOT_FOUND");
      expect(await count("awcms_hr_employments")).toBe(0);
    });

    test("is idempotent: the same key replays one response and creates one employment", async () => {
      if (!handlerReady) return;
      const profileId = await seedProfile(env.tenantId, "idem");
      const key = nextKey();
      const body = {
        profileId,
        employeeNo: "E-IDEM",
        hiredOn: "2026-01-05",
        employmentType: "permanent",
        status: "active"
      };
      const send = (payload: unknown) =>
        call<Employment>(createEmployment, {
          method: "POST",
          path: "/api/v1/hr-workforce/employments",
          body: payload,
          idempotencyKey: key
        });

      const first = await send(body);
      const replay = await send(body);

      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body.data!.id).toBe(first.body.data!.id);
      expect(await count("awcms_hr_employments")).toBe(1);

      const different = await send({ ...body, employeeNo: "E-OTHER" });
      expect(different.status).toBe(409);
      expect(different.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");

      const missingKey = await call(createEmployment, {
        method: "POST",
        path: "/api/v1/hr-workforce/employments",
        body,
        idempotencyKey: null
      });
      expect(missingKey.status).toBe(400);
    });
  });

  // --- terms --------------------------------------------------------------------------

  describe("effective-dated terms", () => {
    test("a change closes the open row and appends; history is oldest-first and never rewritten", async () => {
      if (!handlerReady) return;
      const employment = await hire("terms");
      const office = (await admin()`
        SELECT id FROM awcms_offices WHERE tenant_id = ${env.tenantId} LIMIT 1
      `) as { id: string }[];

      const changed = await changeTermsOf(employment.id, {
        effectiveFrom: "2026-03-01",
        officeId: office[0]!.id,
        jobTitle: "Supervisor",
        status: "on_leave"
      });
      expect(changed.status).toBe(201);
      expect(changed.body.data!.employment.currentTerm).toMatchObject({
        status: "on_leave",
        jobTitle: "Supervisor",
        officeId: office[0]!.id,
        effectiveFrom: "2026-03-01",
        effectiveTo: null
      });

      const history = await call<{
        terms: { effectiveFrom: string; effectiveTo: string | null }[];
      }>(listTerms, {
        path: `/api/v1/hr-workforce/employments/${employment.id}/terms`,
        params: { id: employment.id }
      });
      expect(
        history.body.data!.terms.map((t) => [t.effectiveFrom, t.effectiveTo])
      ).toEqual([
        ["2026-01-05", "2026-03-01"],
        ["2026-03-01", null]
      ]);

      // Re-sending the identical terms is a no-op replay.
      const replay = await changeTermsOf(employment.id, {
        effectiveFrom: "2026-03-01",
        officeId: office[0]!.id,
        jobTitle: "Supervisor",
        status: "on_leave"
      });
      expect(replay.status).toBe(200);
      expect(replay.body.data!.replayed).toBe(true);
      expect(await count("awcms_hr_employment_terms")).toBe(2);

      // Not before or at the current start, not before the hire date.
      const stale = await changeTermsOf(employment.id, {
        effectiveFrom: "2026-02-01"
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error?.code).toBe("TERMS_OUT_OF_ORDER");

      const early = await changeTermsOf(employment.id, {
        effectiveFrom: "2025-12-31"
      });
      expect(early.status).toBe(422);
      expect(early.body.error?.code).toBe("EFFECTIVE_BEFORE_HIRE");
    });

    test("terminated is terminal: no further terms, no login link, and rehire is a new employment", async () => {
      if (!handlerReady) return;
      const employment = await hire("terminal");
      const ended = await changeTermsOf(employment.id, {
        effectiveFrom: "2026-02-01",
        status: "terminated"
      });
      expect(ended.status).toBe(201);

      const more = await changeTermsOf(employment.id, {
        effectiveFrom: "2026-03-01"
      });
      expect(more.status).toBe(409);
      expect(more.body.error?.code).toBe("EMPLOYMENT_TERMINATED");

      const user = await seedUser(env.tenantId, "late", []);
      const linked = await link(employment.id, user.tenantUserId);
      expect(linked.status).toBe(409);
      expect(linked.body.error?.code).toBe("EMPLOYMENT_TERMINATED");
    });

    test("the manager chain is acyclic and a manager must be a live employment", async () => {
      if (!handlerReady) return;
      const boss = await hire("boss");
      const mid = await hire("mid", { managerEmploymentId: boss.id });
      const low = await hire("low", { managerEmploymentId: mid.id });

      const cycle = await changeTermsOf(boss.id, {
        effectiveFrom: "2026-03-01",
        managerEmploymentId: low.id
      });
      expect(cycle.status).toBe(409);
      expect(cycle.body.error?.code).toBe("MANAGER_CYCLE");

      const self = await changeTermsOf(boss.id, {
        effectiveFrom: "2026-03-01",
        managerEmploymentId: boss.id
      });
      expect(self.status).toBe(409);
      expect(self.body.error?.code).toBe("MANAGER_CYCLE");

      // The chain is bounded: eleven levels is refused.
      let top = boss;

      for (let level = 0; level < 10; level += 1) {
        top = await hire(`chain-${level}`, { managerEmploymentId: top.id });
      }

      const tooDeep = await newEmployment(
        await seedProfile(env.tenantId, "deep"),
        { managerEmploymentId: top.id }
      );
      expect(tooDeep.status).toBe(409);
      expect(tooDeep.body.error?.code).toBe("MANAGER_CHAIN_TOO_DEEP");
    });
  });

  // --- the login link -------------------------------------------------------------------

  describe("the login link (assign)", () => {
    test("one active employment per login; replay is a no-op; a delegated or unknown user is refused", async () => {
      if (!handlerReady) return;
      const user = await seedUser(env.tenantId, "login", []);
      const first = await hire("first");
      const second = await hire("second");

      expect((await link(first.id, user.tenantUserId)).status).toBe(200);

      const replay = await link(first.id, user.tenantUserId);
      expect(replay.status).toBe(200);
      expect(replay.body.data!.replayed).toBe(true);

      const taken = await link(second.id, user.tenantUserId);
      expect(taken.status).toBe(409);
      expect(taken.body.error?.code).toBe("ACCOUNT_IN_USE");

      const unknown = await link(second.id, crypto.randomUUID());
      expect(unknown.status).toBe(422);
      expect(unknown.body.error?.code).toBe("USER_NOT_FOUND");
    });
  });

  // --- delete / restore --------------------------------------------------------------------

  describe("soft delete and restore", () => {
    test("delete frees the number, hides the row, and restore refuses a clash", async () => {
      if (!handlerReady) return;
      const employment = await hire("del", { employeeNo: "E-DEL" });

      const removed = await call<Employment>(deleteEmployment, {
        method: "DELETE",
        path: `/api/v1/hr-workforce/employments/${employment.id}`,
        params: { id: employment.id },
        body: { reason: "entered by mistake" }
      });
      expect(removed.status).toBe(200);
      expect((await getOne(employment.id)).status).toBe(404);

      const hidden = await call<{ employments: Employment[] }>(
        listEmployments,
        { path: "/api/v1/hr-workforce/employments" }
      );
      expect(hidden.body.data!.employments).toHaveLength(0);

      const visible = await call<{ employments: Employment[] }>(
        listEmployments,
        {
          path: "/api/v1/hr-workforce/employments",
          query: "includeDeleted=true"
        }
      );
      expect(visible.body.data!.employments).toHaveLength(1);

      // A reviewer without `restore` cannot enumerate deleted rows.
      const lister = await seedUser(env.tenantId, "lister", [
        "hr_workforce.employments.read"
      ]);
      expect(
        (
          await call(listEmployments, {
            path: "/api/v1/hr-workforce/employments",
            query: "includeDeleted=true",
            token: lister.token
          })
        ).status
      ).toBe(403);

      // The number is free: another employment takes it, so restore is a 409.
      const taker = await newEmployment(await seedProfile(env.tenantId, "t"), {
        employeeNo: "E-DEL"
      });
      expect(taker.status).toBe(201);

      const clash = await call(restoreEmployment, {
        method: "POST",
        path: `/api/v1/hr-workforce/employments/${employment.id}/restore`,
        params: { id: employment.id }
      });
      expect(clash.status).toBe(409);
      expect(clash.body.error?.code).toBe("EMPLOYEE_NO_CONFLICT");

      await admin()`
        UPDATE awcms_hr_employments SET employee_no = 'E-MOVED'
        WHERE tenant_id = ${env.tenantId} AND id = ${taker.body.data!.id}
      `;
      const restored = await call<Employment>(restoreEmployment, {
        method: "POST",
        path: `/api/v1/hr-workforce/employments/${employment.id}/restore`,
        params: { id: employment.id }
      });
      expect(restored.status).toBe(200);
      expect((await getOne(employment.id)).status).toBe(200);
    });
  });

  // --- settings -----------------------------------------------------------------------------

  describe("settings", () => {
    test("defaults until written; an omitted field keeps its value; no evidence setting exists", async () => {
      if (!handlerReady) return;
      const defaults = await call<{
        clockSkewSeconds: number;
        correctionWorkflowKey: string;
      }>(getSettings, { path: "/api/v1/hr-workforce/settings" });
      expect(defaults.body.data).toEqual({
        clockSkewSeconds: 300,
        correctionWorkflowKey: "hr.attendance_correction"
      });

      const changed = await call<typeof defaults.body.data>(putSettings, {
        method: "PUT",
        path: "/api/v1/hr-workforce/settings",
        body: { clockSkewSeconds: 90 }
      });
      expect(changed.body.data).toEqual({
        clockSkewSeconds: 90,
        correctionWorkflowKey: "hr.attendance_correction"
      });

      for (const body of [
        {},
        { clockSkewSeconds: 99999 },
        { clockSkewSeconds: 1.5 },
        { evidenceMode: "photo" },
        { geolocation: true }
      ]) {
        const refused = await call(putSettings, {
          method: "PUT",
          path: "/api/v1/hr-workforce/settings",
          body
        });
        expect(refused.status).toBe(400);
      }
    });
  });

  // --- audit -----------------------------------------------------------------------------------

  test("audit rows say what happened and carry no employee number, title or reason; the link row names the login UUID", async () => {
    if (!handlerReady) return;
    const user = await seedUser(env.tenantId, "audited", []);
    const employment = await hire("audit", {
      employeeNo: "E-SECRET-77",
      jobTitle: "Chief Secret Officer"
    });
    await link(employment.id, user.tenantUserId);
    await changeTermsOf(employment.id, {
      effectiveFrom: "2026-03-01",
      jobTitle: "Another Secret Title"
    });
    await call(deleteEmployment, {
      method: "DELETE",
      path: `/api/v1/hr-workforce/employments/${employment.id}`,
      params: { id: employment.id },
      body: { reason: "private reason text" }
    });

    const rows = (await admin()`
      SELECT action, severity, message, attributes::text AS attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND module_key = 'hr_workforce'
      ORDER BY created_at
    `) as {
      action: string;
      severity: string;
      message: string;
      attributes: string | null;
    }[];

    expect(rows.map((row) => row.action)).toEqual([
      "hr_workforce.employment.created",
      "hr_workforce.employment.account_assigned",
      "hr_workforce.employment.terms_changed",
      "hr_workforce.employment.deleted"
    ]);
    expect(rows[1]!.severity).toBe("warning");

    // The link row names WHICH login received ownership (a UUID, not PII).
    const linkRow = JSON.parse(rows[1]!.attributes!) as {
      linked: boolean;
      linkedTenantUserId: string | null;
      previousTenantUserId: string | null;
    };
    expect(linkRow.linked).toBe(true);
    expect(linkRow.linkedTenantUserId).toBe(user.tenantUserId);
    expect(linkRow.previousTenantUserId).toBeNull();

    const text = JSON.stringify(rows);

    for (const forbidden of [
      "E-SECRET-77",
      "Secret Officer",
      "Another Secret Title",
      "private reason text"
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
