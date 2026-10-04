/**
 * The `/api/v1/inventory/*` surface, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #887, ADR-0126) — WORLD-2 of the harness.
 *
 * `inventory-ledger.integration.test.ts` proves the invariants of the posting
 * core. This file proves the wiring around it, which is where a thin route
 * quietly goes wrong:
 *
 *   * default-deny: no token is a 401, an authenticated user with no role is a
 *     403, and a refused request writes nothing;
 *   * `Idempotency-Key` is mandatory on every mutation that posts or configures,
 *     and a replay returns the stored response without posting again;
 *   * a client can never assert a balance — a body naming `onHand` is a 400;
 *   * refusals map to their documented status and code;
 *   * audit rows carry the correlation id, and never the free-text note.
 *
 * The owner comes from the REAL setup + login endpoints, so its permissions are
 * exactly what `bootstrapPlatformTenant` grants — which includes the `inventory`
 * rows only because `sql/170` seeded them. A permission that was never seeded
 * would 403 here even for the owner, which is the failure this guards.
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
import {
  GET as listLocations,
  POST as createLocation
} from "../../src/pages/api/v1/inventory/locations/index";
import {
  GET as getLocation,
  PATCH as patchLocation
} from "../../src/pages/api/v1/inventory/locations/[id]";
import { PUT as putLocationPolicy } from "../../src/pages/api/v1/inventory/locations/[id]/negative-stock-policy";
import {
  GET as getPolicy,
  PUT as putPolicy
} from "../../src/pages/api/v1/inventory/policy";
import {
  GET as listMovements,
  POST as postMovement
} from "../../src/pages/api/v1/inventory/movements/index";
import { GET as getMovement } from "../../src/pages/api/v1/inventory/movements/[id]";
import { POST as postOpening } from "../../src/pages/api/v1/inventory/openings/index";
import { POST as postAdjustment } from "../../src/pages/api/v1/inventory/adjustments/index";
import { POST as postReversal } from "../../src/pages/api/v1/inventory/adjustments/[id]/reversal";
import { POST as postTransfer } from "../../src/pages/api/v1/inventory/transfers/index";
import { GET as listBalances } from "../../src/pages/api/v1/inventory/balances/index";
import { PUT as putThreshold } from "../../src/pages/api/v1/inventory/balances/threshold";
import { GET as getReconciliation } from "../../src/pages/api/v1/inventory/balances/reconciliation";
import { POST as postRebuild } from "../../src/pages/api/v1/inventory/balances/rebuild";

const OWNER_PASSWORD = "Inventory-Owner-Passw0rd!";
const NO_ROLE_TOKEN = "inventory-no-role-session-token";

type Env = { tenantId: string; token: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

let env: Env;
let keyCounter = 0;

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "inventory-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Inventory Co",
      tenantCode: "inventory-co",
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

/** An authenticated tenant user who holds NO role — default-deny's test subject. */
async function seedNoRoleUser(tenantId: string): Promise<void> {
  const admin = getHandlerAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', 'No Role')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, 'no-role@example.com', 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
  `;
  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(NO_ROLE_TOKEN)},
            now() + interval '8 hours')
  `;
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
    "x-awcms-tenant-id": env.tenantId
  };

  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (key) requestHeaders["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.path,
    headers: requestHeaders,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-api-887" }
  });
}

async function newLocation(code: string): Promise<string> {
  const response = await call<{ id: string }>(createLocation, {
    method: "POST",
    path: "/api/v1/inventory/locations",
    body: { code, name: `Location ${code}` }
  });
  expect(response.status).toBe(201);

  return response.body.data!.id;
}

const ITEM = { itemType: "commerce.variant", itemRef: "sku-1" };

function movementBody(
  locationId: string,
  movementType: string,
  quantity: string | number,
  sourceId: string
) {
  return {
    locationId,
    ...ITEM,
    movementType,
    quantity,
    source: { type: "pos_order", id: sourceId, line: "1" }
  };
}

async function onHandOf(locationId: string): Promise<number> {
  const rows = (await getHandlerAdminSql()`
    SELECT on_hand::float8 AS on_hand FROM awcms_inventory_balances
    WHERE tenant_id = ${env.tenantId} AND location_id = ${locationId}
  `) as { on_hand: number }[];

  return rows[0]?.on_hand ?? Number.NaN;
}

async function rowCount(table: string): Promise<number> {
  const rows = (await getHandlerAdminSql().unsafe(
    `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
    [env.tenantId]
  )) as { n: number }[];

  return rows[0]!.n;
}

/**
 * An authenticated tenant user holding EXACTLY `permissionKeys` and nothing
 * else — the subject default-deny is actually about. The owner (every
 * permission) and the no-role user (none) are the two ends; every real
 * deployment lives in the middle, and "has `create`, must not be able to
 * `adjust`" is the property that cannot be tested from either end.
 *
 * Granted through the REAL writer (`grantRolePolicy`), for the same reason
 * `grant-readers.integration.test.ts` does: a fixture that wrote the row itself
 * could put it anywhere the readers happen not to look.
 */
async function seedUserWithPermissions(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string }> {
  const admin = getHandlerAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Partial ${label}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const token = `partial-${label}-session-token`;

  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  const role = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${`role-${label}`}, ${`Role ${label}`})
    RETURNING id
  `) as { id: string }[];

  for (const key of permissionKeys) {
    const [moduleKey, activityCode, action] = key.split(".");
    const permission = (await admin`
      SELECT id FROM awcms_permissions
      WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
        AND action = ${action!}
    `) as { id: string }[];

    if (!permission[0]) {
      throw new Error(`fixture: permission ${key} is not in the catalogue`);
    }

    await admin`
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

  return { token, tenantUserId: tenantUser[0]!.id };
}

async function deniedActionsFor(tenantUserId: string): Promise<string[]> {
  const rows = (await getHandlerAdminSql()`
    SELECT DISTINCT action FROM awcms_abac_decision_logs
    WHERE tenant_id = ${env.tenantId} AND tenant_user_id = ${tenantUserId}
      AND module_key = 'inventory' AND decision = 'deny'
    ORDER BY action
  `) as { action: string }[];

  return rows.map((row) => row.action);
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("inventory HTTP surface (Issue #887)", () => {
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
    await seedNoRoleUser(env.tenantId);
  });

  test("default-deny: no token is 401; an authenticated user with no role is 403 on every verb, and writes nothing", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");

    const anonymous = await call(listLocations, {
      path: "/api/v1/inventory/locations",
      token: null
    });
    expect(anonymous.status).toBe(401);

    const attempts = [
      call(listLocations, {
        path: "/api/v1/inventory/locations",
        token: NO_ROLE_TOKEN
      }),
      call(createLocation, {
        method: "POST",
        path: "/api/v1/inventory/locations",
        token: NO_ROLE_TOKEN,
        body: { code: "x", name: "X" }
      }),
      call(postMovement, {
        method: "POST",
        path: "/api/v1/inventory/movements",
        token: NO_ROLE_TOKEN,
        body: movementBody(locationId, "receive", "1", "deny-1")
      }),
      call(postAdjustment, {
        method: "POST",
        path: "/api/v1/inventory/adjustments",
        token: NO_ROLE_TOKEN,
        body: {}
      }),
      call(postTransfer, {
        method: "POST",
        path: "/api/v1/inventory/transfers",
        token: NO_ROLE_TOKEN,
        body: {}
      }),
      call(postRebuild, {
        method: "POST",
        path: "/api/v1/inventory/balances/rebuild",
        token: NO_ROLE_TOKEN
      }),
      call(getReconciliation, {
        path: "/api/v1/inventory/balances/reconciliation",
        token: NO_ROLE_TOKEN
      }),
      call(putPolicy, {
        method: "PUT",
        path: "/api/v1/inventory/policy",
        token: NO_ROLE_TOKEN,
        body: { defaultNegativeStockPolicy: "allow" }
      })
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await rowCount("awcms_inventory_movements")).toBe(0);
    expect(await rowCount("awcms_inventory_locations")).toBe(1);
  });

  test("a permission denial is recorded in the decision log (the request is not invisible)", async () => {
    if (!handlerReady) return;

    await call(postAdjustment, {
      method: "POST",
      path: "/api/v1/inventory/adjustments",
      token: NO_ROLE_TOKEN,
      body: {}
    });

    const rows = (await getHandlerAdminSql()`
      SELECT decision FROM awcms_abac_decision_logs
      WHERE tenant_id = ${env.tenantId} AND module_key = 'inventory'
        AND action = 'adjust'
    `) as { decision: string }[];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.decision === "deny")).toBe(true);
  });

  test("locations: create, duplicate code is 409, rename/deactivate, and policy is its own endpoint", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");

    const duplicate = await call(createLocation, {
      method: "POST",
      path: "/api/v1/inventory/locations",
      body: { code: "main", name: "Again" }
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe("LOCATION_CODE_CONFLICT");

    const badOffice = await call(createLocation, {
      method: "POST",
      path: "/api/v1/inventory/locations",
      body: {
        code: "elsewhere",
        name: "E",
        officeId: "00000000-0000-4000-8000-000000000001"
      }
    });
    expect(badOffice.status).toBe(422);

    const renamed = await call<{ name: string; status: string }>(
      patchLocation,
      {
        method: "PATCH",
        path: `/api/v1/inventory/locations/${locationId}`,
        params: { id: locationId },
        body: { name: "Main store", status: "inactive" }
      }
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({
      name: "Main store",
      status: "inactive"
    });

    // The policy is NOT patchable through the location endpoint.
    const smuggled = await call(patchLocation, {
      method: "PATCH",
      path: `/api/v1/inventory/locations/${locationId}`,
      params: { id: locationId },
      body: { negativeStockPolicy: "allow" }
    });
    expect(smuggled.status).toBe(400);

    const missing = await call(getLocation, {
      path: "/api/v1/inventory/locations/00000000-0000-4000-8000-000000000009",
      params: { id: "00000000-0000-4000-8000-000000000009" }
    });
    expect(missing.status).toBe(404);

    const listed = await call<{ items: { code: string }[] }>(listLocations, {
      path: "/api/v1/inventory/locations?status=inactive"
    });
    expect(listed.body.data!.items.map((l) => l.code)).toEqual(["main"]);
  });

  test("posting requires Idempotency-Key; a client can never assert a balance", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");

    const noKey = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      idempotencyKey: null,
      body: movementBody(locationId, "receive", "5", "k-1")
    });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error?.code).toBe("IDEMPOTENCY_REQUIRED");

    for (const forbidden of [
      "onHand",
      "balanceAfter",
      "balance",
      "quantityOnHand"
    ]) {
      const response = await call(postMovement, {
        method: "POST",
        path: "/api/v1/inventory/movements",
        body: {
          ...movementBody(locationId, "receive", "5", `k-${forbidden}`),
          [forbidden]: 40
        }
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body.error?.details)).toContain(forbidden);
    }

    expect(await rowCount("awcms_inventory_movements")).toBe(0);
  });

  test("a movement type that has its own endpoint is refused on the generic one", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");

    for (const type of ["adjustment", "transfer_out", "transfer_in"]) {
      const response = await call(postMovement, {
        method: "POST",
        path: "/api/v1/inventory/movements",
        body: movementBody(locationId, type, "1", `t-${type}`)
      });

      expect(response.status).toBe(400);
    }
  });

  test("a posting is 201; the same Idempotency-Key replays the stored response; a different body under it is 409", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const key = nextKey();
    const body = movementBody(locationId, "receive", 5, "idem-1");

    const first = await call<{
      replayed: boolean;
      movements: { id: string }[];
    }>(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      idempotencyKey: key,
      body
    });
    const replay = await call<{
      replayed: boolean;
      movements: { id: string }[];
    }>(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      idempotencyKey: key,
      body
    });
    const conflict = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      idempotencyKey: key,
      body: { ...body, quantity: 6 }
    });

    expect(first.status).toBe(201);
    expect(first.body.data!.replayed).toBe(false);
    expect(replay.status).toBe(201);
    expect(replay.body.data!.movements[0]!.id).toBe(
      first.body.data!.movements[0]!.id
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await rowCount("awcms_inventory_movements")).toBe(1);
  });

  test("the same source identity under a NEW key is a 200 replay of the original; a changed payload is SOURCE_CONFLICT", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const body = movementBody(locationId, "receive", "5", "src-1");

    const first = await call<{ movements: { id: string }[] }>(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body
    });
    const again = await call<{
      replayed: boolean;
      movements: { id: string }[];
    }>(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body
    });
    const changed = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: { ...body, quantity: "9" }
    });

    expect(again.status).toBe(200);
    expect(again.body.data!.replayed).toBe(true);
    expect(again.body.data!.movements[0]!.id).toBe(
      first.body.data!.movements[0]!.id
    );
    expect(changed.status).toBe(409);
    expect(changed.body.error?.code).toBe("SOURCE_CONFLICT");
    expect(await rowCount("awcms_inventory_movements")).toBe(1);
  });

  test("refusals map to their documented status and code, and write nothing", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(locationId, "receive", "2", "stock-1")
    });

    const oversell = await call<never>(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(locationId, "sale", "3", "sell-1")
    });
    expect(oversell.status).toBe(409);
    expect(oversell.body.error?.code).toBe("INSUFFICIENT_STOCK");
    expect(oversell.body.error?.details).toMatchObject({ requested: "3" });
    // The refusal must not become a way to read a balance (needs balances.read).
    expect(JSON.stringify(oversell.body.error)).not.toContain("onHand");

    const ghost = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(
        "00000000-0000-4000-8000-000000000009",
        "receive",
        "1",
        "g-1"
      )
    });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error?.code).toBe("LOCATION_NOT_FOUND");

    const wrongUnit = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: {
        ...movementBody(locationId, "receive", "1", "u-1"),
        unitCode: "box"
      }
    });
    expect(wrongUnit.status).toBe(409);
    expect(wrongUnit.body.error?.code).toBe("UNIT_MISMATCH");

    expect(await rowCount("awcms_inventory_movements")).toBe(1);
  });

  test("a credential-shaped opaque reference is a 400, not a 500 from the event outbox", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const jwtShaped = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk"
    ].join(".");

    const response = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: {
        ...movementBody(locationId, "receive", "1", "c-1"),
        itemRef: jwtShaped
      }
    });

    expect(response.status).toBe(400);
  });

  test("adjustment needs a reason; adjustment + reversal restore the balance; reversal replays; audit carries the correlation id and not the note", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(locationId, "receive", "10", "seed-1")
    });

    const noReason = await call(postAdjustment, {
      method: "POST",
      path: "/api/v1/inventory/adjustments",
      body: {
        locationId,
        ...ITEM,
        quantityDelta: "-2",
        source: { type: "stock_count", id: "count-1" }
      }
    });
    expect(noReason.status).toBe(400);

    const adjusted = await call<{
      movements: { id: string; balanceAfter: string }[];
    }>(postAdjustment, {
      method: "POST",
      path: "/api/v1/inventory/adjustments",
      body: {
        locationId,
        ...ITEM,
        quantityDelta: "-2",
        reasonCode: "shrinkage",
        note: "SECRET-NOTE-do-not-audit",
        source: { type: "stock_count", id: "count-1" }
      }
    });
    expect(adjusted.status).toBe(201);
    expect(adjusted.body.data!.movements[0]).not.toHaveProperty("balanceAfter");
    expect(await onHandOf(locationId)).toBe(8);
    const adjustmentId = adjusted.body.data!.movements[0]!.id;

    const reversal = await call<{
      movements: { id: string; balanceAfter: string }[];
    }>(postReversal, {
      method: "POST",
      path: `/api/v1/inventory/adjustments/${adjustmentId}/reversal`,
      params: { id: adjustmentId },
      body: { reasonCode: "miscount" }
    });
    expect(reversal.status).toBe(201);
    expect(reversal.body.data!.movements[0]).not.toHaveProperty("balanceAfter");
    expect(reversal.body.data!.movements[0]).not.toHaveProperty(
      "request_fingerprint"
    );
    expect(await onHandOf(locationId)).toBe(10);

    // The listing now reports the adjustment as reversed (Issue #900).
    const afterReversal = await call<{
      movements: { id: string; reversedByMovementId: string | null }[];
    }>(listMovements, { path: "/api/v1/inventory/movements" });
    expect(
      afterReversal.body.data!.movements.find((m) => m.id === adjustmentId)!
        .reversedByMovementId
    ).toBe(reversal.body.data!.movements[0]!.id);

    const again = await call<{ replayed: boolean }>(postReversal, {
      method: "POST",
      path: `/api/v1/inventory/adjustments/${adjustmentId}/reversal`,
      params: { id: adjustmentId },
      body: { reasonCode: "miscount" }
    });
    expect(again.status).toBe(200);
    expect(again.body.data!.replayed).toBe(true);

    const audit = (await getHandlerAdminSql()`
      SELECT action, severity, correlation_id, attributes::text AS attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND module_key = 'inventory'
        AND action LIKE 'inventory.adjustment.%'
      ORDER BY created_at
    `) as {
      action: string;
      severity: string;
      correlation_id: string;
      attributes: string;
    }[];

    expect(audit.map((row) => row.action)).toEqual([
      "inventory.adjustment.posted",
      "inventory.adjustment.reversed"
    ]);
    expect(audit.every((row) => row.correlation_id === "corr-api-887")).toBe(
      true
    );
    expect(audit.every((row) => row.severity === "warning")).toBe(true);
    expect(audit.some((row) => row.attributes.includes("SECRET-NOTE"))).toBe(
      false
    );
  });

  test("transfers: a balanced pair, listed by transferId; an oversized transfer is 409 and moves nothing", async () => {
    if (!handlerReady) return;
    const from = await newLocation("main");
    const to = await newLocation("annex");
    await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(from, "receive", "10", "seed-t")
    });

    const moved = await call<{
      movements: { transferId: string; movementType: string }[];
    }>(postTransfer, {
      method: "POST",
      path: "/api/v1/inventory/transfers",
      body: {
        fromLocationId: from,
        toLocationId: to,
        ...ITEM,
        quantity: "4",
        source: { type: "transfer_request", id: "tr-1" }
      }
    });
    expect(moved.status).toBe(201);
    expect(moved.body.data!.movements.map((m) => m.movementType)).toEqual([
      "transfer_out",
      "transfer_in"
    ]);

    const transferId = moved.body.data!.movements[0]!.transferId;
    const listed = await call<{ movements: unknown[] }>(listMovements, {
      path: `/api/v1/inventory/movements?transferId=${transferId}`
    });
    expect(listed.body.data!.movements).toHaveLength(2);

    const sameLocation = await call(postTransfer, {
      method: "POST",
      path: "/api/v1/inventory/transfers",
      body: {
        fromLocationId: from,
        toLocationId: from,
        ...ITEM,
        quantity: "1",
        source: { type: "transfer_request", id: "tr-same" }
      }
    });
    expect(sameLocation.status).toBe(400);

    const tooMuch = await call(postTransfer, {
      method: "POST",
      path: "/api/v1/inventory/transfers",
      body: {
        fromLocationId: from,
        toLocationId: to,
        ...ITEM,
        quantity: "99",
        source: { type: "transfer_request", id: "tr-2" }
      }
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error?.code).toBe("INSUFFICIENT_STOCK");
    expect(await rowCount("awcms_inventory_movements")).toBe(3);
  });

  test("balances: list, threshold, low-stock filter, reconciliation and rebuild over HTTP", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(locationId, "receive", "10", "seed-b")
    });

    const noQuantity = await call(putThreshold, {
      method: "PUT",
      path: "/api/v1/inventory/balances/threshold",
      body: { locationId, ...ITEM, lowStockThreshold: "20", onHand: 999 }
    });
    expect(noQuantity.status).toBe(400);

    const threshold = await call<{ isLow: boolean; onHand: string }>(
      putThreshold,
      {
        method: "PUT",
        path: "/api/v1/inventory/balances/threshold",
        body: { locationId, ...ITEM, lowStockThreshold: "20" }
      }
    );
    expect(threshold.status).toBe(200);
    expect(threshold.body.data).toMatchObject({ isLow: true, onHand: "10" });

    const low = await call<{ balances: { itemRef: string; isLow: boolean }[] }>(
      listBalances,
      { path: "/api/v1/inventory/balances?lowStockOnly=true" }
    );
    expect(low.body.data!.balances.map((b) => b.itemRef)).toEqual(["sku-1"]);

    const consistent = await call<{ consistent: boolean }>(getReconciliation, {
      path: "/api/v1/inventory/balances/reconciliation"
    });
    expect(consistent.body.data!.consistent).toBe(true);

    await getHandlerAdminSql()`
      UPDATE awcms_inventory_balances SET on_hand = 777 WHERE tenant_id = ${env.tenantId}
    `;
    const drifted = await call<{ consistent: boolean; drift: unknown[] }>(
      getReconciliation,
      { path: "/api/v1/inventory/balances/reconciliation" }
    );
    expect(drifted.body.data!.consistent).toBe(false);

    const refused = await call(postRebuild, {
      method: "POST",
      path: "/api/v1/inventory/balances/rebuild",
      body: { onHand: 5 }
    });
    expect(refused.status).toBe(400);

    const rebuilt = await call<{ repaired: { after: { onHand: string } }[] }>(
      postRebuild,
      { method: "POST", path: "/api/v1/inventory/balances/rebuild" }
    );
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.data!.repaired[0]!.after.onHand).toBe("10");

    const audit = (await getHandlerAdminSql()`
      SELECT severity FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND action = 'inventory.balances.rebuilt'
    `) as { severity: string }[];
    expect(audit.map((a) => a.severity)).toEqual(["critical"]);
  });

  test("policy: implicit default is forbid; PUT changes it (audited); a location override is separate", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");

    const initial = await call<{
      defaultNegativeStockPolicy: string;
      isImplicitDefault: boolean;
    }>(getPolicy, { path: "/api/v1/inventory/policy" });
    expect(initial.body.data).toEqual({
      defaultNegativeStockPolicy: "forbid",
      isImplicitDefault: true
    });

    const bad = await call(putPolicy, {
      method: "PUT",
      path: "/api/v1/inventory/policy",
      body: { defaultNegativeStockPolicy: "whatever" }
    });
    expect(bad.status).toBe(400);

    const updated = await call<{ defaultNegativeStockPolicy: string }>(
      putPolicy,
      {
        method: "PUT",
        path: "/api/v1/inventory/policy",
        body: { defaultNegativeStockPolicy: "allow" }
      }
    );
    expect(updated.status).toBe(200);

    const oversell = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(locationId, "sale", "2", "neg-1")
    });
    expect(oversell.status).toBe(201);

    const override = await call<{ negativeStockPolicy: string | null }>(
      putLocationPolicy,
      {
        method: "PUT",
        path: `/api/v1/inventory/locations/${locationId}/negative-stock-policy`,
        params: { id: locationId },
        body: { negativeStockPolicy: "forbid" }
      }
    );
    expect(override.body.data!.negativeStockPolicy).toBe("forbid");

    const blocked = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(locationId, "sale", "1", "neg-2")
    });
    expect(blocked.status).toBe(409);
  });

  test("movements: one row by id, 404 for an unknown one, keyset pagination, and a malformed cursor is 400", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const created: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const response = await call<{ movements: { id: string }[] }>(
        postMovement,
        {
          method: "POST",
          path: "/api/v1/inventory/movements",
          body: movementBody(locationId, "receive", "1", `page-${index}`)
        }
      );
      created.push(response.body.data!.movements[0]!.id);
    }

    const one = await call<{ id: string }>(getMovement, {
      path: `/api/v1/inventory/movements/${created[0]}`,
      params: { id: created[0]! }
    });
    expect(one.body.data!.id).toBe(created[0]!);

    const missing = await call(getMovement, {
      path: "/api/v1/inventory/movements/00000000-0000-4000-8000-000000000009",
      params: { id: "00000000-0000-4000-8000-000000000009" }
    });
    expect(missing.status).toBe(404);

    const listed = await call<{
      movements: { id: string }[];
      nextCursor: string | null;
    }>(listMovements, { path: "/api/v1/inventory/movements" });
    expect(listed.body.data!.movements).toHaveLength(3);
    expect(listed.body.data!.nextCursor).toBeNull();

    const badCursor = await call(listMovements, {
      path: "/api/v1/inventory/movements?cursor=not-a-cursor"
    });
    expect(badCursor.status).toBe(400);
  });
  test("M1 authorization matrix: create + balances.read can post and read, and is 403 on every higher-weight verb", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const cashier = await seedUserWithPermissions(env.tenantId, "cashier", [
      "inventory.movements.create",
      "inventory.balances.read"
    ]);
    const someId = "00000000-0000-4000-8000-000000000042";

    // Positive controls: the grant is real, so a 403 below means something.
    const received = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      token: cashier.token,
      body: movementBody(locationId, "receive", "5", "cashier-1")
    });
    expect(received.status).toBe(201);
    expect(
      (
        await call(listBalances, {
          path: "/api/v1/inventory/balances",
          token: cashier.token
        })
      ).status
    ).toBe(200);

    const forbidden = [
      call(postAdjustment, {
        method: "POST",
        path: "/api/v1/inventory/adjustments",
        token: cashier.token,
        body: {
          locationId,
          ...ITEM,
          quantityDelta: "1",
          reasonCode: "x",
          source: { type: "stock_count", id: "m1-adjust" }
        }
      }),
      call(postReversal, {
        method: "POST",
        path: `/api/v1/inventory/adjustments/${someId}/reversal`,
        params: { id: someId },
        token: cashier.token,
        body: { reasonCode: "x" }
      }),
      call(postTransfer, {
        method: "POST",
        path: "/api/v1/inventory/transfers",
        token: cashier.token,
        body: {
          fromLocationId: locationId,
          toLocationId: someId,
          ...ITEM,
          quantity: "1",
          source: { type: "transfer_request", id: "m1-transfer" }
        }
      }),
      call(postOpening, {
        method: "POST",
        path: "/api/v1/inventory/openings",
        token: cashier.token,
        body: {
          locationId,
          ...ITEM,
          quantity: "9",
          source: { type: "stock_take", id: "m1-opening" }
        }
      }),
      call(postRebuild, {
        method: "POST",
        path: "/api/v1/inventory/balances/rebuild",
        token: cashier.token
      }),
      call(getReconciliation, {
        path: "/api/v1/inventory/balances/reconciliation",
        token: cashier.token
      }),
      call(putThreshold, {
        method: "PUT",
        path: "/api/v1/inventory/balances/threshold",
        token: cashier.token,
        body: { locationId, ...ITEM, lowStockThreshold: "3" }
      }),
      call(putPolicy, {
        method: "PUT",
        path: "/api/v1/inventory/policy",
        token: cashier.token,
        body: { defaultNegativeStockPolicy: "allow" }
      }),
      call(putLocationPolicy, {
        method: "PUT",
        path: `/api/v1/inventory/locations/${locationId}/negative-stock-policy`,
        params: { id: locationId },
        token: cashier.token,
        body: { negativeStockPolicy: "allow" }
      }),
      call(createLocation, {
        method: "POST",
        path: "/api/v1/inventory/locations",
        token: cashier.token,
        body: { code: "sneaky", name: "Sneaky" }
      })
    ];

    for (const response of await Promise.all(forbidden)) {
      expect(response.status).toBe(403);
    }

    // The denial is on the record under the action that was actually missing —
    // not a generic one — for every high-weight verb, attributed to this user.
    expect(await deniedActionsFor(cashier.tenantUserId)).toEqual([
      "adjust",
      "configure",
      "create",
      "rebuild",
      "reconcile",
      "transfer"
    ]);

    // Nothing was written by any refused request.
    expect(await rowCount("awcms_inventory_movements")).toBe(1);
    expect(
      (
        await call<{ defaultNegativeStockPolicy: string }>(getPolicy, {
          path: "/api/v1/inventory/policy"
        })
      ).body.data!.defaultNegativeStockPolicy
    ).toBe("forbid");
  });

  test("M1: adjust alone is 403 on transfers (and on creating movements); transfer is its own grant", async () => {
    if (!handlerReady) return;
    const from = await newLocation("main");
    const to = await newLocation("annex");
    const adjuster = await seedUserWithPermissions(env.tenantId, "adjuster", [
      "inventory.movements.adjust"
    ]);

    const transfer = await call(postTransfer, {
      method: "POST",
      path: "/api/v1/inventory/transfers",
      token: adjuster.token,
      body: {
        fromLocationId: from,
        toLocationId: to,
        ...ITEM,
        quantity: "1",
        source: { type: "transfer_request", id: "m1-adjuster" }
      }
    });
    expect(transfer.status).toBe(403);

    const sale = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      token: adjuster.token,
      body: movementBody(from, "receive", "1", "m1-adjuster-receive")
    });
    expect(sale.status).toBe(403);

    // Positive control: adjust really does allow an adjustment and an opening.
    expect(
      (
        await call(postAdjustment, {
          method: "POST",
          path: "/api/v1/inventory/adjustments",
          token: adjuster.token,
          body: {
            locationId: from,
            ...ITEM,
            quantityDelta: "4",
            reasonCode: "count",
            source: { type: "stock_count", id: "m1-adjuster-ok" }
          }
        })
      ).status
    ).toBe(201);

    expect(await deniedActionsFor(adjuster.tenantUserId)).toEqual([
      "create",
      "transfer"
    ]);
    expect(await rowCount("awcms_inventory_movements")).toBe(1);
  });

  test("M3: an opening needs adjust, not create — and the generic endpoint refuses the type outright", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const cashier = await seedUserWithPermissions(env.tenantId, "cashier2", [
      "inventory.movements.create"
    ]);
    const body = {
      locationId,
      ...ITEM,
      quantity: "9",
      source: { type: "stock_take", id: "open-1" }
    };

    // Not through the generic endpoint, even for the owner.
    const generic = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: { ...body, movementType: "opening" }
    });
    expect(generic.status).toBe(400);

    // Not with `create` alone.
    expect(
      (
        await call(postOpening, {
          method: "POST",
          path: "/api/v1/inventory/openings",
          token: cashier.token,
          body
        })
      ).status
    ).toBe(403);

    // Naming a type on the openings endpoint is refused too.
    expect(
      (
        await call(postOpening, {
          method: "POST",
          path: "/api/v1/inventory/openings",
          body: { ...body, movementType: "sale" }
        })
      ).status
    ).toBe(400);

    // The owner (who holds adjust) can, and it is audited at warning severity.
    const opened = await call(postOpening, {
      method: "POST",
      path: "/api/v1/inventory/openings",
      body
    });
    expect(opened.status).toBe(201);
    expect(await onHandOf(locationId)).toBe(9);

    const audit = (await getHandlerAdminSql()`
      SELECT severity FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND action = 'inventory.movement.opening'
    `) as { severity: string }[];
    expect(audit.map((a) => a.severity)).toEqual(["warning"]);
  });

  test("M3: source.type 'reversal' is reserved on the wire", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const response = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: {
        ...movementBody(locationId, "receive", "1", "x"),
        source: { type: "reversal", id: "x" }
      }
    });

    expect(response.status).toBe(400);
  });

  test("L1: a balance that would overflow numeric(20,6) is a 422, not a 500, and writes nothing", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const huge = "99999999999999.999999";

    expect(
      (
        await call(postMovement, {
          method: "POST",
          path: "/api/v1/inventory/movements",
          body: movementBody(locationId, "receive", huge, "big-1")
        })
      ).status
    ).toBe(201);

    const overflow = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: movementBody(locationId, "receive", "1", "big-2")
    });

    expect(overflow.status).toBe(422);
    expect(overflow.body.error?.code).toBe("QUANTITY_OUT_OF_RANGE");
    expect(await rowCount("awcms_inventory_movements")).toBe(1);
  });

  test("L4: backdating — inside the window is fine; older needs adjust (403 for create alone); the future is a 400", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const cashier = await seedUserWithPermissions(env.tenantId, "cashier3", [
      "inventory.movements.create"
    ]);
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    const post = (token: string, id: string, occurredAt: string) =>
      call(postMovement, {
        method: "POST",
        path: "/api/v1/inventory/movements",
        token,
        body: {
          ...movementBody(locationId, "receive", "1", id),
          occurredAt
        }
      });

    expect((await post(cashier.token, "bd-1", daysAgo(2))).status).toBe(201);

    const tooOld = await post(cashier.token, "bd-2", daysAgo(60));
    expect(tooOld.status).toBe(403);
    expect(tooOld.body.error?.code).toBe("BACKDATE_REQUIRES_ADJUST");
    expect(await deniedActionsFor(cashier.tenantUserId)).toContain("adjust");

    // The owner holds adjust, so the same request is allowed.
    expect((await post(env.token, "bd-2", daysAgo(60))).status).toBe(201);

    expect(
      (
        await post(
          cashier.token,
          "bd-3",
          new Date(Date.now() + 3_600_000).toISOString()
        )
      ).status
    ).toBe(400);
  });

  test("L4: the same source identity with a different note or reason is SOURCE_CONFLICT, and the ledger exposes no fingerprint", async () => {
    if (!handlerReady) return;
    const locationId = await newLocation("main");
    const body = {
      ...movementBody(locationId, "receive", "3", "fp-1"),
      note: "first note"
    };

    const first = await call<{ movements: object[] }>(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body
    });
    expect(first.status).toBe(201);
    expect(JSON.stringify(first.body)).not.toContain("fingerprint");

    const changed = await call(postMovement, {
      method: "POST",
      path: "/api/v1/inventory/movements",
      body: { ...body, note: "a different note" }
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error?.code).toBe("SOURCE_CONFLICT");

    const listed = await call(listMovements, {
      path: "/api/v1/inventory/movements"
    });
    expect(JSON.stringify(listed.body)).not.toContain("fingerprint");
    expect(JSON.stringify(listed.body)).not.toContain("balanceAfter");
  });
});
