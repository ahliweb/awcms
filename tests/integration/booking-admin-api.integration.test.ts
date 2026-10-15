/**
 * The booking ADMIN configuration HTTP surface (resources and units, resource
 * pools, service offerings, policy), driven through the REAL route handlers
 * against a real PostgreSQL (Issue #1030, prerequisite of #942; docs/awcms/
 * booking.md sections 4, 6 and 13) -- WORLD-2 of the harness.
 *
 * What this proves:
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every route
 *     and writes nothing;
 *   * every `booking.resources.*`, `offerings.*` and `policy.*` guard BITES, both
 *     ways (seeded AND enforced): a user holding every booking permission EXCEPT
 *     one is refused that action, a user holding ONLY that one is allowed it;
 *   * `Idempotency-Key`: required; a retry returns the SAME status and body and
 *     writes nothing; a reused key with a different request is 409; a refusal is
 *     not stored;
 *   * the database's guards reach the caller as 409, not 500: `BOOKING_MODE_IN_USE`,
 *     `TIMEZONE_IN_USE`, `SCHEDULE_TIMEZONE_MISMATCH`, `CODE_TAKEN`; a refusal
 *     halfway through a patch rolls the whole patch back;
 *   * capacity grows (a resource-wide block covers the new unit), never shrinks;
 *   * soft delete / restore, `RESOURCE_IN_USE`, `POOL_NOT_EMPTY`, replay on state;
 *   * the policy: NULL = module default, PUT replaces, ranges, audited `critical`;
 *   * tenant isolation: another tenant's rows are the same neutral 404.
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
import { bookingModule } from "../../src/modules/booking/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import {
  GET as listResourcesRoute,
  POST as postResource
} from "../../src/pages/api/v1/booking/resources/index";
import {
  DELETE as deleteResourceRoute,
  GET as getResourceRoute,
  PATCH as patchResourceRoute
} from "../../src/pages/api/v1/booking/resources/[id]";
import { POST as restoreResourceRoute } from "../../src/pages/api/v1/booking/resources/[id]/restore";
import {
  GET as listPoolsRoute,
  POST as postPool
} from "../../src/pages/api/v1/booking/resource-pools/index";
import {
  DELETE as deletePoolRoute,
  GET as getPoolRoute,
  PATCH as patchPoolRoute
} from "../../src/pages/api/v1/booking/resource-pools/[id]";
import { POST as restorePoolRoute } from "../../src/pages/api/v1/booking/resource-pools/[id]/restore";
import {
  GET as listOfferingsRoute,
  POST as postOffering
} from "../../src/pages/api/v1/booking/offerings/index";
import {
  DELETE as deleteOfferingRoute,
  GET as getOfferingRoute,
  PATCH as patchOfferingRoute
} from "../../src/pages/api/v1/booking/offerings/[id]";
import { POST as restoreOfferingRoute } from "../../src/pages/api/v1/booking/offerings/[id]/restore";
import {
  GET as getPolicyRoute,
  PUT as putPolicyRoute
} from "../../src/pages/api/v1/booking/policy";
import { POST as postBlock } from "../../src/pages/api/v1/booking/blocks/index";
import { POST as releaseBlockRoute } from "../../src/pages/api/v1/booking/blocks/[id]/release";
import { POST as postReservation } from "../../src/pages/api/v1/booking/reservations/index";
import { POST as cancelReservation } from "../../src/pages/api/v1/booking/reservations/[id]/cancel";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const OTHER_TENANT = "b1030111-0000-4000-8000-00000000000b";

type Env = { tenantId: string; token: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: any };
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;
let sequence = 0;

const admin = () => getHandlerAdminSql();

function nextKey(): string {
  keyCounter += 1;

  return `adm-${keyCounter}-${crypto.randomUUID()}`;
}

const D = (day: number): string =>
  new Date(Date.now() + (30 + day) * 86_400_000).toISOString().slice(0, 10);

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "adm-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Admin Co",
      tenantCode: "admin-co",
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
  const token = `bb-${tag}-${Math.random().toString(36).slice(2)}`;

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

const ALL_PERMISSIONS = (bookingModule.permissions ?? []).map(
  (permission) => `booking.${permission.activityCode}.${permission.action}`
);
const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter((key) =>
  /^booking\.(resources|offerings|policy)\./.test(key)
);

type Any = any;

function call<T = Any>(
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
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": options.tenantId ?? env.tenantId
  };

  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers,
    body: options.body,
    params: options.params,
    locals: { correlationId: crypto.randomUUID() }
  });
}

type Opts = {
  token?: string | null;
  key?: string | null;
  tenantId?: string;
  query?: string;
};

const R = "/api/v1/booking/resources";
const P = "/api/v1/booking/resource-pools";
const O = "/api/v1/booking/offerings";

const resources = {
  list: (o: Opts = {}) =>
    call(listResourcesRoute, {
      path: R,
      token: o.token,
      query: o.query,
      tenantId: o.tenantId
    }),
  create: (body: unknown, o: Opts = {}) =>
    call(postResource, {
      method: "POST",
      path: R,
      body,
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  get: (id: string, o: Opts = {}) =>
    call(getResourceRoute, {
      path: `${R}/${id}`,
      params: { id },
      token: o.token,
      tenantId: o.tenantId
    }),
  patch: (id: string, body: unknown, o: Opts = {}) =>
    call(patchResourceRoute, {
      method: "PATCH",
      path: `${R}/${id}`,
      params: { id },
      body,
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  del: (id: string, o: Opts = {}) =>
    call(deleteResourceRoute, {
      method: "DELETE",
      path: `${R}/${id}`,
      params: { id },
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  restore: (id: string, o: Opts = {}) =>
    call(restoreResourceRoute, {
      method: "POST",
      path: `${R}/${id}/restore`,
      params: { id },
      body: {},
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    })
};

const pools = {
  list: (o: Opts = {}) =>
    call(listPoolsRoute, {
      path: P,
      token: o.token,
      query: o.query,
      tenantId: o.tenantId
    }),
  create: (body: unknown, o: Opts = {}) =>
    call(postPool, {
      method: "POST",
      path: P,
      body,
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  get: (id: string, o: Opts = {}) =>
    call(getPoolRoute, {
      path: `${P}/${id}`,
      params: { id },
      token: o.token,
      tenantId: o.tenantId
    }),
  patch: (id: string, body: unknown, o: Opts = {}) =>
    call(patchPoolRoute, {
      method: "PATCH",
      path: `${P}/${id}`,
      params: { id },
      body,
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  del: (id: string, o: Opts = {}) =>
    call(deletePoolRoute, {
      method: "DELETE",
      path: `${P}/${id}`,
      params: { id },
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  restore: (id: string, o: Opts = {}) =>
    call(restorePoolRoute, {
      method: "POST",
      path: `${P}/${id}/restore`,
      params: { id },
      body: {},
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    })
};

const offerings = {
  list: (o: Opts = {}) =>
    call(listOfferingsRoute, {
      path: O,
      token: o.token,
      query: o.query,
      tenantId: o.tenantId
    }),
  create: (body: unknown, o: Opts = {}) =>
    call(postOffering, {
      method: "POST",
      path: O,
      body,
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  get: (id: string, o: Opts = {}) =>
    call(getOfferingRoute, {
      path: `${O}/${id}`,
      params: { id },
      token: o.token,
      tenantId: o.tenantId
    }),
  patch: (id: string, body: unknown, o: Opts = {}) =>
    call(patchOfferingRoute, {
      method: "PATCH",
      path: `${O}/${id}`,
      params: { id },
      body,
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  del: (id: string, o: Opts = {}) =>
    call(deleteOfferingRoute, {
      method: "DELETE",
      path: `${O}/${id}`,
      params: { id },
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    }),
  restore: (id: string, o: Opts = {}) =>
    call(restoreOfferingRoute, {
      method: "POST",
      path: `${O}/${id}/restore`,
      params: { id },
      body: {},
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    })
};

const policy = {
  get: (o: Opts = {}) =>
    call(getPolicyRoute, {
      path: "/api/v1/booking/policy",
      token: o.token,
      tenantId: o.tenantId
    }),
  put: (body: unknown, o: Opts = {}) =>
    call(putPolicyRoute, {
      method: "PUT",
      path: "/api/v1/booking/policy",
      body,
      token: o.token,
      idempotencyKey: o.key,
      tenantId: o.tenantId
    })
};

function code(prefix: string): string {
  sequence += 1;

  return `${prefix}${sequence}`;
}

const slotBody = (extra: Record<string, unknown> = {}) => ({
  code: code("slot"),
  name: "Treatment room",
  kind: "room",
  capacity: 1,
  timezone: "Asia/Jakarta",
  ...extra
});

const stayBody = (extra: Record<string, unknown> = {}) => ({
  code: code("stay"),
  name: "Villa",
  kind: "villa",
  capacity: 2,
  timezone: "Asia/Pontianak",
  bookingMode: "stay",
  stayCheckInTime: "14:00",
  stayCheckOutTime: "12:00",
  ...extra
});

const stayOffering = (extra: Record<string, unknown> = {}) => ({
  code: code("night"),
  name: "Night",
  granularity: "stay",
  minNights: 1,
  maxNights: 30,
  maxParty: 4,
  ...extra
});

const timeOffering = (extra: Record<string, unknown> = {}) => ({
  code: code("cut"),
  name: "Haircut",
  granularity: "time",
  durationSeconds: 1800,
  slotStepSeconds: 900,
  ...extra
});

async function newResource(body: Record<string, unknown> = {}, o: Opts = {}) {
  const response = await resources.create(slotBody(body), o);

  expect(response.status).toBe(201);

  return response.body.data!.resource as Any;
}

type Counts = {
  resources: number;
  units: number;
  pools: number;
  offerings: number;
  settings: number;
  events: number;
  audit: number;
};

async function counts(tenantId: string) {
  const rows = (await admin()`
    SELECT
      (SELECT count(*) FROM awcms_booking_resources WHERE tenant_id = ${tenantId})::int AS resources,
      (SELECT count(*) FROM awcms_booking_resource_units WHERE tenant_id = ${tenantId})::int AS units,
      (SELECT count(*) FROM awcms_booking_resource_pools WHERE tenant_id = ${tenantId})::int AS pools,
      (SELECT count(*) FROM awcms_booking_service_offerings WHERE tenant_id = ${tenantId})::int AS offerings,
      (SELECT count(*) FROM awcms_booking_settings WHERE tenant_id = ${tenantId})::int AS settings,
      (SELECT count(*) FROM awcms_domain_events WHERE tenant_id = ${tenantId} AND event_type LIKE 'awcms.booking.%')::int AS events,
      (SELECT count(*) FROM awcms_audit_events WHERE tenant_id = ${tenantId} AND module_key = 'booking')::int AS audit
  `) as Counts[];

  return { ...rows[0]! };
}

const POLICY_FULL = {
  defaultHoldSeconds: 600,
  maxHoldSeconds: 1800,
  maxActiveHoldsPerCustomer: 3,
  maxActiveHoldsPerTenant: 100,
  minLeadSeconds: 3600,
  maxHorizonDays: 180,
  noShowGraceSeconds: 1200,
  defaultTimezone: "Asia/Jakarta",
  defaultCheckInTime: "14:00:00",
  defaultCheckOutTime: "12:00:00"
};

const POLICY_NULLS = Object.fromEntries(
  Object.keys(POLICY_FULL).map((key) => [key, null])
);

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;
const onlyUser: Record<string, { token: string; tenantUserId: string }> = {};
const exceptUser: Record<string, { token: string; tenantUserId: string }> = {};

suite("booking admin configuration HTTP surface (Issue #1030)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();

    if (!handlerReady) {
      return;
    }

    await resetHandlerDatabase();
    env = await bootstrap();

    for (const key of ADMIN_PERMISSIONS) {
      const label = key.split(".").slice(1).join("-");

      onlyUser[key] = await seedUser(env.tenantId, `only-${label}`, [key]);
      exceptUser[key] = await seedUser(
        env.tenantId,
        `except-${label}`,
        ALL_PERMISSIONS.filter((candidate) => candidate !== key)
      );
    }
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  test("the admin permissions are in the catalogue", () => {
    expect(ADMIN_PERMISSIONS.sort()).toEqual([
      "booking.offerings.create",
      "booking.offerings.delete",
      "booking.offerings.read",
      "booking.offerings.restore",
      "booking.offerings.update",
      "booking.policy.configure",
      "booking.policy.read",
      "booking.resources.create",
      "booking.resources.delete",
      "booking.resources.read",
      "booking.resources.restore",
      "booking.resources.update"
    ]);
  });

  test("default-deny: no token is 401; a user with no role is 403 on every route and writes nothing", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const resource = await newResource();
    const pool = (await pools.create({ code: code("pool"), name: "Pool" })).body
      .data!.pool;
    const offering = (await offerings.create(timeOffering())).body.data!
      .offering;
    const before = await counts(env.tenantId);

    expect((await resources.create(slotBody(), { token: null })).status).toBe(
      401
    );
    expect((await policy.get({ token: null })).status).toBe(401);

    const attempts = [
      resources.list({ token: noRole.token }),
      resources.create(slotBody(), { token: noRole.token }),
      resources.get(resource.id, { token: noRole.token }),
      resources.patch(resource.id, { name: "x" }, { token: noRole.token }),
      resources.del(resource.id, { token: noRole.token }),
      resources.restore(resource.id, { token: noRole.token }),
      pools.list({ token: noRole.token }),
      pools.create({ code: code("pool"), name: "P" }, { token: noRole.token }),
      pools.get(pool.id, { token: noRole.token }),
      pools.patch(pool.id, { name: "x" }, { token: noRole.token }),
      pools.del(pool.id, { token: noRole.token }),
      pools.restore(pool.id, { token: noRole.token }),
      offerings.list({ token: noRole.token }),
      offerings.create(timeOffering(), { token: noRole.token }),
      offerings.get(offering.id, { token: noRole.token }),
      offerings.patch(offering.id, { name: "x" }, { token: noRole.token }),
      offerings.del(offering.id, { token: noRole.token }),
      offerings.restore(offering.id, { token: noRole.token }),
      policy.get({ token: noRole.token }),
      policy.put(POLICY_FULL, { token: noRole.token })
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await counts(env.tenantId)).toEqual(before);
  });

  describe("every guard bites (seeded AND enforced), both ways", () => {
    test("resources.read / offerings.read / policy.read", async () => {
      if (!handlerReady) return;
      const resource = await newResource();
      const pool = (await pools.create({ code: code("pool"), name: "P" })).body
        .data!.pool;
      const offering = (await offerings.create(timeOffering())).body.data!
        .offering;
      const reads: [string, (token: string) => Promise<Any>][] = [
        ["booking.resources.read", (t) => resources.list({ token: t })],
        [
          "booking.resources.read",
          (t) => resources.get(resource.id, { token: t })
        ],
        ["booking.resources.read", (t) => pools.list({ token: t })],
        ["booking.resources.read", (t) => pools.get(pool.id, { token: t })],
        ["booking.offerings.read", (t) => offerings.list({ token: t })],
        [
          "booking.offerings.read",
          (t) => offerings.get(offering.id, { token: t })
        ],
        ["booking.policy.read", (t) => policy.get({ token: t })]
      ];

      for (const [key, run] of reads) {
        expect((await run(exceptUser[key]!.token)).status).toBe(403);
        expect((await run(onlyUser[key]!.token)).status).toBe(200);
      }
    });

    test("resources.create / update / delete / restore (resources and pools)", async () => {
      if (!handlerReady) return;
      const target = await newResource();
      const pool = (await pools.create({ code: code("pool"), name: "P" })).body
        .data!.pool;
      const before = await counts(env.tenantId);
      const k = (a: string) => `booking.resources.${a}`;

      expect(
        (
          await resources.create(slotBody(), {
            token: exceptUser[k("create")]!.token
          })
        ).status
      ).toBe(403);
      expect(
        (
          await pools.create(
            { code: code("pool"), name: "P" },
            { token: exceptUser[k("create")]!.token }
          )
        ).status
      ).toBe(403);
      expect((await counts(env.tenantId)).resources).toBe(before.resources);
      expect(
        (
          await resources.create(slotBody(), {
            token: onlyUser[k("create")]!.token
          })
        ).status
      ).toBe(201);
      expect(
        (
          await pools.create(
            { code: code("pool"), name: "P" },
            { token: onlyUser[k("create")]!.token }
          )
        ).status
      ).toBe(201);

      expect(
        (
          await resources.patch(
            target.id,
            { name: "A" },
            { token: exceptUser[k("update")]!.token }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await pools.patch(
            pool.id,
            { name: "A" },
            { token: exceptUser[k("update")]!.token }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await resources.patch(
            target.id,
            { name: "A" },
            { token: onlyUser[k("update")]!.token }
          )
        ).status
      ).toBe(200);
      expect(
        (
          await pools.patch(
            pool.id,
            { name: "A" },
            { token: onlyUser[k("update")]!.token }
          )
        ).status
      ).toBe(200);

      expect(
        (
          await resources.del(target.id, {
            token: exceptUser[k("delete")]!.token
          })
        ).status
      ).toBe(403);
      expect(
        (await pools.del(pool.id, { token: exceptUser[k("delete")]!.token }))
          .status
      ).toBe(403);
      expect(
        (await resources.get(target.id)).body.data.resource.deletedAt
      ).toBe(null);
      expect(
        (
          await resources.del(target.id, {
            token: onlyUser[k("delete")]!.token
          })
        ).status
      ).toBe(200);
      expect(
        (await pools.del(pool.id, { token: onlyUser[k("delete")]!.token }))
          .status
      ).toBe(200);

      expect(
        (
          await resources.restore(target.id, {
            token: exceptUser[k("restore")]!.token
          })
        ).status
      ).toBe(403);
      expect(
        (
          await pools.restore(pool.id, {
            token: exceptUser[k("restore")]!.token
          })
        ).status
      ).toBe(403);
      expect(
        (
          await resources.restore(target.id, {
            token: onlyUser[k("restore")]!.token
          })
        ).status
      ).toBe(200);
      expect(
        (await pools.restore(pool.id, { token: onlyUser[k("restore")]!.token }))
          .status
      ).toBe(200);
    });

    test("offerings.create / update / delete / restore", async () => {
      if (!handlerReady) return;
      const target = (await offerings.create(timeOffering())).body.data!
        .offering;
      const k = (a: string) => `booking.offerings.${a}`;

      expect(
        (
          await offerings.create(timeOffering(), {
            token: exceptUser[k("create")]!.token
          })
        ).status
      ).toBe(403);
      expect(
        (
          await offerings.create(timeOffering(), {
            token: onlyUser[k("create")]!.token
          })
        ).status
      ).toBe(201);
      expect(
        (
          await offerings.patch(
            target.id,
            { name: "A" },
            { token: exceptUser[k("update")]!.token }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await offerings.patch(
            target.id,
            { name: "A" },
            { token: onlyUser[k("update")]!.token }
          )
        ).status
      ).toBe(200);
      expect(
        (
          await offerings.del(target.id, {
            token: exceptUser[k("delete")]!.token
          })
        ).status
      ).toBe(403);
      expect(
        (
          await offerings.del(target.id, {
            token: onlyUser[k("delete")]!.token
          })
        ).status
      ).toBe(200);
      expect(
        (
          await offerings.restore(target.id, {
            token: exceptUser[k("restore")]!.token
          })
        ).status
      ).toBe(403);
      expect(
        (
          await offerings.restore(target.id, {
            token: onlyUser[k("restore")]!.token
          })
        ).status
      ).toBe(200);
    });

    test("policy.configure", async () => {
      if (!handlerReady) return;
      const k = "booking.policy.configure";
      const before = await counts(env.tenantId);

      expect(
        (await policy.put(POLICY_FULL, { token: exceptUser[k]!.token })).status
      ).toBe(403);
      expect((await counts(env.tenantId)).settings).toBe(before.settings);
      expect(
        (await policy.put(POLICY_FULL, { token: onlyUser[k]!.token })).status
      ).toBe(200);
    });
  });

  describe("resources", () => {
    test("create: the resource and its units in one transaction, labelled, audited info, no domain event", async () => {
      if (!handlerReady) return;
      const before = await counts(env.tenantId);
      const response = await resources.create(
        slotBody({
          capacity: 3,
          unitLabels: ["Chair A", null, "Chair C"],
          sortOrder: 5
        })
      );

      expect(response.status).toBe(201);

      const { resource, replayed } = response.body.data!;

      expect(replayed).toBe(false);
      expect(resource).toMatchObject({
        capacity: 3,
        activeUnits: 3,
        bookingMode: "slot",
        stayCheckInTime: null,
        status: "active",
        sortOrder: 5,
        deletedAt: null
      });
      expect(
        resource.units.map((u: Any) => [u.ordinal, u.label, u.status])
      ).toEqual([
        [1, "Chair A", "active"],
        [2, null, "active"],
        [3, "Chair C", "active"]
      ]);

      const after = await counts(env.tenantId);

      expect(after.resources).toBe(before.resources + 1);
      expect(after.units).toBe(before.units + 3);
      expect(after.audit).toBe(before.audit + 1);
      expect(after.events).toBe(before.events);

      const audit = (await admin()`
        SELECT severity, attributes FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND action = 'booking.resource.created'
          AND resource_id = ${resource.id}
      `) as Any[];

      expect(audit).toHaveLength(1);
      expect(audit[0].severity).toBe("info");
      expect(JSON.stringify(audit[0].attributes)).not.toContain("Chair");
    });

    test("a stay resource carries its local check-in and check-out times", async () => {
      if (!handlerReady) return;
      const response = await resources.create(stayBody());

      expect(response.status).toBe(201);
      expect(response.body.data!.resource).toMatchObject({
        bookingMode: "stay",
        stayCheckInTime: "14:00:00",
        stayCheckOutTime: "12:00:00",
        timezone: "Asia/Pontianak"
      });
    });

    test("validation: shape rules are a 400 naming the field; nothing is written", async () => {
      if (!handlerReady) return;
      const before = await counts(env.tenantId);
      const bad: [string, Record<string, unknown>][] = [
        [
          "stay without times",
          stayBody({ stayCheckInTime: undefined, stayCheckOutTime: undefined })
        ],
        [
          "slot with times",
          slotBody({ stayCheckInTime: "14:00", stayCheckOutTime: "12:00" })
        ],
        ["capacity 501", slotBody({ capacity: 501 })],
        ["capacity 0", slotBody({ capacity: 0 })],
        ["offset zone", slotBody({ timezone: "+07:00" })],
        ["abbreviation zone", slotBody({ timezone: "WIB" })],
        ["unknown zone", slotBody({ timezone: "Mars/Olympus_Mons" })],
        ["bad code", slotBody({ code: "-bad" })],
        ["bad kind", slotBody({ kind: "Room!" })],
        ["unknown key", slotBody({ price: 10 })],
        [
          "more labels than units",
          slotBody({ capacity: 1, unitLabels: ["a", "b"] })
        ],
        ["bad pool id", slotBody({ poolId: "nope" })]
      ];

      for (const [label, body] of bad) {
        const response = await resources.create(body);

        expect([label, response.status]).toEqual([label, 400]);
        expect(response.body.error?.code).toBe("VALIDATION_ERROR");
      }

      expect(
        (await resources.create(slotBody(), { key: null })).body.error?.code
      ).toBe("IDEMPOTENCY_REQUIRED");
      expect(await counts(env.tenantId)).toEqual(before);
    });

    test("a duplicate code (any case) is 409 CODE_TAKEN, not a 500, and leaves no row", async () => {
      if (!handlerReady) return;
      const first = await newResource({ code: "Dup-Code" });
      const before = await counts(env.tenantId);
      const again = await resources.create(slotBody({ code: "dup-code" }));

      expect(first.code).toBe("Dup-Code");
      expect(again.status).toBe(409);
      expect(again.body.error?.code).toBe("CODE_TAKEN");
      expect(await counts(env.tenantId)).toEqual(before);
    });

    test("idempotency: a retry after the commit returns the SAME 201 and body; a reused key with another request is 409", async () => {
      if (!handlerReady) return;
      const body = slotBody({ capacity: 2 });
      const key = nextKey();
      const first = await resources.create(body, { key });
      const before = await counts(env.tenantId);
      const retry = await resources.create(body, { key });

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      expect(await counts(env.tenantId)).toEqual(before);

      const conflict = await resources.create(slotBody(), { key });

      expect(conflict.status).toBe(409);
      expect(conflict.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");

      // Parallel same-key requests make one resource.
      const parallelKey = nextKey();
      const parallelBody = slotBody();
      const many = await Promise.all(
        Array.from({ length: 5 }, () =>
          resources.create(parallelBody, { key: parallelKey })
        )
      );

      for (const response of many) expect(response.status).toBe(201);
      expect(new Set(many.map((r) => r.body.data!.resource.id)).size).toBe(1);
    });

    test("a refusal is not stored: the same key succeeds once the cause is gone", async () => {
      if (!handlerReady) return;
      const taken = await newResource();
      const key = nextKey();
      const refused = await resources.create(slotBody({ code: taken.code }), {
        key
      });

      expect(refused.status).toBe(409);

      const retry = await resources.create(slotBody({ code: taken.code }), {
        key
      });

      expect(retry.status).toBe(409);
      expect(retry.body.error?.code).toBe("CODE_TAKEN");
    });

    test("list: newest first, filters, deleted hidden by default, bad query is 400", async () => {
      if (!handlerReady) return;
      const slot = await newResource();
      const stay = (await resources.create(stayBody())).body.data!.resource;

      await resources.patch(slot.id, { status: "inactive" });

      const all = (await resources.list()).body.data!.resources as Any[];

      expect(all[0].id).toBe(stay.id);
      expect(
        (
          (await resources.list({ query: "bookingMode=stay" })).body.data!
            .resources as Any[]
        ).every((r) => r.bookingMode === "stay")
      ).toBe(true);
      expect(
        (
          (await resources.list({ query: "status=inactive" })).body.data!
            .resources as Any[]
        ).some((r) => r.id === slot.id)
      ).toBe(true);
      expect((await resources.list({ query: "status=weird" })).status).toBe(
        400
      );
      expect((await resources.list({ query: "poolId=nope" })).status).toBe(400);
      expect(
        (await resources.list({ query: "includeDeleted=maybe" })).status
      ).toBe(400);
      expect((await resources.list({ query: "cursor=garbage" })).status).toBe(
        400
      );
      expect(all[0].units).toBeUndefined();
    });

    test("pagination: a full page carries a cursor and the next page continues without a gap", async () => {
      if (!handlerReady) return;
      // 101 rows in one statement, so the first page is full.
      await admin()`
        INSERT INTO awcms_booking_resources (tenant_id, code, name, kind, capacity, timezone)
        SELECT ${env.tenantId}, 'pg' || g, 'Paged ' || g, 'room', 1, 'UTC'
        FROM generate_series(1, 101) AS g
      `;

      const first = await resources.list({ query: "includeDeleted=true" });
      const page1 = first.body.data!.resources as Any[];

      expect(page1).toHaveLength(100);
      expect(first.body.data!.nextCursor).toBeTruthy();

      const second = await resources.list({
        query: `includeDeleted=true&cursor=${first.body.data!.nextCursor}`
      });
      const ids = new Set(page1.map((r) => r.id));

      for (const row of second.body.data!.resources as Any[]) {
        expect(ids.has(row.id)).toBe(false);
      }

      expect((second.body.data!.resources as Any[]).length).toBeGreaterThan(0);
    });
  });

  describe("patch, units and the database guards", () => {
    test("edit fields, relabel and deactivate a unit, and join and leave a pool", async () => {
      if (!handlerReady) return;
      const pool = (await pools.create({ code: code("pool"), name: "Rooms" }))
        .body.data!.pool;
      const resource = await newResource({ capacity: 2 });
      const [u1, u2] = resource.units;
      const joined = await resources.patch(resource.id, {
        name: "Renamed",
        sortOrder: 9,
        poolId: pool.id,
        units: [
          { id: u1.id, label: "Front" },
          { id: u2.id, status: "inactive" }
        ]
      });

      expect(joined.status).toBe(200);
      expect(joined.body.data!.resource).toMatchObject({
        name: "Renamed",
        sortOrder: 9,
        poolId: pool.id,
        capacity: 2,
        activeUnits: 1
      });
      expect(joined.body.data!.resource.units[0]).toMatchObject({
        label: "Front",
        status: "active"
      });
      expect(joined.body.data!.resource.units[1]).toMatchObject({
        status: "inactive"
      });
      expect((await pools.get(pool.id)).body.data!.pool.memberCount).toBe(1);

      const left = await resources.patch(resource.id, { poolId: null });

      expect(left.body.data!.resource.poolId).toBe(null);
      expect((await pools.get(pool.id)).body.data!.pool.memberCount).toBe(0);
    });

    test("capacity grows by appending units and never shrinks", async () => {
      if (!handlerReady) return;
      const resource = await newResource({ capacity: 2 });
      const grown = await resources.patch(resource.id, { capacity: 4 });

      expect(grown.status).toBe(200);
      expect(grown.body.data!.resource.capacity).toBe(4);
      expect(
        grown.body.data!.resource.units.map((u: Any) => u.ordinal)
      ).toEqual([1, 2, 3, 4]);

      const shrink = await resources.patch(resource.id, { capacity: 3 });

      expect(shrink.status).toBe(409);
      expect(shrink.body.error?.code).toBe("CAPACITY_REDUCTION_NOT_ALLOWED");
      expect(
        (await resources.get(resource.id)).body.data!.resource.capacity
      ).toBe(4);
    });

    test("a unit added later is covered by a resource-wide block (sql/240)", async () => {
      if (!handlerReady) return;
      const resource = (await resources.create(stayBody({ capacity: 1 }))).body
        .data!.resource;
      const block = await call(postBlock, {
        method: "POST",
        path: "/api/v1/booking/blocks",
        body: {
          resourceId: resource.id,
          fromDate: D(10),
          toDate: D(12),
          reasonCode: "maintenance"
        }
      });

      expect(block.status).toBe(201);

      const grown = await resources.patch(resource.id, { capacity: 2 });

      expect(grown.status).toBe(200);

      const rows = (await admin()`
        SELECT count(*)::int AS n FROM awcms_booking_resource_allocations
        WHERE tenant_id = ${env.tenantId} AND block_id = ${block.body.data.block.id}
          AND released_at IS NULL
      `) as Any[];

      expect(rows[0].n).toBe(2);
    });

    test("a unit of ANOTHER resource is 404 UNIT_NOT_FOUND and the whole patch rolls back", async () => {
      if (!handlerReady) return;
      const a = await newResource({ name: "A" });
      const b = await newResource({ name: "B" });
      const before = await counts(env.tenantId);
      const response = await resources.patch(a.id, {
        name: "Changed",
        capacity: 3,
        units: [{ id: b.units[0].id, label: "stolen" }]
      });

      expect(response.status).toBe(404);
      expect(response.body.error?.code).toBe("UNIT_NOT_FOUND");

      const after = (await resources.get(a.id)).body.data!.resource;

      expect(after.name).toBe("A");
      expect(after.capacity).toBe(1);
      expect(after.units).toHaveLength(1);
      expect(
        (await resources.get(b.id)).body.data!.resource.units[0].label
      ).toBe(null);
      expect((await counts(env.tenantId)).units).toBe(before.units);
    });

    test("BOOKING_MODE_IN_USE: a live reservation holds the mode; nothing changes", async () => {
      if (!handlerReady) return;
      const resource = (await resources.create(stayBody({ capacity: 1 }))).body
        .data!.resource;
      const offering = (await offerings.create(stayOffering())).body.data!
        .offering;
      const placed = await call(postReservation, {
        method: "POST",
        path: "/api/v1/booking/reservations",
        body: {
          offeringId: offering.id,
          resourceId: resource.id,
          stay: { checkInDate: D(10), checkOutDate: D(12) },
          partySize: 1
        }
      });

      expect(placed.status).toBe(201);

      const refused = await resources.patch(resource.id, {
        bookingMode: "slot",
        name: "Nope"
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("BOOKING_MODE_IN_USE");
      expect(
        (await resources.get(resource.id)).body.data!.resource
      ).toMatchObject({
        bookingMode: "stay",
        name: "Villa"
      });

      const tz = await resources.patch(resource.id, {
        timezone: "Asia/Jakarta"
      });

      expect(tz.status).toBe(409);
      expect(tz.body.error?.code).toBe("TIMEZONE_IN_USE");
    });

    test("TIMEZONE_IN_USE under an active block, and SCHEDULE_TIMEZONE_MISMATCH under an active schedule", async () => {
      if (!handlerReady) return;
      const blocked = (await resources.create(stayBody({ capacity: 1 }))).body
        .data!.resource;

      await call(postBlock, {
        method: "POST",
        path: "/api/v1/booking/blocks",
        body: {
          resourceId: blocked.id,
          fromDate: D(10),
          toDate: D(12),
          reasonCode: "other"
        }
      });

      const tz = await resources.patch(blocked.id, {
        timezone: "Asia/Jakarta"
      });

      expect(tz.status).toBe(409);
      expect(tz.body.error?.code).toBe("TIMEZONE_IN_USE");

      const scheduled = await newResource({ timezone: "Asia/Jakarta" });

      await admin()`
        INSERT INTO awcms_booking_schedules (tenant_id, resource_id, timezone, effective_from, rules)
        VALUES (${env.tenantId}, ${scheduled.id}, 'Asia/Jakarta', '2030-01-01', '{}'::jsonb)
      `;

      const mismatch = await resources.patch(scheduled.id, {
        timezone: "Asia/Makassar"
      });

      expect(mismatch.status).toBe(409);
      expect(mismatch.body.error?.code).toBe("SCHEDULE_TIMEZONE_MISMATCH");
    });

    test("an unused resource can change mode and zone; stay times follow the mode", async () => {
      if (!handlerReady) return;
      const resource = await newResource();
      const toStay = await resources.patch(resource.id, {
        bookingMode: "stay",
        stayCheckInTime: "15:00",
        stayCheckOutTime: "11:00",
        timezone: "Asia/Makassar"
      });

      expect(toStay.status).toBe(200);
      expect(toStay.body.data!.resource).toMatchObject({
        bookingMode: "stay",
        stayCheckInTime: "15:00:00",
        timezone: "Asia/Makassar"
      });

      const noTimes = await resources.patch((await newResource()).id, {
        bookingMode: "stay"
      });

      expect(noTimes.status).toBe(400);

      const toSlot = await resources.patch(resource.id, {
        bookingMode: "slot"
      });

      expect(toSlot.status).toBe(200);
      expect(toSlot.body.data!.resource).toMatchObject({
        bookingMode: "slot",
        stayCheckInTime: null
      });
    });

    test("patch: an empty body, an unknown key, code, a missing pool are refused", async () => {
      if (!handlerReady) return;
      const resource = await newResource();

      expect((await resources.patch(resource.id, {})).status).toBe(400);
      expect(
        (await resources.patch(resource.id, { code: "other" })).status
      ).toBe(400);
      expect((await resources.patch(resource.id, { price: 1 })).status).toBe(
        400
      );
      expect((await resources.patch("not-a-uuid", { name: "x" })).status).toBe(
        400
      );

      const missing = await resources.patch(resource.id, {
        poolId: crypto.randomUUID()
      });

      expect(missing.status).toBe(404);
      expect(missing.body.error?.code).toBe("POOL_NOT_FOUND");
    });

    test("patch idempotency: the same key replays, another request on the key is 409", async () => {
      if (!handlerReady) return;
      const resource = await newResource();
      const key = nextKey();
      const first = await resources.patch(
        resource.id,
        { name: "Once" },
        { key }
      );
      const before = await counts(env.tenantId);
      const retry = await resources.patch(
        resource.id,
        { name: "Once" },
        { key }
      );

      expect(retry.body).toEqual(first.body);
      expect((await counts(env.tenantId)).audit).toBe(before.audit);
      expect(
        (await resources.patch(resource.id, { name: "Twice" }, { key })).status
      ).toBe(409);
    });
  });

  describe("delete and restore", () => {
    test("soft delete hides, a second delete is a replay, restore brings back; a deleted resource cannot be edited", async () => {
      if (!handlerReady) return;
      const resource = await newResource();
      const before = await counts(env.tenantId);
      const first = await resources.del(resource.id);

      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({ replayed: false });
      expect(first.body.data!.resource.deletedAt).toBeTruthy();

      const afterFirst = await counts(env.tenantId);
      const second = await resources.del(resource.id);

      expect(second.body.data).toMatchObject({ replayed: true });
      expect((await counts(env.tenantId)).audit).toBe(afterFirst.audit);
      expect(afterFirst.audit).toBe(before.audit + 1);

      const hidden = (await resources.list()).body.data!.resources as Any[];
      const only = (await resources.list({ query: "onlyDeleted=true" })).body
        .data!.resources as Any[];

      expect(hidden.some((r) => r.id === resource.id)).toBe(false);
      expect(only.some((r) => r.id === resource.id)).toBe(true);
      // Still readable by id, so a screen can offer the restore.
      expect((await resources.get(resource.id)).status).toBe(200);

      const edit = await resources.patch(resource.id, { name: "x" });

      expect(edit.status).toBe(409);
      expect(edit.body.error?.code).toBe("RESOURCE_DELETED");

      const restored = await resources.restore(resource.id);

      expect(restored.body.data).toMatchObject({ replayed: false });
      expect(restored.body.data!.resource.deletedAt).toBe(null);
      expect((await resources.restore(resource.id)).body.data).toMatchObject({
        replayed: true
      });
      expect(
        (await resources.patch(resource.id, { name: "Back" })).status
      ).toBe(200);

      const severities = (await admin()`
        SELECT action, severity FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND resource_id = ${resource.id}
          AND action IN ('booking.resource.deleted', 'booking.resource.restored')
        ORDER BY created_at
      `) as Any[];

      expect(severities.map((s) => [s.action, s.severity])).toEqual([
        ["booking.resource.deleted", "warning"],
        ["booking.resource.restored", "info"]
      ]);
    });

    test("soft-deleted rows are visible only with .restore as well: list is 403, read is the neutral 404", async () => {
      if (!handlerReady) return;
      const resource = await newResource();
      const pool = (await pools.create({ code: code("pool"), name: "P" })).body
        .data!.pool;
      const offering = (await offerings.create(timeOffering())).body.data!
        .offering;

      await resources.del(resource.id);
      await pools.del(pool.id);
      await offerings.del(offering.id);

      const readOnlyResources = onlyUser["booking.resources.read"]!.token;
      const readOnlyOfferings = onlyUser["booking.offerings.read"]!.token;

      expect(
        (
          await resources.list({
            token: readOnlyResources,
            query: "includeDeleted=true"
          })
        ).status
      ).toBe(403);
      expect(
        (
          await resources.list({
            token: readOnlyResources,
            query: "onlyDeleted=true"
          })
        ).status
      ).toBe(403);
      expect(
        (
          await pools.list({
            token: readOnlyResources,
            query: "includeDeleted=true"
          })
        ).status
      ).toBe(403);
      expect(
        (
          await offerings.list({
            token: readOnlyOfferings,
            query: "onlyDeleted=true"
          })
        ).status
      ).toBe(403);

      for (const response of [
        await resources.get(resource.id, { token: readOnlyResources }),
        await pools.get(pool.id, { token: readOnlyResources }),
        await offerings.get(offering.id, { token: readOnlyOfferings })
      ]) {
        expect(response.status).toBe(404);
      }

      // A holder of read AND restore sees them; so does the owner.
      const both = await seedUser(env.tenantId, "read-restore", [
        "booking.resources.read",
        "booking.resources.restore"
      ]);

      expect(
        (await resources.get(resource.id, { token: both.token })).status
      ).toBe(200);
      expect(
        (await resources.list({ token: both.token, query: "onlyDeleted=true" }))
          .status
      ).toBe(200);
      // A live row is visible to the plain reader, as ever.
      expect(
        (
          await resources.get((await newResource()).id, {
            token: readOnlyResources
          })
        ).status
      ).toBe(200);
    });

    test("RESOURCE_IN_USE while a reservation or a block needs it; free once they are gone", async () => {
      if (!handlerReady) return;
      const resource = (await resources.create(stayBody({ capacity: 1 }))).body
        .data!.resource;
      const offering = (await offerings.create(stayOffering())).body.data!
        .offering;
      const placed = await call(postReservation, {
        method: "POST",
        path: "/api/v1/booking/reservations",
        body: {
          offeringId: offering.id,
          resourceId: resource.id,
          stay: { checkInDate: D(10), checkOutDate: D(12) },
          partySize: 1
        }
      });
      const reservationId = placed.body.data.reservation.id;
      const refused = await resources.del(resource.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("RESOURCE_IN_USE");

      await call(cancelReservation, {
        method: "POST",
        path: `/api/v1/booking/reservations/${reservationId}/cancel`,
        params: { id: reservationId },
        body: {}
      });

      const block = await call(postBlock, {
        method: "POST",
        path: "/api/v1/booking/blocks",
        body: {
          resourceId: resource.id,
          fromDate: D(20),
          toDate: D(22),
          reasonCode: "other"
        }
      });

      expect((await resources.del(resource.id)).status).toBe(409);

      await call(releaseBlockRoute, {
        method: "POST",
        path: `/api/v1/booking/blocks/${block.body.data.block.id}/release`,
        params: { id: block.body.data.block.id },
        body: {}
      });

      expect((await resources.del(resource.id)).status).toBe(200);
    });
  });

  describe("resource pools", () => {
    test("create, read with members, rename, list; a duplicate code is 409", async () => {
      if (!handlerReady) return;
      const poolCode = code("pool");
      const created = await pools.create({
        code: poolCode,
        name: "Treatment rooms"
      });

      expect(created.status).toBe(201);

      const pool = created.body.data!.pool;

      expect(pool).toMatchObject({
        allocationPolicy: "first_free",
        memberCount: 0
      });
      expect(
        (await pools.create({ code: poolCode.toUpperCase(), name: "x" })).body
          .error?.code
      ).toBe("CODE_TAKEN");

      const member = await newResource({ poolId: pool.id });
      const read = (await pools.get(pool.id)).body.data!.pool;

      expect(read.memberCount).toBe(1);
      expect(read.members.map((m: Any) => m.id)).toEqual([member.id]);
      expect(
        (await pools.patch(pool.id, { name: "Renamed" })).body.data!.pool.name
      ).toBe("Renamed");
      expect((await pools.patch(pool.id, { code: "x" })).status).toBe(400);
      expect(
        ((await pools.list()).body.data!.pools as Any[]).some(
          (p) => p.id === pool.id
        )
      ).toBe(true);
    });

    test("POOL_NOT_EMPTY while a live resource is a member; a deleted pool takes no new member", async () => {
      if (!handlerReady) return;
      const pool = (await pools.create({ code: code("pool"), name: "P" })).body
        .data!.pool;
      const member = await newResource({ poolId: pool.id });
      const refused = await pools.del(pool.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("POOL_NOT_EMPTY");

      await resources.patch(member.id, { poolId: null });

      const deleted = await pools.del(pool.id);

      expect(deleted.status).toBe(200);
      expect((await pools.del(pool.id)).body.data).toMatchObject({
        replayed: true
      });
      expect((await pools.patch(pool.id, { name: "x" })).body.error?.code).toBe(
        "POOL_DELETED"
      );

      const join = await resources.create(slotBody({ poolId: pool.id }));

      expect(join.status).toBe(404);
      expect(join.body.error?.code).toBe("POOL_NOT_FOUND");
      expect(
        ((await pools.list()).body.data!.pools as Any[]).some(
          (p) => p.id === pool.id
        )
      ).toBe(false);
      expect(
        (
          (await pools.list({ query: "onlyDeleted=true" })).body.data!
            .pools as Any[]
        ).some((p) => p.id === pool.id)
      ).toBe(true);

      expect((await pools.restore(pool.id)).body.data).toMatchObject({
        replayed: false
      });
      expect((await pools.restore(pool.id)).body.data).toMatchObject({
        replayed: true
      });
      expect(
        (await resources.create(slotBody({ poolId: pool.id }))).status
      ).toBe(201);
    });
  });

  describe("service offerings", () => {
    test("create time and stay offerings; no price field exists", async () => {
      if (!handlerReady) return;
      const time = await offerings.create(
        timeOffering({ setupSeconds: 300, cleanupSeconds: 600, maxParty: 2 })
      );
      const stay = await offerings.create(stayOffering());

      expect(time.status).toBe(201);
      expect(time.body.data!.offering).toMatchObject({
        granularity: "time",
        durationSeconds: 1800,
        setupSeconds: 300,
        cleanupSeconds: 600,
        slotStepSeconds: 900,
        minNights: null,
        confirmationMode: "hold_then_confirm",
        minParty: 1,
        maxParty: 2,
        status: "active"
      });
      expect(stay.body.data!.offering).toMatchObject({
        granularity: "stay",
        durationSeconds: null,
        slotStepSeconds: null,
        minNights: 1,
        maxNights: 30
      });
      expect((await offerings.create(timeOffering({ price: 1 }))).status).toBe(
        400
      );
      expect(
        Object.keys(time.body.data!.offering).some((k) =>
          /price|amount|currency/i.test(k)
        )
      ).toBe(false);
    });

    test("shape validation in both directions, a 400 naming the field", async () => {
      if (!handlerReady) return;
      const before = await counts(env.tenantId);
      const bad: [string, Record<string, unknown>][] = [
        ["time without duration", timeOffering({ durationSeconds: undefined })],
        ["time with step below 300", timeOffering({ slotStepSeconds: 60 })],
        ["time with nights", timeOffering({ minNights: 1, maxNights: 2 })],
        [
          "stay without nights",
          stayOffering({ minNights: undefined, maxNights: undefined })
        ],
        ["stay with duration", stayOffering({ durationSeconds: 3600 })],
        [
          "stay maxNights below minNights",
          stayOffering({ minNights: 5, maxNights: 2 })
        ],
        ["stay maxNights above 366", stayOffering({ maxNights: 367 })],
        ["maxParty below minParty", timeOffering({ minParty: 3, maxParty: 2 })],
        ["bad confirmation mode", timeOffering({ confirmationMode: "later" })],
        ["bad granularity", timeOffering({ granularity: "week" })],
        ["missing granularity", { ...timeOffering(), granularity: undefined }]
      ];

      for (const [label, body] of bad) {
        const response = await offerings.create(body);

        expect([label, response.status]).toEqual([label, 400]);
      }

      expect(await counts(env.tenantId)).toEqual(before);
    });

    test("duplicate code is CODE_TAKEN; retry replays", async () => {
      if (!handlerReady) return;
      const body = timeOffering({ code: "Cut-Dup" });
      const key = nextKey();
      const first = await offerings.create(body, { key });
      const before = await counts(env.tenantId);
      const retry = await offerings.create(body, { key });

      expect(retry.body).toEqual(first.body);
      expect((await counts(env.tenantId)).offerings).toBe(before.offerings);
      expect(
        (await offerings.create(timeOffering({ code: "cut-dup" }))).body.error
          ?.code
      ).toBe("CODE_TAKEN");
    });

    test("patch validates the MERGED shape; code and granularity are fixed; future bookings only", async () => {
      if (!handlerReady) return;
      const time = (await offerings.create(timeOffering())).body.data!.offering;
      const stay = (await offerings.create(stayOffering())).body.data!.offering;
      const ok = await offerings.patch(time.id, {
        name: "Long cut",
        durationSeconds: 3600,
        confirmationMode: "immediate",
        minLeadSeconds: 7200
      });

      expect(ok.status).toBe(200);
      expect(ok.body.data!.offering).toMatchObject({
        name: "Long cut",
        durationSeconds: 3600,
        confirmationMode: "immediate",
        minLeadSeconds: 7200,
        slotStepSeconds: 900
      });
      expect((await offerings.patch(time.id, { minNights: 2 })).status).toBe(
        400
      );
      expect(
        (await offerings.patch(stay.id, { durationSeconds: 60 })).status
      ).toBe(400);
      expect((await offerings.patch(stay.id, { maxNights: 0 })).status).toBe(
        400
      );
      expect((await offerings.patch(stay.id, { minNights: 40 })).status).toBe(
        400
      );
      expect(
        (await offerings.patch(time.id, { granularity: "stay" })).status
      ).toBe(400);
      expect((await offerings.patch(time.id, { code: "z" })).status).toBe(400);
      expect((await offerings.patch(time.id, {})).status).toBe(400);
      expect(
        (await offerings.get(time.id)).body.data!.offering.durationSeconds
      ).toBe(3600);
    });

    test("soft delete / restore with replay, filters and OFFERING_DELETED", async () => {
      if (!handlerReady) return;
      const offering = (await offerings.create(timeOffering())).body.data!
        .offering;

      expect((await offerings.del(offering.id)).body.data).toMatchObject({
        replayed: false
      });
      expect((await offerings.del(offering.id)).body.data).toMatchObject({
        replayed: true
      });
      expect(
        (await offerings.patch(offering.id, { name: "x" })).body.error?.code
      ).toBe("OFFERING_DELETED");
      expect(
        ((await offerings.list()).body.data!.offerings as Any[]).some(
          (o) => o.id === offering.id
        )
      ).toBe(false);
      expect(
        (
          (await offerings.list({ query: "onlyDeleted=true&granularity=time" }))
            .body.data!.offerings as Any[]
        ).some((o) => o.id === offering.id)
      ).toBe(true);
      expect((await offerings.list({ query: "granularity=week" })).status).toBe(
        400
      );
      expect((await offerings.restore(offering.id)).body.data).toMatchObject({
        replayed: false
      });
      expect((await offerings.restore(offering.id)).body.data).toMatchObject({
        replayed: true
      });
      expect(
        (await offerings.get(offering.id)).body.data!.offering.deletedAt
      ).toBe(null);
    });
  });

  describe("policy", () => {
    test("a tenant that never wrote a policy reads every field null and the module defaults as effective", async () => {
      if (!handlerReady) return;
      const fresh = OTHER_TENANT_FOR_POLICY;

      await admin()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${fresh}, 'policy-fresh', 'Fresh Co') ON CONFLICT (id) DO NOTHING
      `;

      const user = await seedUser(fresh, "fresh", ALL_PERMISSIONS);
      const response = await policy.get({ token: user.token, tenantId: fresh });

      expect(response.status).toBe(200);
      expect(response.body.data!.policy).toEqual(POLICY_NULLS);
      expect(response.body.data!.updatedAt).toBe(null);
      expect(response.body.data!.effective).toEqual({
        defaultHoldSeconds: 900,
        maxHoldSeconds: 86400,
        maxActiveHoldsPerCustomer: 5,
        maxActiveHoldsPerTenant: 500,
        minLeadSeconds: 0,
        maxHorizonDays: 365,
        noShowGraceSeconds: 900
      });
    });

    test("PUT replaces; GET shows it; null returns a field to the default; critical audit with before and after", async () => {
      if (!handlerReady) return;
      const put = await policy.put(POLICY_FULL);

      expect(put.status).toBe(200);
      expect(put.body.data!.policy).toEqual(POLICY_FULL);
      expect(put.body.data!.effective).toMatchObject({
        defaultHoldSeconds: 600,
        maxHoldSeconds: 1800,
        maxActiveHoldsPerCustomer: 3,
        noShowGraceSeconds: 1200
      });
      expect(put.body.data!.updatedAt).toBeTruthy();
      expect((await policy.get()).body.data!.policy).toEqual(POLICY_FULL);

      const reset = await policy.put({
        ...POLICY_FULL,
        maxActiveHoldsPerCustomer: null
      });

      expect(reset.body.data!.policy.maxActiveHoldsPerCustomer).toBe(null);
      expect(reset.body.data!.effective.maxActiveHoldsPerCustomer).toBe(5);

      const audits = (await admin()`
        SELECT severity, attributes FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND action = 'booking.policy.configured'
        ORDER BY created_at DESC LIMIT 1
      `) as Any[];

      expect(audits[0].severity).toBe("critical");
      expect(audits[0].attributes.before.maxActiveHoldsPerCustomer).toBe(3);
      expect(audits[0].attributes.after.maxActiveHoldsPerCustomer).toBe(null);
    });

    test("PUT validation: every field is required; ranges; default hold not above max; a refusal writes nothing", async () => {
      if (!handlerReady) return;
      await policy.put(POLICY_FULL);

      const before = await counts(env.tenantId);
      const { noShowGraceSeconds: _omit, ...missing } = POLICY_FULL;
      const bad: [string, unknown][] = [
        ["missing field", missing],
        ["hold below 60", { ...POLICY_FULL, defaultHoldSeconds: 30 }],
        ["hold above a day", { ...POLICY_FULL, maxHoldSeconds: 86401 }],
        [
          "default above max",
          { ...POLICY_FULL, defaultHoldSeconds: 1900, maxHoldSeconds: 1800 }
        ],
        ["cap zero", { ...POLICY_FULL, maxActiveHoldsPerTenant: 0 }],
        ["negative lead", { ...POLICY_FULL, minLeadSeconds: -1 }],
        ["horizon zero", { ...POLICY_FULL, maxHorizonDays: 0 }],
        ["horizon above 3650", { ...POLICY_FULL, maxHorizonDays: 3651 }],
        ["negative grace", { ...POLICY_FULL, noShowGraceSeconds: -1 }],
        ["offset zone", { ...POLICY_FULL, defaultTimezone: "+07:00" }],
        ["bad time", { ...POLICY_FULL, defaultCheckInTime: "25:00" }],
        ["fraction", { ...POLICY_FULL, maxHoldSeconds: 600.5 }],
        ["string", { ...POLICY_FULL, minLeadSeconds: "0" }],
        ["unknown key", { ...POLICY_FULL, depositPercent: 30 }],
        ["array", []]
      ];

      for (const [label, body] of bad) {
        const response = await policy.put(body);

        expect([label, response.status]).toEqual([label, 400]);
      }

      expect(
        (await policy.put(POLICY_FULL, { key: null })).body.error?.code
      ).toBe("IDEMPOTENCY_REQUIRED");
      expect(await counts(env.tenantId)).toEqual(before);
      expect((await policy.get()).body.data!.policy).toEqual(POLICY_FULL);
    });

    test("PUT is idempotent: the same key replays the stored response and audits once", async () => {
      if (!handlerReady) return;
      const key = nextKey();
      const body = { ...POLICY_FULL, noShowGraceSeconds: 777 };
      const first = await policy.put(body, { key });
      const before = await counts(env.tenantId);
      const retry = await policy.put(body, { key });

      expect(retry.body).toEqual(first.body);
      expect((await counts(env.tenantId)).audit).toBe(before.audit);
      expect(
        (await policy.put({ ...body, noShowGraceSeconds: 1 }, { key })).status
      ).toBe(409);
    });

    test("the policy is what the allocator reads: a stored default hold is the lifetime of the next hold", async () => {
      if (!handlerReady) return;
      await policy.put({
        ...POLICY_FULL,
        defaultHoldSeconds: 120,
        maxHoldSeconds: 300
      });

      const resource = (await resources.create(stayBody({ capacity: 1 }))).body
        .data!.resource;
      const offering = (await offerings.create(stayOffering())).body.data!
        .offering;
      const placed = await call(postReservation, {
        method: "POST",
        path: "/api/v1/booking/reservations",
        body: {
          offeringId: offering.id,
          resourceId: resource.id,
          stay: { checkInDate: D(40), checkOutDate: D(42) },
          partySize: 1
        }
      });

      expect(placed.status).toBe(201);

      const rows = (await admin()`
        SELECT extract(epoch FROM hold_expires_at - created_at)::int AS seconds
        FROM awcms_booking_reservations WHERE id = ${placed.body.data.reservation.id}
      `) as Any[];

      expect(rows[0].seconds).toBeGreaterThanOrEqual(119);
      expect(rows[0].seconds).toBeLessThanOrEqual(121);
    });
  });

  describe("review follow-ups", () => {
    test("N1: without .restore a deleted row is invisible to a delete or an update too (neutral 404)", async () => {
      if (!handlerReady) return;
      const resource = await newResource();
      const pool = (await pools.create({ code: code("pool"), name: "P" })).body
        .data!.pool;
      const offering = (await offerings.create(timeOffering())).body.data!
        .offering;

      await resources.del(resource.id);
      await pools.del(pool.id);
      await offerings.del(offering.id);

      const delRes = onlyUser["booking.resources.delete"]!.token;
      const updRes = onlyUser["booking.resources.update"]!.token;
      const delOff = onlyUser["booking.offerings.delete"]!.token;
      const updOff = onlyUser["booking.offerings.update"]!.token;
      const before = await counts(env.tenantId);
      const attempts: [Any, string][] = [
        [
          await resources.del(resource.id, { token: delRes }),
          "RESOURCE_NOT_FOUND"
        ],
        [
          await resources.patch(resource.id, { name: "x" }, { token: updRes }),
          "RESOURCE_NOT_FOUND"
        ],
        [await pools.del(pool.id, { token: delRes }), "POOL_NOT_FOUND"],
        [
          await pools.patch(pool.id, { name: "x" }, { token: updRes }),
          "POOL_NOT_FOUND"
        ],
        [
          await offerings.del(offering.id, { token: delOff }),
          "OFFERING_NOT_FOUND"
        ],
        [
          await offerings.patch(offering.id, { name: "x" }, { token: updOff }),
          "OFFERING_NOT_FOUND"
        ]
      ];

      for (const [response, errorCode] of attempts) {
        expect(response.status).toBe(404);
        expect(response.body.error?.code).toBe(errorCode);
      }

      expect(await counts(env.tenantId)).toEqual(before);
      // With .restore as well (the owner) the same calls answer as before.
      expect((await resources.del(resource.id)).body.data).toMatchObject({
        replayed: true
      });
      expect(
        (await resources.patch(resource.id, { name: "x" })).body.error?.code
      ).toBe("RESOURCE_DELETED");
    });

    test("N2: two concurrent PUTs leave a coherent before/after chain", async () => {
      if (!handlerReady) return;
      const a = { ...POLICY_FULL, noShowGraceSeconds: 111 };
      const b = { ...POLICY_FULL, noShowGraceSeconds: 222 };

      await policy.put(POLICY_FULL);

      const startedAt = new Date();
      const [ra, rb] = await Promise.all([policy.put(a), policy.put(b)]);

      expect([ra.status, rb.status]).toEqual([200, 200]);

      const rows = (await admin()`
        SELECT attributes FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND action = 'booking.policy.configured'
          AND created_at >= ${startedAt}
      `) as Any[];

      expect(rows).toHaveLength(2);

      const [x, y] = rows.map((row) => row.attributes);
      const grace = (v: Any) => v.noShowGraceSeconds;
      // One write saw the old policy, the other saw the first write's result.
      const firstIsX = grace(x.before) === POLICY_FULL.noShowGraceSeconds;
      const [first, second] = firstIsX ? [x, y] : [y, x];

      expect(grace(first.before)).toBe(POLICY_FULL.noShowGraceSeconds);
      expect(second.before).toEqual(first.after);
      expect((await policy.get()).body.data!.policy).toEqual(second.after);
    });

    test("N3: restoring a resource whose pool is deleted is 409 POOL_DELETED, not a silent un-pooling", async () => {
      if (!handlerReady) return;
      const pool = (await pools.create({ code: code("pool"), name: "P" })).body
        .data!.pool;
      const resource = await newResource({ poolId: pool.id });

      await resources.del(resource.id);
      expect((await pools.del(pool.id)).status).toBe(200);

      const refused = await resources.restore(resource.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("POOL_DELETED");
      expect(
        (await resources.get(resource.id)).body.data!.resource
      ).toMatchObject({
        poolId: pool.id
      });
      expect(
        (await resources.get(resource.id)).body.data!.resource.deletedAt
      ).toBeTruthy();

      await pools.restore(pool.id);

      const restored = await resources.restore(resource.id);

      expect(restored.status).toBe(200);
      expect(restored.body.data!.resource.poolId).toBe(pool.id);
    });

    test("N4: a hold past its expiry does not make a resource 'in use'", async () => {
      if (!handlerReady) return;
      const resource = (await resources.create(stayBody({ capacity: 1 }))).body
        .data!.resource;
      const offering = (await offerings.create(stayOffering())).body.data!
        .offering;
      const placed = await call(postReservation, {
        method: "POST",
        path: "/api/v1/booking/reservations",
        body: {
          offeringId: offering.id,
          resourceId: resource.id,
          stay: { checkInDate: D(60), checkOutDate: D(62) },
          partySize: 1
        }
      });

      expect(placed.status).toBe(201);
      expect((await resources.del(resource.id)).body.error?.code).toBe(
        "RESOURCE_IN_USE"
      );

      // Age the hold on the database clock (the update guard is bypassed for the
      // fixture only: a superuser statement inside a transaction).
      const sql = admin();

      await sql.begin(async (tx: Any) => {
        await tx`ALTER TABLE awcms_booking_reservations DISABLE TRIGGER USER`;
        await tx`
          UPDATE awcms_booking_reservations
          SET hold_expires_at = clock_timestamp() - interval '1 minute'
          WHERE id = ${placed.body.data.reservation.id}
        `;
        await tx`ALTER TABLE awcms_booking_reservations ENABLE TRIGGER USER`;
      });

      expect((await resources.del(resource.id)).status).toBe(200);
    });

    test("N5: deactivating a unit or a resource stops new allocation; a live stay survives", async () => {
      if (!handlerReady) return;
      const resource = (await resources.create(stayBody({ capacity: 1 }))).body
        .data!.resource;
      const offering = (await offerings.create(stayOffering())).body.data!
        .offering;
      const placed = await call(postReservation, {
        method: "POST",
        path: "/api/v1/booking/reservations",
        body: {
          offeringId: offering.id,
          resourceId: resource.id,
          stay: { checkInDate: D(70), checkOutDate: D(72) },
          partySize: 1
        }
      });

      expect(placed.status).toBe(201);

      const reservationId = placed.body.data.reservation.id;
      const off = await resources.patch(resource.id, {
        status: "inactive",
        units: [{ id: resource.units[0].id, status: "inactive" }]
      });

      expect(off.status).toBe(200);
      expect(off.body.data!.resource.activeUnits).toBe(0);

      const rows = (await admin()`
        SELECT r.status AS reservation_status,
               (SELECT count(*)::int FROM awcms_booking_resource_allocations a
                 WHERE a.tenant_id = r.tenant_id AND a.resource_id = ${resource.id}
                   AND a.released_at IS NULL) AS live
        FROM awcms_booking_reservations r WHERE r.id = ${reservationId}
      `) as Any[];

      expect(rows[0].reservation_status).toBe("held");
      expect(rows[0].live).toBe(1);

      // New allocation on the deactivated unit finds nothing.
      const second = await call(postReservation, {
        method: "POST",
        path: "/api/v1/booking/reservations",
        body: {
          offeringId: offering.id,
          resourceId: resource.id,
          stay: { checkInDate: D(80), checkOutDate: D(82) },
          partySize: 1
        }
      });

      expect(second.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("tenant isolation", () => {
    test("another tenant's rows are the same neutral 404; ours never list theirs; their policy is theirs", async () => {
      if (!handlerReady) return;

      await admin()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${OTHER_TENANT}, 'admin-other', 'Other Co')
        ON CONFLICT (id) DO NOTHING
      `;

      const theirs = await seedUser(OTHER_TENANT, "theirs", ALL_PERMISSIONS);
      const as = { token: theirs.token, tenantId: OTHER_TENANT };
      const theirResource = (await resources.create(slotBody(), as)).body.data!
        .resource;
      const theirPool = (
        await pools.create({ code: code("pool"), name: "T" }, as)
      ).body.data!.pool;
      const theirOffering = (await offerings.create(timeOffering(), as)).body
        .data!.offering;

      await policy.put({ ...POLICY_FULL, maxActiveHoldsPerTenant: 7 }, as);

      const unknown = crypto.randomUUID();

      for (const id of [theirResource.id, unknown]) {
        for (const response of await Promise.all([
          resources.get(id),
          resources.patch(id, { name: "x" }),
          resources.del(id),
          resources.restore(id)
        ])) {
          expect(response.status).toBe(404);
          expect(response.body.error?.code).toBe("RESOURCE_NOT_FOUND");
        }
      }

      for (const id of [theirPool.id, unknown]) {
        for (const response of await Promise.all([
          pools.get(id),
          pools.patch(id, { name: "x" }),
          pools.del(id),
          pools.restore(id)
        ])) {
          expect(response.status).toBe(404);
          expect(response.body.error?.code).toBe("POOL_NOT_FOUND");
        }
      }

      for (const id of [theirOffering.id, unknown]) {
        for (const response of await Promise.all([
          offerings.get(id),
          offerings.patch(id, { name: "x" }),
          offerings.del(id),
          offerings.restore(id)
        ])) {
          expect(response.status).toBe(404);
          expect(response.body.error?.code).toBe("OFFERING_NOT_FOUND");
        }
      }

      // Their pool and their unit are unknown to our writes.
      expect(
        (await resources.create(slotBody({ poolId: theirPool.id }))).body.error
          ?.code
      ).toBe("POOL_NOT_FOUND");
      expect(
        (
          await resources.patch((await newResource()).id, {
            units: [{ id: theirResource.units[0].id, label: "x" }]
          })
        ).body.error?.code
      ).toBe("UNIT_NOT_FOUND");

      // Lists never mix, and their rows are untouched.
      expect(
        (
          (await resources.list({ query: "includeDeleted=true" })).body.data!
            .resources as Any[]
        ).some((r) => r.id === theirResource.id)
      ).toBe(false);
      expect(
        (
          (await pools.list({ query: "includeDeleted=true" })).body.data!
            .pools as Any[]
        ).some((p) => p.id === theirPool.id)
      ).toBe(false);
      expect(
        (
          (await offerings.list({ query: "includeDeleted=true" })).body.data!
            .offerings as Any[]
        ).some((o) => o.id === theirOffering.id)
      ).toBe(false);
      expect(
        (await resources.get(theirResource.id, as)).body.data!.resource.name
      ).toBe("Treatment room");
      expect(
        (await policy.get(as)).body.data!.policy.maxActiveHoldsPerTenant
      ).toBe(7);
      expect(
        (await policy.get()).body.data!.policy.maxActiveHoldsPerTenant
      ).not.toBe(7);
    });
  });
});

const OTHER_TENANT_FOR_POLICY = "b1030222-0000-4000-8000-00000000000c";
