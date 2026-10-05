/**
 * The `/api/v1/procurement/*` surface, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #888, ADR-0128) — WORLD-2 of the harness.
 *
 * What this proves that the unit tests cannot:
 *
 *   * stock moves ONLY through the ledger, and finalise is idempotent twice over
 *     (Idempotency-Key + the document as natural key) — a replay and six
 *     concurrent finalises post exactly once;
 *   * all lines or none: a ledger refusal on line 2 leaves line 1 unposted;
 *   * reversal compensates through the ledger and is refused, with nothing
 *     posted, when the stock has since been sold;
 *   * every high-risk guard BITES: a user holding every procurement permission
 *     EXCEPT one is refused that action (and the action did not happen), while a
 *     user holding ONLY that permission succeeds — the pair of facts a reviewer
 *     who weakens a guard would have to break;
 *   * supplier tax/business identifiers are masked in every response and absent
 *     from the audit trail, and the one reveal is permissioned and audited;
 *   * the optional approval fails closed and blocks finalise until approved.
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
import { procurementModule } from "../../src/modules/procurement/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as createLocation } from "../../src/pages/api/v1/inventory/locations/index";
import { PUT as putInventoryPolicy } from "../../src/pages/api/v1/inventory/policy";
import { POST as postInventoryMovement } from "../../src/pages/api/v1/inventory/movements/index";
import {
  GET as listSuppliers,
  POST as createSupplier
} from "../../src/pages/api/v1/procurement/suppliers/index";
import {
  DELETE as deleteSupplier,
  GET as getSupplier,
  PATCH as patchSupplier
} from "../../src/pages/api/v1/procurement/suppliers/[id]";
import { POST as restoreSupplier } from "../../src/pages/api/v1/procurement/suppliers/[id]/restore";
import {
  GET as listIdentifiers,
  POST as addIdentifier
} from "../../src/pages/api/v1/procurement/suppliers/[id]/identifiers/index";
import { DELETE as removeIdentifier } from "../../src/pages/api/v1/procurement/suppliers/[id]/identifiers/[identifierId]";
import { POST as revealIdentifier } from "../../src/pages/api/v1/procurement/suppliers/[id]/identifiers/[identifierId]/reveal";
import {
  GET as listDocuments,
  POST as createDocument
} from "../../src/pages/api/v1/procurement/documents/index";
import {
  GET as getDocument,
  PUT as putDocument
} from "../../src/pages/api/v1/procurement/documents/[id]";
import { POST as submitDocument } from "../../src/pages/api/v1/procurement/documents/[id]/submit";
import { POST as finaliseDocument } from "../../src/pages/api/v1/procurement/documents/[id]/finalise";
import { POST as cancelDocument } from "../../src/pages/api/v1/procurement/documents/[id]/cancel";
import { POST as reverseDocument } from "../../src/pages/api/v1/procurement/documents/[id]/reversal";
import { GET as reconcile } from "../../src/pages/api/v1/procurement/documents/reconciliation";
import {
  GET as getPolicy,
  PUT as putPolicy
} from "../../src/pages/api/v1/procurement/policy";
import { GET as reportSuppliers } from "../../src/pages/api/v1/procurement/reports/suppliers";
import { GET as reportReceiving } from "../../src/pages/api/v1/procurement/reports/receiving";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
// Obviously synthetic: not a valid tax number in any scheme.
const FAKE_TAX_ID = "00.000.000.0-000.000";
const FAKE_PAYMENT_REF = "SYNTHETIC-PAYMENT-REF-0000";

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

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "procurement-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Procurement Co",
      tenantCode: "procurement-co",
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

  const owner = (await getHandlerAdminSql()`
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
  const admin = getHandlerAdminSql();
  const tag = `${label}-${userCounter}`;
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const token = `proc-${tag}-${Math.random().toString(36).slice(2)}`;

  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  if (permissionKeys.length > 0) {
    const role = (await admin`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`})
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
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

const ALL_PROCUREMENT_PERMISSIONS = (procurementModule.permissions ?? []).map(
  (permission) => `procurement.${permission.activityCode}.${permission.action}`
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
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers: requestHeaders,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-api-888" }
  });
}

const admin = () => getHandlerAdminSql();

async function newLocation(code: string): Promise<string> {
  const response = await call<{ id: string }>(createLocation, {
    method: "POST",
    path: "/api/v1/inventory/locations",
    body: { code, name: `Location ${code}` }
  });
  expect(response.status).toBe(201);

  return response.body.data!.id;
}

async function newSupplier(
  code: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const response = await call<{ id: string }>(createSupplier, {
    method: "POST",
    path: "/api/v1/procurement/suppliers",
    body: { vendorCode: code, name: `Supplier ${code}`, ...extra }
  });
  expect(response.status).toBe(201);

  return response.body.data!.id;
}

const ITEM_TYPE = "commerce.variant";

function line(ref: string, quantity: string | number, unitCost?: string) {
  return {
    itemType: ITEM_TYPE,
    itemRef: ref,
    sku: `SKU-${ref}`,
    itemName: `Item ${ref}`,
    quantity,
    ...(unitCost === undefined ? {} : { unitCost })
  };
}

type Doc = {
  id: string;
  status: string;
  documentNo: string;
  totalCost: string | null;
  approvalStatus: string;
  movements: { lineNo: number; operation: string; movementId: string }[];
  lines: { lineNo: number; quantity: string; unitCost: string | null }[];
};

async function draft(
  body: Record<string, unknown>,
  token?: string
): Promise<Doc> {
  const response = await call<Doc>(createDocument, {
    method: "POST",
    path: "/api/v1/procurement/documents",
    body,
    token
  });
  expect(response.status).toBe(201);

  return response.body.data!;
}

async function submit(id: string, token?: string) {
  return call<Doc>(submitDocument, {
    method: "POST",
    path: `/api/v1/procurement/documents/${id}/submit`,
    params: { id },
    token
  });
}

async function finalise(
  id: string,
  options: { token?: string; idempotencyKey?: string } = {}
) {
  return call<{ replayed: boolean; document: Doc }>(finaliseDocument, {
    method: "POST",
    path: `/api/v1/procurement/documents/${id}/finalise`,
    params: { id },
    token: options.token,
    idempotencyKey: options.idempotencyKey
  });
}

async function reverse(id: string, token?: string) {
  return call<{ replayed: boolean; document: Doc }>(reverseDocument, {
    method: "POST",
    path: `/api/v1/procurement/documents/${id}/reversal`,
    params: { id },
    body: { reason: "supplier recall" },
    token
  });
}

async function receiveBody(
  supplierId: string,
  locationId: string,
  lines: ReturnType<typeof line>[],
  extra: Record<string, unknown> = {}
) {
  return { mode: "receive", supplierId, locationId, lines, ...extra };
}

async function received(
  supplierId: string,
  locationId: string,
  lines: ReturnType<typeof line>[]
): Promise<Doc> {
  const doc = await draft(await receiveBody(supplierId, locationId, lines));
  expect((await submit(doc.id)).status).toBe(200);
  const done = await finalise(doc.id);
  expect(done.status).toBe(201);

  return done.body.data!.document;
}

async function onHand(locationId: string, itemRef: string): Promise<string> {
  const rows = (await admin()`
    SELECT on_hand::text AS on_hand FROM awcms_inventory_balances
    WHERE tenant_id = ${env.tenantId} AND location_id = ${locationId}
      AND item_type = ${ITEM_TYPE} AND item_ref = ${itemRef}
  `) as { on_hand: string }[];

  return rows[0] ? rows[0].on_hand.replace(/\.?0+$/, "") || "0" : "none";
}

async function count(table: string): Promise<number> {
  const rows = (await admin().unsafe(
    `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
    [env.tenantId]
  )) as { n: number }[];

  return rows[0]!.n;
}

async function procurementMovementCount(): Promise<number> {
  const rows = (await admin()`
    SELECT count(*)::int AS n FROM awcms_inventory_movements
    WHERE tenant_id = ${env.tenantId} AND source_type LIKE 'procurement\\_%'
  `) as { n: number }[];

  return rows[0]!.n;
}

async function deniedActionsFor(tenantUserId: string): Promise<string[]> {
  const rows = (await admin()`
    SELECT DISTINCT action FROM awcms_abac_decision_logs
    WHERE tenant_id = ${env.tenantId} AND tenant_user_id = ${tenantUserId}
      AND module_key = 'procurement' AND decision = 'deny'
    ORDER BY action
  `) as { action: string }[];

  return rows.map((row) => row.action);
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("procurement HTTP surface (Issue #888)", () => {
  let main = "";
  let annex = "";
  let supplier = "";

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
    main = await newLocation("main");
    annex = await newLocation("annex");
    supplier = await newSupplier("ACME");
  });

  // --- default-deny ---------------------------------------------------------------

  test("default-deny: no token is 401; a user with no role is 403 on every verb and writes nothing", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const doc = await draft(
      await receiveBody(supplier, main, [line("a", 1, "1")])
    );
    const before = {
      suppliers: await count("awcms_procurement_suppliers"),
      documents: await count("awcms_procurement_documents")
    };

    expect(
      (
        await call(listSuppliers, {
          path: "/api/v1/procurement/suppliers",
          token: null
        })
      ).status
    ).toBe(401);

    const attempts = [
      call(listSuppliers, {
        path: "/api/v1/procurement/suppliers",
        token: noRole.token
      }),
      call(createSupplier, {
        method: "POST",
        path: "/api/v1/procurement/suppliers",
        token: noRole.token,
        body: { vendorCode: "X", name: "X" }
      }),
      call(createDocument, {
        method: "POST",
        path: "/api/v1/procurement/documents",
        token: noRole.token,
        body: {}
      }),
      call(listDocuments, {
        path: "/api/v1/procurement/documents",
        token: noRole.token
      }),
      call(getDocument, {
        path: `/api/v1/procurement/documents/${doc.id}`,
        params: { id: doc.id },
        token: noRole.token
      }),
      call(submitDocument, {
        method: "POST",
        path: `/api/v1/procurement/documents/${doc.id}/submit`,
        params: { id: doc.id },
        token: noRole.token
      }),
      call(finaliseDocument, {
        method: "POST",
        path: `/api/v1/procurement/documents/${doc.id}/finalise`,
        params: { id: doc.id },
        token: noRole.token
      }),
      call(reconcile, {
        path: "/api/v1/procurement/documents/reconciliation",
        token: noRole.token
      }),
      call(putPolicy, {
        method: "PUT",
        path: "/api/v1/procurement/policy",
        token: noRole.token,
        body: { approvalThreshold: 1 }
      }),
      call(reportSuppliers, {
        path: "/api/v1/procurement/reports/suppliers",
        token: noRole.token
      })
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await count("awcms_procurement_suppliers")).toBe(before.suppliers);
    expect(await count("awcms_procurement_documents")).toBe(before.documents);
    expect(await procurementMovementCount()).toBe(0);
    expect(await deniedActionsFor(noRole.tenantUserId)).toContain("finalise");
  });

  // --- the high-risk guards bite --------------------------------------------------

  describe("every high-risk guard bites (all-but-one is refused, only-that-one succeeds)", () => {
    const without = (key: string) =>
      ALL_PROCUREMENT_PERMISSIONS.filter((candidate) => candidate !== key);

    test("finalise: everything EXCEPT documents.finalise cannot post stock; ONLY documents.finalise can", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("g1", 4, "2")])
      );
      expect((await submit(doc.id)).status).toBe(200);
      const almost = await seedUser(
        env.tenantId,
        "all-but-finalise",
        without("procurement.documents.finalise")
      );
      const only = await seedUser(env.tenantId, "only-finalise", [
        "procurement.documents.finalise"
      ]);

      const refused = await finalise(doc.id, { token: almost.token });
      expect(refused.status).toBe(403);
      expect(await procurementMovementCount()).toBe(0);
      expect(await onHand(main, "g1")).toBe("none");
      expect(await deniedActionsFor(almost.tenantUserId)).toEqual(["finalise"]);

      const allowed = await finalise(doc.id, { token: only.token });
      expect(allowed.status).toBe(201);
      expect(await onHand(main, "g1")).toBe("4");
    });

    test("reverse: everything EXCEPT documents.reverse cannot compensate stock; ONLY documents.reverse can", async () => {
      if (!handlerReady) return;
      const doc = await received(supplier, main, [line("g2", 3, "1")]);
      const almost = await seedUser(
        env.tenantId,
        "all-but-reverse",
        without("procurement.documents.reverse")
      );
      const only = await seedUser(env.tenantId, "only-reverse", [
        "procurement.documents.reverse"
      ]);

      expect((await reverse(doc.id, almost.token)).status).toBe(403);
      expect(await onHand(main, "g2")).toBe("3");
      expect((await getDoc(doc.id)).status).toBe("finalised");

      expect((await reverse(doc.id, only.token)).status).toBe(201);
      expect(await onHand(main, "g2")).toBe("0");
    });

    test("cancel: everything EXCEPT documents.cancel cannot cancel; ONLY documents.cancel can", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("g3", 1, "1")])
      );
      const almost = await seedUser(
        env.tenantId,
        "all-but-cancel",
        without("procurement.documents.cancel")
      );
      const only = await seedUser(env.tenantId, "only-cancel", [
        "procurement.documents.cancel"
      ]);
      const cancel = (token: string) =>
        call<Doc>(cancelDocument, {
          method: "POST",
          path: `/api/v1/procurement/documents/${doc.id}/cancel`,
          params: { id: doc.id },
          body: { reason: "ordered twice" },
          token
        });

      expect((await cancel(almost.token)).status).toBe(403);
      expect((await getDoc(doc.id)).status).toBe("draft");
      expect((await cancel(only.token)).status).toBe(200);
      expect((await getDoc(doc.id)).status).toBe("cancelled");
    });

    test("submit: everything EXCEPT documents.submit cannot freeze a draft; ONLY documents.submit can", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("g4", 1, "1")])
      );
      const almost = await seedUser(
        env.tenantId,
        "all-but-submit",
        without("procurement.documents.submit")
      );
      const only = await seedUser(env.tenantId, "only-submit", [
        "procurement.documents.submit"
      ]);

      expect((await submit(doc.id, almost.token)).status).toBe(403);
      expect((await getDoc(doc.id)).status).toBe("draft");
      expect((await submit(doc.id, only.token)).status).toBe(200);
    });

    test("reveal: everything EXCEPT suppliers.reveal cannot read an identifier in clear; ONLY suppliers.reveal can — and it is audited", async () => {
      if (!handlerReady) return;
      const identifierId = await addTaxId(supplier);
      const almost = await seedUser(
        env.tenantId,
        "all-but-reveal",
        without("procurement.suppliers.reveal")
      );
      const only = await seedUser(env.tenantId, "only-reveal", [
        "procurement.suppliers.reveal"
      ]);
      const reveal = (token: string) =>
        call<{ value: string }>(revealIdentifier, {
          method: "POST",
          path: `/api/v1/procurement/suppliers/${supplier}/identifiers/${identifierId}/reveal`,
          params: { id: supplier, identifierId },
          token
        });

      const refused = await reveal(almost.token);
      expect(refused.status).toBe(403);
      expect(JSON.stringify(refused.body)).not.toContain(FAKE_TAX_ID);
      expect(await revealAuditCount()).toBe(0);

      const allowed = await reveal(only.token);
      expect(allowed.status).toBe(200);
      expect(allowed.body.data!.value).toBe(FAKE_TAX_ID);
      expect(await revealAuditCount()).toBe(1);
    });

    test("policy.configure, reconcile and reports.read each gate their own endpoint", async () => {
      if (!handlerReady) return;
      const cases = [
        {
          key: "procurement.policy.configure",
          run: (token: string) =>
            call(putPolicy, {
              method: "PUT",
              path: "/api/v1/procurement/policy",
              body: { approvalThreshold: 100 },
              token
            })
        },
        {
          key: "procurement.documents.reconcile",
          run: (token: string) =>
            call(reconcile, {
              path: "/api/v1/procurement/documents/reconciliation",
              token
            })
        },
        {
          key: "procurement.reports.read",
          run: (token: string) =>
            call(reportReceiving, {
              path: "/api/v1/procurement/reports/receiving",
              token
            })
        }
      ];

      for (const { key, run } of cases) {
        const almost = await seedUser(env.tenantId, `ab-${key}`, without(key));
        const only = await seedUser(env.tenantId, `only-${key}`, [key]);

        expect((await run(almost.token)).status).toBe(403);
        expect((await run(only.token)).status).toBe(200);
      }
    });

    test("reading is not writing: a reader (suppliers.read, documents.read) can create and finalise nothing", async () => {
      if (!handlerReady) return;
      const reader = await seedUser(env.tenantId, "reader", [
        "procurement.suppliers.read",
        "procurement.documents.read"
      ]);
      const doc = await draft(
        await receiveBody(supplier, main, [line("g5", 1, "1")])
      );

      expect(
        (
          await call(createDocument, {
            method: "POST",
            path: "/api/v1/procurement/documents",
            body: await receiveBody(supplier, main, [line("g5b", 1, "1")]),
            token: reader.token
          })
        ).status
      ).toBe(403);
      expect((await finalise(doc.id, { token: reader.token })).status).toBe(
        403
      );
      expect(
        (
          await call(listDocuments, {
            path: "/api/v1/procurement/documents",
            token: reader.token
          })
        ).status
      ).toBe(200);
    });
  });

  // --- lifecycle and the ledger ---------------------------------------------------

  describe("receiving through the ledger", () => {
    test("draft -> submit -> finalise posts the receipt, links the movements and reconciles", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [
          line("r1", "10", "2.5"),
          line("r2", 4, "1.25")
        ])
      );

      expect(doc.status).toBe("draft");
      expect(doc.documentNo).toMatch(/^RCV-\d{8}-[0-9A-F]{10}$/);
      expect(await onHand(main, "r1")).toBe("none");

      const submitted = await submit(doc.id);
      expect(submitted.status).toBe(200);
      // 10 x 2.5 + 4 x 1.25 = 30, computed in SQL.
      expect(submitted.body.data!.totalCost).toBe("30");
      expect(submitted.body.data!.status).toBe("submitted");

      const done = await finalise(doc.id);
      expect(done.status).toBe(201);
      expect(done.body.data!.replayed).toBe(false);
      expect(done.body.data!.document.status).toBe("finalised");
      expect(done.body.data!.document.movements).toHaveLength(2);
      expect(await onHand(main, "r1")).toBe("10");
      expect(await onHand(main, "r2")).toBe("4");

      // The ledger rows carry the document identity and the request's
      // correlation id, so the two halves of one business action can be joined.
      const rows = (await admin()`
        SELECT source_type, source_id, source_line, operation, correlation_id
        FROM awcms_inventory_movements
        WHERE tenant_id = ${env.tenantId} AND source_type = 'procurement_receipt'
        ORDER BY source_line
      `) as {
        source_type: string;
        source_id: string;
        source_line: string;
        operation: string;
        correlation_id: string;
      }[];
      expect(rows.map((row) => row.source_line)).toEqual(["1", "2"]);
      expect(rows.every((row) => row.source_id === doc.id)).toBe(true);
      expect(rows.every((row) => row.operation === "receive")).toBe(true);
      expect(rows.every((row) => row.correlation_id === "corr-api-888")).toBe(
        true
      );

      const recon = await call<{
        reconciled: boolean;
        linesChecked: number;
        unlinkedLedgerMovements: number;
      }>(reconcile, { path: "/api/v1/procurement/documents/reconciliation" });
      expect(recon.body.data!.reconciled).toBe(true);
      expect(recon.body.data!.linesChecked).toBe(2);
      expect(recon.body.data!.unlinkedLedgerMovements).toBe(0);
    });

    test("line snapshots keep SKU, name, unit and exact cost; a supplier rename does not rewrite the document", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("s1", "0.000001", "0.1")])
      );

      expect(doc.lines[0]).toMatchObject({
        quantity: "0.000001",
        unitCost: "0.1"
      });

      await call(patchSupplier, {
        method: "PATCH",
        path: `/api/v1/procurement/suppliers/${supplier}`,
        params: { id: supplier },
        body: { name: "Renamed Supplier" }
      });

      const reread = await call<{
        supplier: { id: string; code: string; name: string };
      }>(getDocument, {
        path: `/api/v1/procurement/documents/${doc.id}`,
        params: { id: doc.id }
      });
      expect(reread.body.data!.supplier).toEqual({
        id: supplier,
        code: "ACME",
        name: "Supplier ACME"
      });
    });

    test("finalise REPLAY posts nothing again — same key, a different key and a retry after success", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("p1", 5, "1")])
      );
      await submit(doc.id);
      const key = nextKey();

      const first = await finalise(doc.id, { idempotencyKey: key });
      const sameKey = await finalise(doc.id, { idempotencyKey: key });
      const newKey = await finalise(doc.id);

      expect(first.status).toBe(201);
      expect(sameKey.status).toBe(201);
      expect(sameKey.body).toEqual(first.body);
      expect(newKey.status).toBe(200);
      expect(newKey.body.data!.replayed).toBe(true);
      expect(await procurementMovementCount()).toBe(1);
      expect(await onHand(main, "p1")).toBe("5");
      expect(await auditCount("procurement.document.finalised")).toBe(1);
      expect(
        await domainEventCount("awcms.procurement.document.finalised")
      ).toBe(1);
    });

    test("the same Idempotency-Key against a DIFFERENT document is a 409, not a replay", async () => {
      if (!handlerReady) return;
      const a = await draft(
        await receiveBody(supplier, main, [line("k1", 1, "1")])
      );
      const b = await draft(
        await receiveBody(supplier, main, [line("k2", 1, "1")])
      );
      await submit(a.id);
      await submit(b.id);
      const key = nextKey();

      expect((await finalise(a.id, { idempotencyKey: key })).status).toBe(201);
      const clash = await finalise(b.id, { idempotencyKey: key });

      expect(clash.status).toBe(409);
      expect(clash.body.error!.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(await onHand(main, "k2")).toBe("none");
    });

    test("six CONCURRENT finalises of one document post exactly once", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [
          line("c1", 7, "1"),
          line("c2", 3, "1")
        ])
      );
      await submit(doc.id);

      const results = await Promise.all(
        Array.from({ length: 6 }, () => finalise(doc.id))
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        results.filter((r) => r.status === 200 && r.body.data!.replayed)
      ).toHaveLength(5);
      expect(await onHand(main, "c1")).toBe("7");
      expect(await onHand(main, "c2")).toBe("3");
      expect(await procurementMovementCount()).toBe(2);
    });

    test("concurrent receipts of the same item sum exactly, and documents with overlapping items in opposite line order do not deadlock", async () => {
      if (!handlerReady) return;
      const docs: Doc[] = [];

      for (let index = 0; index < 6; index += 1) {
        const lines =
          index % 2 === 0
            ? [line("x-alpha", 1, "1"), line("x-beta", 2, "1")]
            : [line("x-beta", 2, "1"), line("x-alpha", 1, "1")];
        const doc = await draft(await receiveBody(supplier, main, lines));
        await submit(doc.id);
        docs.push(doc);
      }

      const results = await Promise.all(docs.map((doc) => finalise(doc.id)));

      expect(results.map((r) => r.status)).toEqual([
        201, 201, 201, 201, 201, 201
      ]);
      expect(await onHand(main, "x-alpha")).toBe("6");
      expect(await onHand(main, "x-beta")).toBe("12");
    });

    test("documents with the same items at DIFFERENT locations, in opposite line order, receipts and opposing transfers together, do not deadlock", async () => {
      if (!handlerReady) return;
      await received(supplier, main, [
        line("dl-a", 1000, "1"),
        line("dl-b", 1000, "1")
      ]);
      await received(supplier, annex, [
        line("dl-a", 1000, "1"),
        line("dl-b", 1000, "1")
      ]);
      const docs: Doc[] = [];

      for (let index = 0; index < 4; index += 1) {
        const ab = [line("dl-a", 1, "1"), line("dl-b", 2, "1")];
        const ba = [line("dl-b", 2, "1"), line("dl-a", 1, "1")];
        const plain = (lines: ReturnType<typeof line>[]) =>
          lines.map(({ unitCost: _cost, ...rest }) => rest);

        for (const body of [
          await receiveBody(supplier, main, ab),
          await receiveBody(supplier, annex, ba),
          {
            mode: "transfer",
            locationId: annex,
            sourceLocationId: main,
            lines: plain(ba)
          },
          {
            mode: "transfer",
            locationId: main,
            sourceLocationId: annex,
            lines: plain(ab)
          }
        ]) {
          const doc = await draft(body);
          await submit(doc.id);
          docs.push(doc);
        }
      }

      const results = await Promise.all(docs.map((doc) => finalise(doc.id)));

      // No 40P01 (it would surface as a 500): every document is posted.
      expect(results.map((r) => r.status)).toEqual(docs.map(() => 201));
      // 4 receipts of (1, 2) into each location, transfers net to zero overall.
      expect(
        Number(await onHand(main, "dl-a")) + Number(await onHand(annex, "dl-a"))
      ).toBe(2000 + 8);
      expect(
        Number(await onHand(main, "dl-b")) + Number(await onHand(annex, "dl-b"))
      ).toBe(2000 + 16);
    });

    test("an unsubmitted or cancelled document cannot be finalised", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("n1", 1, "1")])
      );

      const early = await finalise(doc.id);
      expect(early.status).toBe(409);
      expect(early.body.error!.code).toBe("INVALID_STATE");

      await call(cancelDocument, {
        method: "POST",
        path: `/api/v1/procurement/documents/${doc.id}/cancel`,
        params: { id: doc.id },
        body: { reason: "mistake" }
      });
      expect((await finalise(doc.id)).status).toBe(409);
      expect(await procurementMovementCount()).toBe(0);
    });

    test("finalised documents are immutable through the API too, and a draft edit is allowed only while draft", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("m1", 2, "1")])
      );
      const edit = async (quantity: number) =>
        call<Doc>(putDocument, {
          method: "PUT",
          path: `/api/v1/procurement/documents/${doc.id}`,
          params: { id: doc.id },
          body: await receiveBody(supplier, main, [line("m1", quantity, "1")])
        });

      const edited = await edit(9);
      expect(edited.status).toBe(200);
      expect(edited.body.data!.lines[0]!.quantity).toBe("9");

      await submit(doc.id);
      const frozen = await edit(1);
      expect(frozen.status).toBe(409);
      expect(frozen.body.error!.code).toBe("INVALID_STATE");

      await finalise(doc.id);
      expect((await edit(1)).status).toBe(409);
      expect((await getDoc(doc.id)).lines[0]!.quantity).toBe("9");
    });

    test("a client cannot assert state, totals, snapshots or a balance", async () => {
      if (!handlerReady) return;

      for (const forbidden of [
        { status: "finalised" },
        { totalCost: "1" },
        { documentNo: "RCV-FAKE" },
        { supplierName: "x" },
        { approvalStatus: "approved" },
        { onHand: 99 }
      ]) {
        const response = await call(createDocument, {
          method: "POST",
          path: "/api/v1/procurement/documents",
          body: {
            ...(await receiveBody(supplier, main, [line("f1", 1, "1")])),
            ...forbidden
          }
        });

        expect(response.status).toBe(400);
      }

      expect(await count("awcms_procurement_documents")).toBe(0);
    });

    test("a duplicate external reference for one supplier is refused until the first is cancelled", async () => {
      if (!handlerReady) return;
      const body = await receiveBody(supplier, main, [line("e1", 1, "1")], {
        externalReference: "DN-0001"
      });
      const first = await draft(body);
      const dup = await call(createDocument, {
        method: "POST",
        path: "/api/v1/procurement/documents",
        body
      });

      expect(dup.status).toBe(409);
      expect(dup.body.error!.code).toBe("DUPLICATE_EXTERNAL_REFERENCE");

      // Concurrent creates with one reference: exactly one wins.
      const racing = await Promise.all(
        Array.from({ length: 4 }, () =>
          call(createDocument, {
            method: "POST",
            path: "/api/v1/procurement/documents",
            body: { ...body, externalReference: "DN-RACE" }
          })
        )
      );
      expect(racing.filter((r) => r.status === 201)).toHaveLength(1);

      await call(cancelDocument, {
        method: "POST",
        path: `/api/v1/procurement/documents/${first.id}/cancel`,
        params: { id: first.id },
        body: { reason: "wrong note" }
      });
      expect(
        (
          await call(createDocument, {
            method: "POST",
            path: "/api/v1/procurement/documents",
            body
          })
        ).status
      ).toBe(201);
    });

    test("a blocked or deleted supplier cannot take part, and cannot be deleted with open documents", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("b1", 1, "1")])
      );

      const blocked = await call(deleteSupplier, {
        method: "DELETE",
        path: `/api/v1/procurement/suppliers/${supplier}`,
        params: { id: supplier }
      });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error!.code).toBe("SUPPLIER_HAS_OPEN_DOCUMENTS");

      await submit(doc.id);
      await call(patchSupplier, {
        method: "PATCH",
        path: `/api/v1/procurement/suppliers/${supplier}`,
        params: { id: supplier },
        body: { status: "blocked" }
      });
      const refused = await finalise(doc.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("SUPPLIER_UNAVAILABLE");
      expect(await procurementMovementCount()).toBe(0);
    });
  });

  describe("all lines or none", () => {
    test("a supplier return refused on line 2 posts nothing for line 1 and leaves the document submitted", async () => {
      if (!handlerReady) return;
      await received(supplier, main, [line("z1", 5, "1"), line("z2", 1, "1")]);
      const before = await procurementMovementCount();
      const doc = await draft({
        mode: "supplier_return",
        supplierId: supplier,
        locationId: main,
        lines: [line("z1", 5, "1"), line("z2", 2, "1")]
      });
      await submit(doc.id);

      const refused = await finalise(doc.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("INSUFFICIENT_STOCK");
      expect(JSON.stringify(refused.body)).not.toMatch(/onHand/);
      // Line 1 WOULD have succeeded on its own; it must not have been posted.
      expect(await onHand(main, "z1")).toBe("5");
      expect(await onHand(main, "z2")).toBe("1");
      expect(await procurementMovementCount()).toBe(before);
      expect((await getDoc(doc.id)).status).toBe("submitted");
      expect((await getDoc(doc.id)).movements).toHaveLength(0);
    });

    test("an inactive location refuses the whole document", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, annex, [line("i1", 1, "1")])
      );
      await submit(doc.id);
      await admin()`
        UPDATE awcms_inventory_locations SET status = 'inactive'
        WHERE tenant_id = ${env.tenantId} AND id = ${annex}
      `;

      const refused = await finalise(doc.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("LOCATION_INACTIVE");
      expect(await procurementMovementCount()).toBe(0);
    });
  });

  describe("supplier return, requisition and transfer", () => {
    test("a supplier return takes stock out; a transfer posts a balanced out/in pair", async () => {
      if (!handlerReady) return;
      await received(supplier, main, [line("t1", 10, "1")]);

      const ret = await draft({
        mode: "supplier_return",
        supplierId: supplier,
        locationId: main,
        lines: [line("t1", 4, "1")]
      });
      await submit(ret.id);
      expect((await finalise(ret.id)).status).toBe(201);
      expect(await onHand(main, "t1")).toBe("6");

      const transfer = await draft({
        mode: "transfer",
        locationId: annex,
        sourceLocationId: main,
        lines: [line("t1", 2.5)]
      });
      await submit(transfer.id);
      const done = await finalise(transfer.id);
      expect(done.status).toBe(201);
      expect(done.body.data!.document.movements).toHaveLength(2);
      expect(await onHand(main, "t1")).toBe("3.5");
      expect(await onHand(annex, "t1")).toBe("2.5");

      const pair = (await admin()`
        SELECT movement_type, quantity_delta::text AS delta, transfer_id
        FROM awcms_inventory_movements
        WHERE tenant_id = ${env.tenantId} AND source_type = 'procurement_transfer'
        ORDER BY movement_type
      `) as { movement_type: string; delta: string; transfer_id: string }[];
      expect(pair.map((row) => row.movement_type)).toEqual([
        "transfer_in",
        "transfer_out"
      ]);
      expect(pair[0]!.transfer_id).toBe(pair[1]!.transfer_id);

      const recon = await call<{ reconciled: boolean }>(reconcile, {
        path: "/api/v1/procurement/documents/reconciliation"
      });
      expect(recon.body.data!.reconciled).toBe(true);
    });

    test("a requisition pulls stock to the requesting location and a transfer cannot name one location twice", async () => {
      if (!handlerReady) return;
      await received(supplier, main, [line("q1", 8, "1")]);

      const requisition = await draft({
        mode: "requisition",
        locationId: annex,
        sourceLocationId: main,
        lines: [line("q1", 3)]
      });
      await submit(requisition.id);
      expect((await finalise(requisition.id)).status).toBe(201);
      expect(await onHand(annex, "q1")).toBe("3");
      expect(requisition.documentNo).toMatch(/^REQ-/);

      const same = await call(createDocument, {
        method: "POST",
        path: "/api/v1/procurement/documents",
        body: {
          mode: "transfer",
          locationId: main,
          sourceLocationId: main,
          lines: [line("q1", 1)]
        }
      });
      expect(same.status).toBe(400);
    });

    test("a transfer refused for insufficient stock posts neither leg", async () => {
      if (!handlerReady) return;
      await received(supplier, main, [line("u1", 1, "1")]);
      const doc = await draft({
        mode: "transfer",
        locationId: annex,
        sourceLocationId: main,
        lines: [line("u1", 5)]
      });
      await submit(doc.id);

      expect((await finalise(doc.id)).status).toBe(409);
      expect(await onHand(main, "u1")).toBe("1");
      expect(await onHand(annex, "u1")).toBe("none");
    });

    test("concurrent transfers out of one location never oversell it", async () => {
      if (!handlerReady) return;
      await received(supplier, main, [line("v1", 5, "1")]);
      const docs: Doc[] = [];

      for (let index = 0; index < 5; index += 1) {
        const doc = await draft({
          mode: "transfer",
          locationId: annex,
          sourceLocationId: main,
          lines: [line("v1", 2)]
        });
        await submit(doc.id);
        docs.push(doc);
      }

      const results = await Promise.all(docs.map((doc) => finalise(doc.id)));

      // 5 units, 2 per transfer: exactly two can succeed.
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await onHand(main, "v1")).toBe("1");
      expect(await onHand(annex, "v1")).toBe("4");
    });
  });

  describe("reversal", () => {
    test("a receipt is reversed by compensating movements; the originals are untouched and a retry replays", async () => {
      if (!handlerReady) return;
      const doc = await received(supplier, main, [line("rv1", 6, "1")]);

      const first = await reverse(doc.id);
      expect(first.status).toBe(201);
      expect(first.body.data!.document.status).toBe("reversed");
      expect(await onHand(main, "rv1")).toBe("0");

      const rows = (await admin()`
        SELECT source_type, operation, quantity_delta::text AS delta
        FROM awcms_inventory_movements
        WHERE tenant_id = ${env.tenantId} AND source_id = ${doc.id}
        ORDER BY created_at, id
      `) as { source_type: string; operation: string; delta: string }[];
      expect(rows.map((row) => row.source_type)).toEqual([
        "procurement_receipt",
        "procurement_receipt_reversal"
      ]);
      expect(rows.map((row) => row.operation)).toEqual([
        "receive",
        "supplier_return"
      ]);

      const again = await reverse(doc.id);
      expect(again.status).toBe(200);
      expect(again.body.data!.replayed).toBe(true);
      expect(await procurementMovementCount()).toBe(2);

      const recon = await call<{ reconciled: boolean; linesChecked: number }>(
        reconcile,
        { path: "/api/v1/procurement/documents/reconciliation" }
      );
      expect(recon.body.data).toMatchObject({
        reconciled: true,
        linesChecked: 2
      });
      // A reversed document cannot be finalised or reversed anew.
      expect((await finalise(doc.id)).status).toBe(409);
    });

    test("a reversal the ledger refuses (the stock was sold) posts nothing and leaves the document finalised", async () => {
      if (!handlerReady) return;
      const doc = await received(supplier, main, [line("rv2", 5, "1")]);
      const sale = await call(postInventoryMovement, {
        method: "POST",
        path: "/api/v1/inventory/movements",
        body: {
          locationId: main,
          itemType: ITEM_TYPE,
          itemRef: "rv2",
          movementType: "sale",
          quantity: 4,
          source: { type: "pos_order", id: "order-rv2", line: "1" }
        }
      });
      expect(sale.status).toBe(201);
      const before = await procurementMovementCount();

      const refused = await reverse(doc.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("INSUFFICIENT_STOCK");
      expect(await procurementMovementCount()).toBe(before);
      expect(await onHand(main, "rv2")).toBe("1");
      expect((await getDoc(doc.id)).status).toBe("finalised");
    });

    test("reversing a draft or submitted document is refused (cancel it instead)", async () => {
      if (!handlerReady) return;
      const doc = await draft(
        await receiveBody(supplier, main, [line("rv3", 1, "1")])
      );

      const refused = await reverse(doc.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("INVALID_STATE");
    });

    test("a supplier return and a transfer reverse in the opposite direction", async () => {
      if (!handlerReady) return;
      await received(supplier, main, [line("rv4", 10, "1")]);
      const ret = await draft({
        mode: "supplier_return",
        supplierId: supplier,
        locationId: main,
        lines: [line("rv4", 3, "1")]
      });
      await submit(ret.id);
      await finalise(ret.id);
      expect(await onHand(main, "rv4")).toBe("7");
      expect((await reverse(ret.id)).status).toBe(201);
      expect(await onHand(main, "rv4")).toBe("10");

      const transfer = await draft({
        mode: "transfer",
        locationId: annex,
        sourceLocationId: main,
        lines: [line("rv4", 4)]
      });
      await submit(transfer.id);
      await finalise(transfer.id);
      expect((await reverse(transfer.id)).status).toBe(201);
      expect(await onHand(main, "rv4")).toBe("10");
      expect(await onHand(annex, "rv4")).toBe("0");
    });
  });

  // --- sensitive data ---------------------------------------------------------------

  describe("sensitive supplier data", () => {
    test("identifiers are masked in every response, classified, deduplicated and kept out of the audit trail", async () => {
      if (!handlerReady) return;
      const identifierId = await addTaxId(supplier);
      await call(addIdentifier, {
        method: "POST",
        path: `/api/v1/procurement/suppliers/${supplier}/identifiers`,
        params: { id: supplier },
        body: { type: "payment_ref", value: FAKE_PAYMENT_REF, label: "bank" }
      });

      const listed = await call<
        {
          id: string;
          maskedValue: string;
          classification: string;
          type: string;
        }[]
      >(listIdentifiers, {
        path: `/api/v1/procurement/suppliers/${supplier}/identifiers`,
        params: { id: supplier }
      });
      expect(listed.status).toBe(200);
      const tax = listed.body.data!.find((row) => row.id === identifierId)!;
      expect(tax.maskedValue).toBe("****************.000");
      expect(tax.maskedValue).not.toContain("000.000.0");
      expect(tax.classification).toBe("sensitive");
      expect(
        listed.body.data!.find((row) => row.type === "payment_ref")!
          .classification
      ).toBe("confidential");

      const supplierRead = await call(getSupplier, {
        path: `/api/v1/procurement/suppliers/${supplier}`,
        params: { id: supplier }
      });
      const supplierList = await call(listSuppliers, {
        path: "/api/v1/procurement/suppliers"
      });

      for (const body of [listed.body, supplierRead.body, supplierList.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toContain(FAKE_TAX_ID);
        expect(text).not.toContain(FAKE_PAYMENT_REF);
      }

      const duplicate = await call(addIdentifier, {
        method: "POST",
        path: `/api/v1/procurement/suppliers/${supplier}/identifiers`,
        params: { id: supplier },
        body: { type: "tax_id", value: FAKE_TAX_ID }
      });
      // IDEMPOTENT (audit M1/B1): a duplicate answers the same uniform
      // acknowledgement as a fresh add — no id, no createdAt — so it is no
      // equality oracle. No second row, no second audit row.
      expect(duplicate.status).toBe(201);
      expect(Object.keys(duplicate.body.data as object).sort()).toEqual([
        "classification",
        "label",
        "maskedValue",
        "type"
      ]);
      expect((duplicate.body.data as { maskedValue: string }).maskedValue).toBe(
        "****************.000"
      );
      const taxRows = (await admin()`
        SELECT count(*)::int AS n FROM awcms_procurement_supplier_identifiers
        WHERE tenant_id = ${env.tenantId} AND supplier_id = ${supplier}
          AND identifier_type = 'tax_id'
      `) as { n: number }[];
      expect(taxRows[0]!.n).toBe(1);
      const addedAudits = (await admin()`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND module_key = 'procurement'
          AND action = 'procurement.supplier.identifier.added'
          AND resource_id = ${supplier}
      `) as { n: number }[];
      expect(addedAudits[0]!.n).toBe(2);

      // Neither the value, nor its hash, nor its mask is in any audit row.
      const hash = (await admin()`
        SELECT value_hash FROM awcms_procurement_supplier_identifiers
        WHERE tenant_id = ${env.tenantId} AND id = ${identifierId}
      `) as { value_hash: string }[];
      const audit = JSON.stringify(
        await admin()`
          SELECT action, message, attributes FROM awcms_audit_events
          WHERE tenant_id = ${env.tenantId} AND module_key = 'procurement'
        `
      );
      expect(audit).toContain("procurement.supplier.identifier.added");
      expect(audit).not.toContain(FAKE_TAX_ID);
      expect(audit).not.toContain(FAKE_PAYMENT_REF);
      expect(audit).not.toContain(hash[0]!.value_hash);
      expect(audit).not.toContain(tax.maskedValue);
    });

    test("the reveal returns the value, is no-store, audits the disclosure without the value, and a removed identifier is gone", async () => {
      if (!handlerReady) return;
      const identifierId = await addTaxId(supplier);
      const revealed = await call<{ value: string; classification: string }>(
        revealIdentifier,
        {
          method: "POST",
          path: `/api/v1/procurement/suppliers/${supplier}/identifiers/${identifierId}/reveal`,
          params: { id: supplier, identifierId }
        }
      );

      expect(revealed.status).toBe(200);
      expect(revealed.body.data!.value).toBe(FAKE_TAX_ID);
      expect(revealed.response.headers.get("cache-control")).toBe("no-store");

      const rows = (await admin()`
        SELECT severity, attributes, correlation_id FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'procurement.supplier.identifier.revealed'
      `) as { severity: string; attributes: unknown; correlation_id: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.severity).toBe("warning");
      expect(rows[0]!.correlation_id).toBe("corr-api-888");
      expect(JSON.stringify(rows[0]!.attributes)).not.toContain(FAKE_TAX_ID);

      const removed = await call(removeIdentifier, {
        method: "DELETE",
        path: `/api/v1/procurement/suppliers/${supplier}/identifiers/${identifierId}`,
        params: { id: supplier, identifierId }
      });
      expect(removed.status).toBe(200);
      expect(
        (
          await call(revealIdentifier, {
            method: "POST",
            path: `/api/v1/procurement/suppliers/${supplier}/identifiers/${identifierId}/reveal`,
            params: { id: supplier, identifierId }
          })
        ).status
      ).toBe(404);
    });

    test("a supplier soft-delete is refused with open documents, restorable, and its identity link is a validated reference", async () => {
      if (!handlerReady) return;
      const other = await newSupplier("GONE");
      const missingProfile = await call(createSupplier, {
        method: "POST",
        path: "/api/v1/procurement/suppliers",
        body: {
          vendorCode: "PROFILELESS",
          name: "x",
          profileId: crypto.randomUUID()
        }
      });
      expect(missingProfile.status).toBe(422);

      expect(
        (
          await call(deleteSupplier, {
            method: "DELETE",
            path: `/api/v1/procurement/suppliers/${other}`,
            params: { id: other },
            body: { reason: "no longer trading" }
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(getSupplier, {
            path: `/api/v1/procurement/suppliers/${other}`,
            params: { id: other }
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(restoreSupplier, {
            method: "POST",
            path: `/api/v1/procurement/suppliers/${other}/restore`,
            params: { id: other }
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(createSupplier, {
            method: "POST",
            path: "/api/v1/procurement/suppliers",
            body: { vendorCode: "gone", name: "dup" }
          })
        ).status
      ).toBe(409);
    });

    test("a soft-deleted supplier's identifiers are unreachable (list, add, reveal, remove) until restore, and the supplier report still lists it flagged deleted", async () => {
      if (!handlerReady) return;
      const gone = await newSupplier("HIDDEN");
      const identifierId = await addTaxId(gone);
      const base = `/api/v1/procurement/suppliers/${gone}/identifiers`;

      expect(
        (
          await call(deleteSupplier, {
            method: "DELETE",
            path: `/api/v1/procurement/suppliers/${gone}`,
            params: { id: gone },
            body: { reason: "left" }
          })
        ).status
      ).toBe(200);

      expect(
        (await call(listIdentifiers, { path: base, params: { id: gone } }))
          .status
      ).toBe(404);
      expect(
        (
          await call(revealIdentifier, {
            method: "POST",
            path: `${base}/${identifierId}/reveal`,
            params: { id: gone, identifierId }
          })
        ).status
      ).toBe(404);
      expect(
        (
          await call(removeIdentifier, {
            method: "DELETE",
            path: `${base}/${identifierId}`,
            params: { id: gone, identifierId }
          })
        ).status
      ).toBe(404);

      const report = await call<{
        suppliers: { vendorCode: string; deleted: boolean }[];
      }>(reportSuppliers, { path: "/api/v1/procurement/reports/suppliers" });
      expect(
        report.body.data!.suppliers.find((row) => row.vendorCode === "HIDDEN")
      ).toMatchObject({ deleted: true });

      await call(restoreSupplier, {
        method: "POST",
        path: `/api/v1/procurement/suppliers/${gone}/restore`,
        params: { id: gone }
      });
      expect(
        (await call(listIdentifiers, { path: base, params: { id: gone } }))
          .status
      ).toBe(200);
    });
  });

  // --- approval ---------------------------------------------------------------------

  describe("security audit hardening (Issue #888)", () => {
    test("an update-only caller (no read, no reveal) cannot tell a fresh identifier add from a duplicate (audit B1)", async () => {
      if (!handlerReady) return;
      const updateOnly = await seedUser(env.tenantId, "update-only", [
        "procurement.suppliers.update"
      ]);
      const add = (value: string) =>
        call<Record<string, unknown>>(addIdentifier, {
          method: "POST",
          path: `/api/v1/procurement/suppliers/${supplier}/identifiers`,
          params: { id: supplier },
          token: updateOnly.token,
          body: { type: "business_id", value, label: "reg" }
        });

      const fresh = await add("REG-UPDATE-ONLY-0001");
      const duplicate = await add("REG-UPDATE-ONLY-0001");

      expect(fresh.status).toBe(201);
      expect(duplicate.status).toBe(fresh.status);
      expect(Object.keys(duplicate.body.data!).sort()).toEqual(
        Object.keys(fresh.body.data!).sort()
      );
      expect(duplicate.body.data).toEqual(fresh.body.data);
      for (const key of ["id", "createdAt", "supplierId"]) {
        expect(key in fresh.body.data!).toBe(false);
      }
      // ... and it really was a no-op the second time.
      const rows = (await admin()`
        SELECT count(*)::int AS n FROM awcms_procurement_supplier_identifiers
        WHERE tenant_id = ${env.tenantId} AND supplier_id = ${supplier}
          AND identifier_type = 'business_id'
      `) as { n: number }[];
      expect(rows[0]!.n).toBe(1);
    });

    test("a second user presenting the first user's Idempotency-Key does not get the first user's response", async () => {
      if (!handlerReady) return;
      const other = await seedUser(
        env.tenantId,
        "second-actor",
        ALL_PROCUREMENT_PERMISSIONS
      );
      const doc = await draft(
        await receiveBody(supplier, main, [line("ia-1", 1, "1")])
      );
      const key = nextKey();

      const first = await call<Doc>(submitDocument, {
        method: "POST",
        path: `/api/v1/procurement/documents/${doc.id}/submit`,
        params: { id: doc.id },
        idempotencyKey: key
      });
      expect(first.status).toBe(200);

      // The owner's own retry replays its stored response ...
      const retry = await call<Doc>(submitDocument, {
        method: "POST",
        path: `/api/v1/procurement/documents/${doc.id}/submit`,
        params: { id: doc.id },
        idempotencyKey: key
      });
      expect(retry.status).toBe(200);

      // ... a DIFFERENT user with the same key is a conflict, not a replay.
      const stolen = await call<Doc>(submitDocument, {
        method: "POST",
        path: `/api/v1/procurement/documents/${doc.id}/submit`,
        params: { id: doc.id },
        token: other.token,
        idempotencyKey: key
      });
      expect(stolen.status).toBe(409);
      expect(stolen.body.error!.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(JSON.stringify(stolen.body)).not.toContain(doc.documentNo);
    });

    test("includeDeleted=true needs suppliers.restore on top of suppliers.read", async () => {
      if (!handlerReady) return;
      const gone = await newSupplier("DELETED-ONE");
      expect(
        (
          await call(deleteSupplier, {
            method: "DELETE",
            path: `/api/v1/procurement/suppliers/${gone}`,
            params: { id: gone },
            body: { reason: "closed" }
          })
        ).status
      ).toBe(200);
      const reader = await seedUser(env.tenantId, "reader-only", [
        "procurement.suppliers.read"
      ]);
      const restorer = await seedUser(env.tenantId, "reader-restorer", [
        "procurement.suppliers.read",
        "procurement.suppliers.restore"
      ]);
      const list = (token: string, includeDeleted: boolean) =>
        call<{ suppliers: { id: string }[] }>(listSuppliers, {
          path: "/api/v1/procurement/suppliers",
          token,
          query: includeDeleted ? "includeDeleted=true" : undefined
        });
      const ids = (r: Awaited<ReturnType<typeof list>>) =>
        (r.body.data?.suppliers ?? []).map((item) => item.id);

      // Without the flag a reader lists live suppliers only.
      const plain = await list(reader.token, false);
      expect(plain.status).toBe(200);
      expect(ids(plain)).not.toContain(gone);

      const denied = await list(reader.token, true);
      expect(denied.status).toBe(403);
      expect(JSON.stringify(denied.body)).not.toContain(gone);

      const allowed = await list(restorer.token, true);
      expect(allowed.status).toBe(200);
      expect(ids(allowed)).toContain(gone);
      expect(ids(await list(env.token, true))).toContain(gone);
    });
  });

  describe("optional threshold approval (workflow_approval)", () => {
    const FACTS = [
      { key: "mode", type: "string" },
      { key: "totalCost", type: "number" },
      { key: "currencyCode", type: "string" }
    ];

    async function publish(graph: unknown): Promise<void> {
      await admin()`
        INSERT INTO awcms_workflow_definitions
          (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
        VALUES (${env.tenantId}, 'procurement.document_approval', 'Procurement approval',
                1, 'active', ${graph}::jsonb, ${FACTS}::jsonb)
      `;
    }

    async function setThreshold(value: number | null): Promise<void> {
      const response = await call(putPolicy, {
        method: "PUT",
        path: "/api/v1/procurement/policy",
        body: { approvalThreshold: value }
      });
      expect(response.status).toBe(200);
    }

    test("no threshold: nothing needs approval; the policy reads null", async () => {
      if (!handlerReady) return;
      const policy = await call<{ approvalThreshold: string | null }>(
        getPolicy,
        { path: "/api/v1/procurement/policy" }
      );
      expect(policy.body.data!.approvalThreshold).toBeNull();

      const doc = await received(supplier, main, [line("ap0", 100, "100")]);
      expect(doc.approvalStatus).toBe("not_required");
    });

    test("a document over the threshold is REFUSED at submit when no workflow is published (fail closed)", async () => {
      if (!handlerReady) return;
      await setThreshold(100);
      const doc = await draft(
        await receiveBody(supplier, main, [line("ap1", 10, "15")])
      );

      const refused = await submit(doc.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("APPROVAL_WORKFLOW_NOT_CONFIGURED");
      expect((await getDoc(doc.id)).status).toBe("draft");
    });

    test("under the threshold needs no approval; over it waits for the workflow's verdict and finalise is blocked until approved", async () => {
      if (!handlerReady) return;
      await setThreshold(100);
      await publish({
        startNodeId: "approval",
        nodes: [
          {
            id: "approval",
            type: "approval",
            name: "Approval",
            assigneeTenantUserIds: [env.ownerTenantUserId],
            quorumRule: "any",
            onApprove: "end_approved",
            onReject: "end_rejected"
          },
          { id: "end_approved", type: "end", outcome: "approved" },
          { id: "end_rejected", type: "end", outcome: "rejected" }
        ]
      });

      const small = await draft(
        await receiveBody(supplier, main, [line("ap2", 1, "50")])
      );
      expect((await submit(small.id)).body.data!.approvalStatus).toBe(
        "not_required"
      );
      expect((await finalise(small.id)).status).toBe(201);

      const big = await draft(
        await receiveBody(supplier, main, [line("ap3", 10, "15")])
      );
      const submitted = await submit(big.id);
      expect(submitted.status).toBe(200);
      expect(submitted.body.data!.approvalStatus).toBe("pending");

      const blocked = await finalise(big.id);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error!.code).toBe("APPROVAL_PENDING");
      expect(await onHand(main, "ap3")).toBe("none");

      const instance = (await getDoc(big.id)).approvalInstanceId;
      await admin()`
        UPDATE awcms_workflow_instances SET status = 'approved'
        WHERE tenant_id = ${env.tenantId} AND id = ${instance}
      `;
      expect((await finalise(big.id)).status).toBe(201);
      expect(await onHand(main, "ap3")).toBe("10");
    });

    test("a rejected approval blocks finalise for good (cancel instead), and cancelling withdraws a pending request", async () => {
      if (!handlerReady) return;
      await setThreshold(0);
      await publish({
        startNodeId: "approval",
        nodes: [
          {
            id: "approval",
            type: "approval",
            name: "Approval",
            assigneeTenantUserIds: [env.ownerTenantUserId],
            quorumRule: "any",
            onApprove: "end_approved",
            onReject: "end_rejected"
          },
          { id: "end_approved", type: "end", outcome: "approved" },
          { id: "end_rejected", type: "end", outcome: "rejected" }
        ]
      });
      const doc = await draft(
        await receiveBody(supplier, main, [line("ap4", 1, "1")])
      );
      await submit(doc.id);
      const instance = (await getDoc(doc.id)).approvalInstanceId;
      await admin()`
        UPDATE awcms_workflow_instances SET status = 'rejected'
        WHERE tenant_id = ${env.tenantId} AND id = ${instance}
      `;

      const refused = await finalise(doc.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("APPROVAL_REJECTED");

      const pending = await draft(
        await receiveBody(supplier, main, [line("ap5", 1, "1")])
      );
      await submit(pending.id);
      const pendingInstance = (await getDoc(pending.id)).approvalInstanceId;
      await call(cancelDocument, {
        method: "POST",
        path: `/api/v1/procurement/documents/${pending.id}/cancel`,
        params: { id: pending.id },
        body: { reason: "withdrawn" }
      });
      const rows = (await admin()`
        SELECT status FROM awcms_workflow_instances
        WHERE tenant_id = ${env.tenantId} AND id = ${pendingInstance}
      `) as { status: string }[];
      expect(rows[0]!.status).toBe("cancelled");
    });
  });

  // --- reporting ----------------------------------------------------------------------

  test("the live reports and the audit trail agree with what was finalised", async () => {
    if (!handlerReady) return;
    await received(supplier, main, [line("rp1", 2, "10")]);
    const ret = await draft({
      mode: "supplier_return",
      supplierId: supplier,
      locationId: main,
      lines: [line("rp1", 1, "10")]
    });
    await submit(ret.id);
    await finalise(ret.id);

    const receiving = await call<
      { mode: string; status: string; documents: number; totalCost: string }[]
    >(reportReceiving, { path: "/api/v1/procurement/reports/receiving" });
    expect(receiving.body.data).toEqual([
      { mode: "receive", status: "finalised", documents: 1, totalCost: "20" },
      {
        mode: "supplier_return",
        status: "finalised",
        documents: 1,
        totalCost: "10"
      }
    ]);

    const suppliers = await call<{
      suppliers: {
        vendorCode: string;
        receiptsFinalised: number;
        supplierReturnsFinalised: number;
        receivedCost: string;
        returnedCost: string;
      }[];
    }>(reportSuppliers, { path: "/api/v1/procurement/reports/suppliers" });
    expect(suppliers.body.data!.suppliers[0]).toMatchObject({
      vendorCode: "ACME",
      receiptsFinalised: 1,
      supplierReturnsFinalised: 1,
      receivedCost: "20",
      returnedCost: "10"
    });

    const audit = (await admin()`
      SELECT action, severity, correlation_id FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND module_key = 'procurement'
        AND action = 'procurement.document.finalised'
    `) as { action: string; severity: string; correlation_id: string }[];
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.correlation_id === "corr-api-888")).toBe(
      true
    );
  });

  test("a malformed request is a 400 before any database work, and the list cursor is validated", async () => {
    if (!handlerReady) return;

    expect(
      (
        await call(createDocument, {
          method: "POST",
          path: "/api/v1/procurement/documents",
          idempotencyKey: null,
          body: {}
        })
      ).status
    ).toBe(400);
    expect(
      (
        await call(listDocuments, {
          path: "/api/v1/procurement/documents",
          query: "cursor=not-a-cursor"
        })
      ).status
    ).toBe(400);
    expect(
      (
        await call(finaliseDocument, {
          method: "POST",
          path: "/api/v1/procurement/documents/not-a-uuid/finalise",
          params: { id: "not-a-uuid" }
        })
      ).status
    ).toBe(400);
    expect(
      (
        await call(createDocument, {
          method: "POST",
          path: "/api/v1/procurement/documents",
          body: await receiveBody(supplier, main, [line("bad", 0, "1")])
        })
      ).status
    ).toBe(400);
    expect(
      (
        await call(createDocument, {
          method: "POST",
          path: "/api/v1/procurement/documents",
          body: await receiveBody(supplier, main, [line("bad", 1)])
        })
      ).status
    ).toBe(400);
  });

  // inventory settings are referenced only so the import is used by the policy test
  test("the inventory negative-stock policy is a separate permission surface", async () => {
    if (!handlerReady) return;
    const noInventory = await seedUser(
      env.tenantId,
      "no-inventory-policy",
      ALL_PROCUREMENT_PERMISSIONS
    );

    expect(
      (
        await call(putInventoryPolicy, {
          method: "PUT",
          path: "/api/v1/inventory/policy",
          token: noInventory.token,
          body: { defaultNegativeStockPolicy: "allow" }
        })
      ).status
    ).toBe(403);
  });

  // --- helpers needing the suite's state -------------------------------------------

  async function getDoc(
    id: string
  ): Promise<Doc & { approvalInstanceId: string }> {
    const response = await call<Doc & { approvalInstanceId: string }>(
      getDocument,
      { path: `/api/v1/procurement/documents/${id}`, params: { id } }
    );

    return response.body.data!;
  }

  async function addTaxId(supplierId: string): Promise<string> {
    const response = await call(addIdentifier, {
      method: "POST",
      path: `/api/v1/procurement/suppliers/${supplierId}/identifiers`,
      params: { id: supplierId },
      body: { type: "tax_id", value: FAKE_TAX_ID }
    });
    expect(response.status).toBe(201);

    // The add answers a uniform acknowledgement WITHOUT an id (audit B1), so
    // the id is read from the row directly.
    const rows = (await admin()`
      SELECT id FROM awcms_procurement_supplier_identifiers
      WHERE tenant_id = ${env.tenantId} AND supplier_id = ${supplierId}
        AND identifier_type = 'tax_id'
    `) as { id: string }[];

    return rows[0]!.id;
  }

  async function revealAuditCount(): Promise<number> {
    return auditCount("procurement.supplier.identifier.revealed");
  }

  async function auditCount(action: string): Promise<number> {
    const rows = (await admin()`
      SELECT count(*)::int AS n FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND action = ${action}
    `) as { n: number }[];

    return rows[0]!.n;
  }

  async function domainEventCount(eventType: string): Promise<number> {
    const rows = (await admin()`
      SELECT count(*)::int AS n FROM awcms_domain_events
      WHERE tenant_id = ${env.tenantId} AND event_type = ${eventType}
    `) as { n: number }[];

    return rows[0]!.n;
  }
});
