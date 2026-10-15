/**
 * The booking block HTTP surface, driven through the REAL route handlers against
 * a real PostgreSQL (Issue #1012, ADR-0131/ADR-0135; docs/awcms/booking.md
 * sections 3, 4 and 6) -- WORLD-2 of the harness.
 *
 * What this proves that the service-level tests (booking-stay) cannot:
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every block
 *     route and writes nothing;
 *   * every `booking.blocks.*` guard BITES, both ways: a user holding every
 *     booking permission EXCEPT one is refused that action, a user holding ONLY
 *     that one is allowed it -- "seeded" and "enforced" are the same fact;
 *   * `Idempotency-Key` (finding N2): required; a retry AFTER the commit returns
 *     the SAME block with the same status and writes nothing -- it is never told
 *     `BLOCK_CONFLICT` about its own block; a reused key with a different
 *     request is 409; five parallel requests make one block; a REFUSAL is not
 *     stored, so the same key succeeds once the obstacle is gone;
 *   * a block never cancels a reservation, and the conflicting reservations are
 *     named only to a caller who also holds `reservations.read`;
 *   * not-found is neutral: an unknown id and another tenant's id are one answer;
 *   * release returns the nights to sale and a second release is a replay;
 *   * a resource-wide block also covers a unit added afterwards (finding N1);
 *   * audit rows, and NO domain event (blocks emit none in v1).
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
  GET as listBlocks,
  POST as postBlock
} from "../../src/pages/api/v1/booking/blocks/index";
import { GET as getBlock } from "../../src/pages/api/v1/booking/blocks/[id]";
import { POST as releaseBlock } from "../../src/pages/api/v1/booking/blocks/[id]/release";
import { POST as postReservation } from "../../src/pages/api/v1/booking/reservations/index";
import { POST as cancelReservation } from "../../src/pages/api/v1/booking/reservations/[id]/cancel";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const OTHER_TENANT = "b1012111-0000-4000-8000-00000000000b";

type Env = { tenantId: string; token: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: any };
};

type Block = {
  id: string;
  resourceId: string;
  unitId: string | null;
  fromDate: string;
  toDate: string;
  nights: number;
  reasonCode: string;
  status: "active" | "released";
  releasedAt: string | null;
  unitIds: string[];
};

type BlockResult = {
  block: Block;
  replayed: boolean;
  releasedAllocations?: number;
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;
let sequence = 0;

const admin = () => getHandlerAdminSql();

function nextKey(): string {
  keyCounter += 1;

  return `blk-${keyCounter}-${crypto.randomUUID()}`;
}

/**
 * Nights ahead of today: far enough that "today" in any zone is before them,
 * near enough to sit inside the default booking horizon. `D(n)` is n days from
 * a fixed offset of 30 days.
 */
const D = (day: number): string =>
  new Date(Date.now() + (30 + day) * 86_400_000).toISOString().slice(0, 10);

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "blk-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Block Co",
      tenantCode: "block-co",
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
const BLOCK_PERMISSIONS = ALL_PERMISSIONS.filter((key) =>
  key.startsWith("booking.blocks.")
);

type Fixture = {
  resourceId: string;
  unitIds: string[];
  offeringId: string;
};

/** A stay resource with `capacity` units and a one-night-minimum stay offering. Fresh codes. */
async function newFixture(
  tenantId: string,
  options: { capacity?: number; mode?: "slot" | "stay" } = {}
): Promise<Fixture> {
  const sql = admin();
  sequence += 1;
  const code = `blk${sequence}`;
  const capacity = options.capacity ?? 1;
  const mode = options.mode ?? "stay";
  const resource = (await sql`
    INSERT INTO awcms_booking_resources
      (tenant_id, code, name, kind, capacity, timezone, booking_mode,
       stay_check_in_time, stay_check_out_time)
    VALUES (${tenantId}, ${code}, ${`Room ${code}`}, 'room', ${capacity},
            'Asia/Pontianak', ${mode},
            ${mode === "stay" ? "14:00" : null}::time,
            ${mode === "stay" ? "12:00" : null}::time)
    RETURNING id
  `) as { id: string }[];
  const unitIds: string[] = [];

  for (let ordinal = 1; ordinal <= capacity; ordinal += 1) {
    const unit = (await sql`
      INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
      VALUES (${tenantId}, ${resource[0]!.id}, ${ordinal})
      RETURNING id
    `) as { id: string }[];

    unitIds.push(unit[0]!.id);
  }

  const offering = (await sql`
    INSERT INTO awcms_booking_service_offerings
      (tenant_id, code, name, granularity, min_nights, max_nights, max_party,
       confirmation_mode)
    VALUES (${tenantId}, ${`night-${code}`}, 'Night', 'stay', 1, 30, 4,
            'hold_then_confirm')
    RETURNING id
  `) as { id: string }[];

  return {
    resourceId: resource[0]!.id,
    unitIds,
    offeringId: offering[0]!.id
  };
}

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

function blockBody(
  fixture: Fixture,
  fromDate: string,
  toDate: string,
  extra: Record<string, unknown> = {}
) {
  return {
    resourceId: fixture.resourceId,
    fromDate,
    toDate,
    reasonCode: "maintenance",
    ...extra
  };
}

function createBlock(
  body: unknown,
  options: {
    token?: string | null;
    key?: string | null;
    tenantId?: string;
  } = {}
) {
  return call<BlockResult>(postBlock, {
    method: "POST",
    path: "/api/v1/booking/blocks",
    body,
    token: options.token,
    idempotencyKey: options.key,
    tenantId: options.tenantId
  });
}

function release(
  id: string,
  options: {
    token?: string | null;
    key?: string | null;
    tenantId?: string;
    body?: unknown;
  } = {}
) {
  return call<BlockResult>(releaseBlock, {
    method: "POST",
    path: `/api/v1/booking/blocks/${id}/release`,
    params: { id },
    body: options.body ?? {},
    token: options.token,
    idempotencyKey: options.key,
    tenantId: options.tenantId
  });
}

function read(id: string, token?: string | null, tenantId?: string) {
  return call<{ block: Block }>(getBlock, {
    path: `/api/v1/booking/blocks/${id}`,
    params: { id },
    token,
    tenantId
  });
}

function list(query = "", token?: string | null) {
  return call<{ blocks: Block[]; nextCursor: string | null }>(listBlocks, {
    path: "/api/v1/booking/blocks",
    query,
    token
  });
}

async function placeStay(
  fixture: Fixture,
  checkInDate: string,
  checkOutDate: string
) {
  const response = await call<{ reservation: { id: string } }>(
    postReservation,
    {
      method: "POST",
      path: "/api/v1/booking/reservations",
      body: {
        offeringId: fixture.offeringId,
        resourceId: fixture.resourceId,
        stay: { checkInDate, checkOutDate },
        partySize: 1
      }
    }
  );

  expect(response.status).toBe(201);

  return response.body.data!.reservation.id;
}

async function counts(tenantId: string) {
  const rows = (await admin()`
    SELECT
      (SELECT count(*) FROM awcms_booking_resource_blocks WHERE tenant_id = ${tenantId})::int AS blocks,
      (SELECT count(*) FROM awcms_booking_resource_allocations WHERE tenant_id = ${tenantId} AND block_id IS NOT NULL)::int AS block_rows,
      (SELECT count(*) FROM awcms_booking_reservations WHERE tenant_id = ${tenantId})::int AS reservations,
      (SELECT count(*) FROM awcms_domain_events WHERE tenant_id = ${tenantId} AND event_type LIKE 'awcms.booking.%')::int AS events,
      (SELECT count(*) FROM awcms_audit_events WHERE tenant_id = ${tenantId} AND module_key = 'booking')::int AS audit,
      (SELECT count(*) FROM awcms_idempotency_keys WHERE tenant_id = ${tenantId} AND request_scope LIKE 'booking_block%')::int AS idem
  `) as {
    blocks: number;
    block_rows: number;
    reservations: number;
    events: number;
    audit: number;
    idem: number;
  }[];

  return { ...rows[0]! };
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;
const onlyUser: Record<string, { token: string; tenantUserId: string }> = {};
const exceptUser: Record<string, { token: string; tenantUserId: string }> = {};

suite("booking block HTTP surface (Issue #1012)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();

    if (!handlerReady) {
      return;
    }

    await resetHandlerDatabase();
    env = await bootstrap();

    for (const key of BLOCK_PERMISSIONS) {
      onlyUser[key] = await seedUser(
        env.tenantId,
        `only-${key.split(".")[2]}`,
        [key]
      );
      exceptUser[key] = await seedUser(
        env.tenantId,
        `except-${key.split(".")[2]}`,
        ALL_PERMISSIONS.filter((candidate) => candidate !== key)
      );
    }
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  test("the three block permissions are in the catalogue", () => {
    expect(BLOCK_PERMISSIONS.sort()).toEqual([
      "booking.blocks.create",
      "booking.blocks.read",
      "booking.blocks.release"
    ]);
  });

  test("default-deny: no token is 401; a user with no role is 403 on every block route and writes nothing", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const fixture = await newFixture(env.tenantId);
    const created = await createBlock(blockBody(fixture, D(10), D(12)));

    expect(created.status).toBe(201);

    const id = created.body.data!.block.id;
    const before = await counts(env.tenantId);

    expect(
      (await createBlock(blockBody(fixture, D(20), D(22)), { token: null }))
        .status
    ).toBe(401);
    expect((await read(id, null)).status).toBe(401);

    const attempts = [
      list("", noRole.token),
      read(id, noRole.token),
      createBlock(blockBody(fixture, D(20), D(22)), { token: noRole.token }),
      release(id, { token: noRole.token })
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await counts(env.tenantId)).toEqual(before);
    expect((await read(id)).body.data!.block.status).toBe("active");
  });

  describe("every guard bites (seeded AND enforced), both ways", () => {
    test("blocks.read", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const id = (await createBlock(blockBody(fixture, D(10), D(12)))).body
        .data!.block.id;
      const key = "booking.blocks.read";

      expect((await read(id, exceptUser[key]!.token)).status).toBe(403);
      expect((await list("", exceptUser[key]!.token)).status).toBe(403);
      expect((await read(id, onlyUser[key]!.token)).status).toBe(200);
      expect((await list("", onlyUser[key]!.token)).status).toBe(200);
    });

    test("blocks.create", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const key = "booking.blocks.create";
      const before = await counts(env.tenantId);

      expect(
        (
          await createBlock(blockBody(fixture, D(10), D(12)), {
            token: exceptUser[key]!.token
          })
        ).status
      ).toBe(403);
      expect((await counts(env.tenantId)).blocks).toBe(before.blocks);
      expect(
        (
          await createBlock(blockBody(fixture, D(10), D(12)), {
            token: onlyUser[key]!.token
          })
        ).status
      ).toBe(201);
    });

    test("blocks.release", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const id = (await createBlock(blockBody(fixture, D(10), D(12)))).body
        .data!.block.id;
      const key = "booking.blocks.release";

      expect(
        (await release(id, { token: exceptUser[key]!.token })).status
      ).toBe(403);
      expect((await read(id)).body.data!.block.status).toBe("active");
      expect((await release(id, { token: onlyUser[key]!.token })).status).toBe(
        200
      );
      expect((await read(id)).body.data!.block.status).toBe("released");
    });
  });

  describe("create", () => {
    test("one unit, then every unit; the response is the block, audited warning, and NO domain event", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 3 });
      const before = await counts(env.tenantId);
      const one = await createBlock(
        blockBody(fixture, D(10), D(12), { unitId: fixture.unitIds[1] })
      );

      expect(one.status).toBe(201);
      expect(one.body.data).toMatchObject({
        replayed: false,
        block: {
          resourceId: fixture.resourceId,
          unitId: fixture.unitIds[1],
          fromDate: D(10),
          toDate: D(12),
          nights: 2,
          reasonCode: "maintenance",
          status: "active",
          releasedAt: null,
          unitIds: [fixture.unitIds[1]]
        }
      });

      const all = await createBlock(
        blockBody(fixture, D(20), D(23), { reasonCode: "owner_use" })
      );

      expect(all.status).toBe(201);
      expect(all.body.data!.block.unitId).toBeNull();
      expect([...all.body.data!.block.unitIds].sort()).toEqual(
        [...fixture.unitIds].sort()
      );

      const after = await counts(env.tenantId);

      expect(after.blocks - before.blocks).toBe(2);
      expect(after.block_rows - before.block_rows).toBe(4);
      expect(after.events).toBe(before.events);

      const audit = (await admin()`
        SELECT severity, message, attributes FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND action = 'booking.block.created'
          AND resource_id = ${one.body.data!.block.id}
      `) as { severity: string; message: string; attributes: unknown }[];

      expect(audit).toHaveLength(1);
      expect(audit[0]!.severity).toBe("warning");
    });

    test("validation: unknown keys, malformed or out-of-order dates, an unknown reason, a missing body", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const before = await counts(env.tenantId);
      const base = blockBody(fixture, D(10), D(12));
      const bad: [string, unknown, string][] = [
        ["unknown key", { ...base, status: "released" }, "VALIDATION_ERROR"],
        [
          "bad resource id",
          { ...base, resourceId: "nope" },
          "VALIDATION_ERROR"
        ],
        ["bad reason", { ...base, reasonCode: "because" }, "VALIDATION_ERROR"],
        [
          "missing reason",
          { ...base, reasonCode: undefined },
          "VALIDATION_ERROR"
        ],
        ["non-object", [], "VALIDATION_ERROR"],
        [
          "instant not date",
          { ...base, fromDate: `${D(10)}T00:00:00Z` },
          "STAY_DATES_INVALID"
        ],
        [
          "reversed",
          { ...base, fromDate: D(12), toDate: D(10) },
          "STAY_DATES_INVALID"
        ],
        [
          "too long",
          { ...base, fromDate: D(1), toDate: D(400) },
          "STAY_DATES_INVALID"
        ],
        ["30 Feb", { ...base, fromDate: "2032-02-30" }, "STAY_DATES_INVALID"]
      ];

      for (const [label, body, code] of bad) {
        const response = await createBlock(body);

        expect([label, response.status, response.body.error?.code]).toEqual([
          label,
          400,
          code
        ]);
      }

      expect((await counts(env.tenantId)).blocks).toBe(before.blocks);
    });

    test("a slot resource, an unknown resource and an unknown unit are refused and write nothing", async () => {
      if (!handlerReady) return;
      const slot = await newFixture(env.tenantId, { mode: "slot" });
      const stay = await newFixture(env.tenantId);
      const before = await counts(env.tenantId);

      const onSlot = await createBlock(blockBody(slot, D(10), D(12)));

      expect(onSlot.status).toBe(409);
      expect(onSlot.body.error?.code).toBe("BOOKING_MODE_MISMATCH");

      const unknown = await createBlock({
        ...blockBody(stay, D(10), D(12)),
        resourceId: crypto.randomUUID()
      });

      expect(unknown.status).toBe(404);
      expect(unknown.body.error?.code).toBe("RESOURCE_NOT_FOUND");

      const noUnit = await createBlock(
        blockBody(stay, D(10), D(12), { unitId: crypto.randomUUID() })
      );

      expect(noUnit.status).toBe(404);
      expect(noUnit.body.error?.code).toBe("UNIT_NOT_FOUND");
      expect((await counts(env.tenantId)).blocks).toBe(before.blocks);
    });
  });

  describe("Idempotency-Key (finding N2)", () => {
    test("is required on create and on release", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const id = (await createBlock(blockBody(fixture, D(10), D(12)))).body
        .data!.block.id;
      const before = await counts(env.tenantId);
      const noKeyCreate = await createBlock(blockBody(fixture, D(20), D(22)), {
        key: null
      });
      const noKeyRelease = await release(id, { key: null });

      expect(noKeyCreate.status).toBe(400);
      expect(noKeyCreate.body.error?.code).toBe("IDEMPOTENCY_REQUIRED");
      expect(noKeyRelease.status).toBe(400);
      expect(noKeyRelease.body.error?.code).toBe("IDEMPOTENCY_REQUIRED");
      expect(await counts(env.tenantId)).toEqual(before);
    });

    test("a retry AFTER the commit returns the SAME block, not BLOCK_CONFLICT about its own block", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 2 });
      const key = nextKey();
      const first = await createBlock(blockBody(fixture, D(10), D(14)), {
        key
      });
      const before = await counts(env.tenantId);
      const retry = await createBlock(blockBody(fixture, D(10), D(14)), {
        key
      });

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      expect(retry.body.data!.block.id).toBe(first.body.data!.block.id);
      // The replay wrote nothing: no block, no row, no audit, no key.
      expect(await counts(env.tenantId)).toEqual(before);
    });

    test("a reused key with a different request is 409 IDEMPOTENCY_CONFLICT; another user's same key is its own request (ADR-0145) and writes nothing", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const key = nextKey();

      expect(
        (await createBlock(blockBody(fixture, D(10), D(12)), { key })).status
      ).toBe(201);

      const before = await counts(env.tenantId);
      const different = await createBlock(blockBody(fixture, D(20), D(22)), {
        key
      });
      const otherUser = await createBlock(blockBody(fixture, D(10), D(12)), {
        key,
        token: onlyUser["booking.blocks.create"]!.token
      });

      expect(different.status).toBe(409);
      expect(different.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");
      // Keys are scoped per actor (ADR-0145): another user's identical key is
      // NOT a replay of the first user's response. It runs as its own request,
      // which the first block refuses for those nights.
      expect(otherUser.status).toBe(409);
      expect(otherUser.body.error?.code).toBe("BLOCK_CONFLICT");
      expect(otherUser.body.data).toBeUndefined();
      expect(await counts(env.tenantId)).toEqual(before);
    });

    test("five parallel requests with one key make one block", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 2 });
      const key = nextKey();
      const before = await counts(env.tenantId);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          createBlock(blockBody(fixture, D(10), D(12)), { key })
        )
      );

      // All five are the one block (the per-key lock serialises them): never a
      // 409 BLOCK_CONFLICT naming the winner's own block.
      for (const response of responses) {
        expect(response.status).toBe(201);
      }

      expect(
        new Set(responses.map((response) => response.body.data!.block.id)).size
      ).toBe(1);
      expect((await counts(env.tenantId)).blocks).toBe(before.blocks + 1);
    });

    test("a REFUSAL is not stored: the same key succeeds once the obstacle is gone", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const reservationId = await placeStay(fixture, D(10), D(12));
      const key = nextKey();
      const refused = await createBlock(blockBody(fixture, D(11), D(13)), {
        key
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("BLOCK_CONFLICT");

      const cancelled = await call(cancelReservation, {
        method: "POST",
        path: `/api/v1/booking/reservations/${reservationId}/cancel`,
        params: { id: reservationId },
        body: {}
      });

      expect(cancelled.status).toBe(200);

      const retry = await createBlock(blockBody(fixture, D(11), D(13)), {
        key
      });

      expect(retry.status).toBe(201);
    });

    test("release is idempotent by key and by state", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 2 });
      const id = (await createBlock(blockBody(fixture, D(10), D(12)))).body
        .data!.block.id;
      const key = nextKey();
      const first = await release(id, { key });
      const before = await counts(env.tenantId);
      const sameKey = await release(id, { key });
      const freshKey = await release(id);

      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({
        replayed: false,
        releasedAllocations: 2,
        block: { status: "released" }
      });
      expect(sameKey.body).toEqual(first.body);
      expect(freshKey.status).toBe(200);
      expect(freshKey.body.data).toMatchObject({
        replayed: true,
        releasedAllocations: 0
      });
      // The state-replay stored its key (a row) but audited and released nothing.
      const after = await counts(env.tenantId);

      expect(after.audit).toBe(before.audit);
      expect(after.block_rows).toBe(before.block_rows);
    });
  });

  describe("a block never cancels a reservation, and says whom only to a reader of reservations", () => {
    test("BLOCK_CONFLICT names the reservation to a caller holding reservations.read, and only says nights are taken to one without it", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const reservationId = await placeStay(fixture, D(10), D(12));
      const before = await counts(env.tenantId);
      const asOwner = await createBlock(blockBody(fixture, D(11), D(13)));
      const asBlocker = await createBlock(blockBody(fixture, D(11), D(13)), {
        token: onlyUser["booking.blocks.create"]!.token
      });

      expect(asOwner.status).toBe(409);
      expect(asOwner.body.error?.code).toBe("BLOCK_CONFLICT");
      expect(asOwner.body.error?.details?.conflicts?.reservations).toHaveLength(
        1
      );
      expect(
        asOwner.body.error?.details?.conflicts?.reservations[0]
      ).toMatchObject({
        reservationId,
        status: "held",
        checkInDate: D(10),
        checkOutDate: D(12)
      });
      expect(
        JSON.stringify(asOwner.body.error?.details?.conflicts)
      ).not.toContain("customer");

      expect(asBlocker.status).toBe(409);
      expect(asBlocker.body.error?.code).toBe("BLOCK_CONFLICT");
      expect(asBlocker.body.error?.details).toBeUndefined();

      // Nothing was written or cancelled.
      const after = await counts(env.tenantId);

      expect(after.blocks).toBe(before.blocks);
      expect(after.block_rows).toBe(before.block_rows);
      expect(after.reservations).toBe(before.reservations);

      const status = (await admin()`
        SELECT status FROM awcms_booking_reservations WHERE id = ${reservationId}
      `) as { status: string }[];

      expect(status[0]!.status).toBe("held");
    });

    test("two overlapping blocks conflict and name the first", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const first = await createBlock(blockBody(fixture, D(10), D(14)));
      const second = await createBlock(blockBody(fixture, D(12), D(16)));

      expect(second.status).toBe(409);
      expect(second.body.error?.details?.conflicts?.blocks).toEqual([
        { blockId: first.body.data!.block.id, fromDate: D(10), toDate: D(14) }
      ]);
    });
  });

  describe("release", () => {
    test("returns the nights to sale; the stay that was refused can now be placed", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId);
      const id = (await createBlock(blockBody(fixture, D(10), D(12)))).body
        .data!.block.id;

      const refused = await call(postReservation, {
        method: "POST",
        path: "/api/v1/booking/reservations",
        body: {
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          stay: { checkInDate: D(10), checkOutDate: D(12) },
          partySize: 1
        }
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("SLOT_UNAVAILABLE");

      const released = await release(id);

      expect(released.status).toBe(200);
      expect(released.body.data!.block.releasedAt).not.toBeNull();
      await placeStay(fixture, D(10), D(12));

      const audit = (await admin()`
        SELECT severity FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND action = 'booking.block.released'
          AND resource_id = ${id}
      `) as { severity: string }[];

      expect(audit).toEqual([{ severity: "info" }]);
    });

    test("the block and its rows carry ONE release instant (finding N4)", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 3 });
      const id = (await createBlock(blockBody(fixture, D(10), D(12)))).body
        .data!.block.id;

      expect((await release(id)).status).toBe(200);

      const rows = (await admin()`
        SELECT count(DISTINCT x.released_at)::int AS distinct_instants,
               count(*)::int AS n,
               bool_and(x.released_at = b.released_at) AS equal_to_block
        FROM awcms_booking_resource_blocks b
        JOIN awcms_booking_resource_allocations x
          ON x.tenant_id = b.tenant_id AND x.block_id = b.id
        WHERE b.id = ${id}
      `) as { distinct_instants: number; n: number; equal_to_block: boolean }[];

      expect(rows[0]).toEqual({
        distinct_instants: 1,
        n: 3,
        equal_to_block: true
      });
    });

    test("an unknown id and another tenant's id are the same neutral 404", async () => {
      if (!handlerReady) return;

      await admin()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${OTHER_TENANT}, 'block-other', 'Other Co')
        ON CONFLICT (id) DO NOTHING
      `;

      const theirs = await seedUser(OTHER_TENANT, "theirs", ALL_PERMISSIONS);
      const theirFixture = await newFixture(OTHER_TENANT);
      const theirBlock = await createBlock(
        blockBody(theirFixture, D(10), D(12)),
        {
          token: theirs.token,
          tenantId: OTHER_TENANT
        }
      );

      expect(theirBlock.status).toBe(201);

      const theirId = theirBlock.body.data!.block.id;
      const unknownId = crypto.randomUUID();
      const asks = await Promise.all([
        read(theirId),
        read(unknownId),
        release(theirId),
        release(unknownId)
      ]);

      for (const response of asks) {
        expect(response.status).toBe(404);
        expect(response.body.error?.code).toBe("BLOCK_NOT_FOUND");
      }

      // A resource of another tenant is just as unknown to a create.
      const cross = await createBlock(blockBody(theirFixture, D(10), D(12)));

      expect(cross.status).toBe(404);
      expect(cross.body.error?.code).toBe("RESOURCE_NOT_FOUND");

      // Theirs was not touched, and ours does not list it.
      expect(
        (await read(theirId, theirs.token, OTHER_TENANT)).body.data!.block
          .status
      ).toBe("active");
      expect(
        (await list()).body.data!.blocks.some((block) => block.id === theirId)
      ).toBe(false);
    });

    test("a malformed id is 400 before any database work", async () => {
      if (!handlerReady) return;

      expect((await read("not-a-uuid")).status).toBe(400);
      expect((await release("not-a-uuid")).status).toBe(400);
    });
  });

  describe("list and read", () => {
    test("filters by resource, unit and status; a bad filter or cursor is 400", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 2 });
      const a = await createBlock(blockBody(fixture, D(10), D(12)));
      const b = await createBlock(
        blockBody(fixture, D(20), D(22), { unitId: fixture.unitIds[0] })
      );

      await release(a.body.data!.block.id);

      const all = await list(`resourceId=${fixture.resourceId}`);

      expect(all.status).toBe(200);
      expect(all.body.data!.blocks.map((block) => block.id)).toEqual([
        b.body.data!.block.id,
        a.body.data!.block.id
      ]);
      expect(
        (
          await list(`resourceId=${fixture.resourceId}&status=active`)
        ).body.data!.blocks.map((block) => block.id)
      ).toEqual([b.body.data!.block.id]);
      expect(
        (
          await list(`resourceId=${fixture.resourceId}&status=released`)
        ).body.data!.blocks.map((block) => block.id)
      ).toEqual([a.body.data!.block.id]);
      expect(
        (
          await list(
            `resourceId=${fixture.resourceId}&unitId=${fixture.unitIds[0]}`
          )
        ).body.data!.blocks.map((block) => block.id)
      ).toEqual([b.body.data!.block.id]);

      expect((await list("status=weird")).status).toBe(400);
      expect((await list("resourceId=x")).status).toBe(400);
      expect((await list("cursor=%%%")).status).toBe(400);
    });

    test("pages by keyset cursor without repeating or skipping", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 1 });

      for (let index = 0; index < 52; index += 1) {
        // One-night blocks on distinct nights of one unit.
        await admin()`
          INSERT INTO awcms_booking_resource_blocks
            (tenant_id, resource_id, block_from, block_to, reason_code, status)
          VALUES (${env.tenantId}, ${fixture.resourceId},
                  ${"2033-01-01"}::date + ${index}::int,
                  ${"2033-01-02"}::date + ${index}::int, 'other', 'active')
        `;
      }

      const seen: string[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 5; page += 1) {
        const response: Awaited<ReturnType<typeof list>> = await list(
          `resourceId=${fixture.resourceId}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
        );

        expect(response.status).toBe(200);
        seen.push(...response.body.data!.blocks.map((block) => block.id));
        cursor = response.body.data!.nextCursor;

        if (!cursor) break;
      }

      expect(seen).toHaveLength(52);
      expect(new Set(seen).size).toBe(52);
    });
  });

  describe("a resource-wide block covers a unit added later (finding N1)", () => {
    test("the new unit gets its night, the reservations route refuses it, and release frees it too", async () => {
      if (!handlerReady) return;
      const fixture = await newFixture(env.tenantId, { capacity: 2 });
      const created = await createBlock(blockBody(fixture, D(10), D(14)));
      const id = created.body.data!.block.id;

      expect(created.body.data!.block.unitIds).toHaveLength(2);

      const added = (await admin()`
        INSERT INTO awcms_booking_resource_units (tenant_id, resource_id, ordinal)
        VALUES (${env.tenantId}, ${fixture.resourceId}, 3)
        RETURNING id
      `) as { id: string }[];
      const view = (await read(id)).body.data!.block;

      expect(view.unitIds).toHaveLength(3);
      expect(view.unitIds).toContain(added[0]!.id);

      // Every unit of the resource is blocked for those nights.
      const attempt = await call(postReservation, {
        method: "POST",
        path: "/api/v1/booking/reservations",
        body: {
          offeringId: fixture.offeringId,
          resourceId: fixture.resourceId,
          stay: { checkInDate: D(11), checkOutDate: D(12) },
          partySize: 1
        }
      });

      expect(attempt.status).toBe(409);
      expect(attempt.body.error?.code).toBe("SLOT_UNAVAILABLE");

      const released = await release(id);

      expect(released.body.data!.releasedAllocations).toBe(3);
      await placeStay(fixture, D(11), D(12));
    });
  });
});
