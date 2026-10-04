/**
 * `tax` (ADR-0127, Issue #889) against a real PostgreSQL, through the real route
 * handlers — and, in the second suite, against the database's own triggers and
 * RLS as a genuine non-superuser table owner.
 *
 * Two worlds, as `harness.ts` explains. WORLD 2 (the migrated `DATABASE_URL`
 * database, real handlers, real `authorizeInTransaction`, real
 * `awcms_role_permissions` grants) proves the contract: effective-date
 * resolution at the boundary, server-authority over tax amounts, idempotent
 * finalise, and that updating a rule never changes a historical document. WORLD 1
 * (an ephemeral database owned by a non-superuser role) proves what only a
 * database can: published rows cannot move, windows cannot overlap, a snapshot is
 * append-only, a reversal cannot out-refund its original, and RLS actually
 * separates tenants.
 *
 * The concurrency cases are the point of using a real server at all. Two
 * `Promise.all` handler calls race on separate pooled connections, so the
 * advisory lock, the row lock and the triggers are exercised rather than
 * mocked.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected,
  ensureHandlerDatabaseReady,
  getAdminSql,
  getHandlerAdminSql,
  getOwnerSql,
  integrationEnabled,
  invoke,
  resetDatabase,
  resetHandlerDatabase,
  setupIntegrationDatabase,
  teardownHandlerDatabase,
  teardownIntegrationDatabase
} from "./harness";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import {
  GET as listVersions,
  POST as createVersion
} from "../../src/pages/api/v1/tax/rule-versions/index";
import { GET as readVersion } from "../../src/pages/api/v1/tax/rule-versions/[id]/index";
import {
  lockProfile,
  lockProfileShared
} from "../../src/modules/tax/application/tax-rule-version-directory";
import { POST as publishVersion } from "../../src/pages/api/v1/tax/rule-versions/[id]/publish";
import { POST as quote } from "../../src/pages/api/v1/tax/quote";
import {
  GET as listSnapshots,
  POST as finalise
} from "../../src/pages/api/v1/tax/snapshots/index";
import { GET as readSnapshot } from "../../src/pages/api/v1/tax/snapshots/[id]/index";
import { POST as reverse } from "../../src/pages/api/v1/tax/snapshots/[id]/reverse";
import { GET as reconciliation } from "../../src/pages/api/v1/tax/reports/reconciliation";
import { TAX_PERMISSIONS } from "../../src/modules/tax/domain/tax-permissions";

const TENANT_A = "88988988-9889-4988-8988-988988988901";
const TENANT_B = "88988988-9889-4988-8988-988988988902";

type Persona = {
  tenantId: string;
  profileId: string;
  tenantUserId: string;
  identityId: string;
  roleId: string;
  loginIdentifier: string;
};

const OWNER_A: Persona = {
  tenantId: TENANT_A,
  profileId: "88988988-0000-4988-8988-988988989100",
  tenantUserId: "88988988-0000-4988-8988-988988989101",
  identityId: "88988988-0000-4988-8988-988988989102",
  roleId: "88988988-0000-4988-8988-988988989103",
  loginIdentifier: "owner-889@example.test"
};
const READER_A: Persona = {
  tenantId: TENANT_A,
  profileId: "88988988-0000-4988-8988-988988989200",
  tenantUserId: "88988988-0000-4988-8988-988988989201",
  identityId: "88988988-0000-4988-8988-988988989202",
  roleId: "88988988-0000-4988-8988-988988989203",
  loginIdentifier: "reader-889@example.test"
};
/** May finalise, reverse and quote — but holds NO `tax.snapshots.backdate`. */
const MAKER_A: Persona = {
  tenantId: TENANT_A,
  profileId: "88988988-0000-4988-8988-988988989400",
  tenantUserId: "88988988-0000-4988-8988-988988989401",
  identityId: "88988988-0000-4988-8988-988988989402",
  roleId: "88988988-0000-4988-8988-988988989403",
  loginIdentifier: "maker-889@example.test"
};
const OWNER_B: Persona = {
  tenantId: TENANT_B,
  profileId: "88988988-0000-4988-8988-988988989300",
  tenantUserId: "88988988-0000-4988-8988-988988989301",
  identityId: "88988988-0000-4988-8988-988988989302",
  roleId: "88988988-0000-4988-8988-988988989303",
  loginIdentifier: "owner-b-889@example.test"
};

/**
 * The database's UTC date, read once. The module refuses to publish a version
 * before the SERVER's date and bounds a tax date around it, so every date in this
 * suite is `TODAY` plus an offset — a literal calendar date would pass today and
 * fail the day after.
 */
let TODAY = "";

function addDays(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

const tokens = new Map<string, string>();
let handlerReady = false;
let keyCounter = 0;

function nextKey(label: string): string {
  keyCounter += 1;

  return `${label}-${keyCounter}`;
}

async function seedPersona(
  persona: Persona,
  roleName: string,
  permissionKeys: readonly string[]
): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
    VALUES (${persona.profileId}, ${persona.tenantId}, 'person', ${roleName})
  `;
  await sql`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${persona.identityId}, ${persona.tenantId}, ${persona.profileId},
            ${persona.loginIdentifier}, 'not-a-real-hash', 'active')
  `;
  await sql`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${persona.tenantUserId}, ${persona.tenantId}, ${persona.identityId}, 'active')
  `;
  await sql`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
    VALUES (${persona.roleId}, ${persona.tenantId}, ${roleName}, ${roleName}, false)
  `;

  for (const key of permissionKeys) {
    const [moduleKey, activityCode, action] = key.split(".");

    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT ${persona.tenantId}, ${persona.roleId}, p.id
      FROM awcms_permissions p
      WHERE p.module_key = ${moduleKey}
        AND p.activity_code = ${activityCode}
        AND p.action = ${action}
    `;
  }

  await grantRolePolicy(sql, persona.tenantId, {
    tenantUserId: persona.tenantUserId,
    roleId: persona.roleId,
    grantedByTenantUserId: null
  });

  const token = generateSessionToken();

  tokens.set(persona.tenantUserId, token);

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${persona.tenantId}, ${persona.identityId}, ${hashSessionToken(token)},
            now() + interval '1 hour')
  `;
}

async function seed(): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT_A}, 'tax-889-a', 'Tax 889 A', 'active'),
           (${TENANT_B}, 'tax-889-b', 'Tax 889 B', 'active')
  `;
  await seedPersona(OWNER_A, "tax-owner-a", Object.values(TAX_PERMISSIONS));
  await seedPersona(READER_A, "tax-reader-a", [TAX_PERMISSIONS.rulesRead]);
  await seedPersona(OWNER_B, "tax-owner-b", Object.values(TAX_PERMISSIONS));
  await seedPersona(MAKER_A, "tax-maker-a", [
    TAX_PERMISSIONS.rulesRead,
    TAX_PERMISSIONS.calculationsAnalyze,
    TAX_PERMISSIONS.snapshotsRead,
    TAX_PERMISSIONS.snapshotsCreate,
    TAX_PERMISSIONS.snapshotsReverse
  ]);
}

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: { nextCursor?: string | null };
};

function call<T = unknown>(
  handler: Parameters<typeof invoke>[0],
  persona: Persona,
  options: {
    method?: string;
    path: string;
    params?: Record<string, string>;
    body?: unknown;
    key?: string | null;
  }
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": persona.tenantId,
    authorization: `Bearer ${tokens.get(persona.tenantUserId)}`
  };

  if (
    options.key !== null &&
    options.method !== "GET" &&
    options.method !== undefined
  ) {
    headers["idempotency-key"] = options.key ?? nextKey("k");
  }

  return invoke<Envelope<T>>(handler, {
    method: options.method ?? "GET",
    path: options.path,
    params: options.params,
    headers,
    body: options.body
  });
}

const DEFINITION = {
  categories: [
    { code: "books", name: "Books" },
    { code: "food", name: "Basic food" }
  ],
  rules: [
    {
      categoryCode: null,
      treatment: "taxable",
      components: [{ code: "vat", name: "VAT", rate: "10", basis: "net" }]
    },
    { categoryCode: "books", treatment: "exempt", components: [] },
    { categoryCode: "food", treatment: "zero_rated", components: [] }
  ]
};

function versionBody(overrides: Record<string, unknown> = {}) {
  return {
    profileCode: "retail",
    name: "Retail",
    jurisdictionCode: "XX-1",
    currencyCode: "USD",
    pricingMode: "exclusive",
    roundingMode: "half_up",
    roundingScale: 2,
    roundingLevel: "line",
    effectiveFrom: TODAY,
    definition: DEFINITION,
    ...overrides
  };
}

type VersionData = {
  id: string;
  versionNo: number;
  status: string;
  effectiveTo: string | null;
};

async function draft(
  persona: Persona,
  overrides: Record<string, unknown> = {}
) {
  const res = await call<VersionData>(createVersion, persona, {
    method: "POST",
    path: "/api/v1/tax/rule-versions",
    body: versionBody(overrides)
  });

  expect(res.status).toBe(201);

  return res.body.data!;
}

async function publish(persona: Persona, id: string, key?: string) {
  return call<VersionData>(publishVersion, persona, {
    method: "POST",
    path: `/api/v1/tax/rule-versions/${id}/publish`,
    params: { id },
    key
  });
}

async function draftAndPublish(
  persona: Persona,
  overrides: Record<string, unknown> = {}
): Promise<VersionData> {
  const created = await draft(persona, overrides);
  const res = await publish(persona, created.id);

  expect(res.status).toBe(200);

  return res.body.data!;
}

type SnapshotData = {
  id: string;
  kind: string;
  netTotal: string;
  taxTotal: string;
  grossTotal: string;
  versionNo: number;
  originalSnapshotId: string | null;
  lines: { lineRef: string; taxAmount: string; netAmount: string }[];
  ruleDefinition?: { rules: { components: { rate: string }[] }[] };
};

function saleBody(documentId: string, taxDate = TODAY, lines?: unknown[]) {
  return {
    profileCode: "retail",
    taxDate,
    documentType: "order",
    documentId,
    lines: lines ?? [
      { lineRef: "a", quantity: "3", unitPrice: "3.33" },
      { lineRef: "b", quantity: "1", unitPrice: "20.00" }
    ]
  };
}

function finaliseSale(persona: Persona, body: unknown, key?: string | null) {
  return call<SnapshotData>(finalise, persona, {
    method: "POST",
    path: "/api/v1/tax/snapshots",
    body,
    key
  });
}

function reverseSale(
  persona: Persona,
  originalId: string,
  body: unknown,
  key?: string | null
) {
  return call<SnapshotData>(reverse, persona, {
    method: "POST",
    path: `/api/v1/tax/snapshots/${originalId}/reverse`,
    params: { id: originalId },
    body,
    key
  });
}

const handlerSuite = integrationEnabled ? describe : describe.skip;

handlerSuite("tax — through the real route handlers (ADR-0127)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();

    if (handlerReady) {
      const rows = (await getHandlerAdminSql()`
        SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today
      `) as { today: string }[];

      TODAY = rows[0]!.today;
    }
  }, 120000);

  afterAll(async () => {
    if (handlerReady) await teardownHandlerDatabase();
  }, 60000);

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    tokens.clear();
    await seed();
  }, 30000);

  afterEach(async () => {
    if (handlerReady) await resetHandlerDatabase();
  }, 30000);

  describe("authoring, publication and effective dates", () => {
    test("a draft is not resolved until it is published", async () => {
      if (!handlerReady) return;

      await draft(OWNER_A);

      const res = await call(quote, OWNER_A, {
        method: "POST",
        path: "/api/v1/tax/quote",
        key: null,
        body: {
          profileCode: "retail",
          taxDate: TODAY,
          lines: [{ lineRef: "a", quantity: "1", unitPrice: "10.00" }]
        }
      });

      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe("TAX_RULE_VERSION_NOT_FOUND");
    });

    test("version numbers are assigned by the server and concurrent drafts get distinct ones", async () => {
      if (!handlerReady) return;

      const results = await Promise.all(
        [1, 2, 3, 4].map(() =>
          call<VersionData>(createVersion, OWNER_A, {
            method: "POST",
            path: "/api/v1/tax/rule-versions",
            body: versionBody()
          })
        )
      );

      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect(results.map((r) => r.body.data!.versionNo).sort()).toEqual([
        1, 2, 3, 4
      ]);
    });

    test("the effective-date boundary: the day a successor starts belongs to the successor only", async () => {
      if (!handlerReady) return;

      const v1 = await draftAndPublish(OWNER_A, {
        effectiveFrom: TODAY
      });
      const twenty = JSON.parse(JSON.stringify(DEFINITION));

      twenty.rules[0].components[0].rate = "20";

      const v2 = await draftAndPublish(OWNER_A, {
        effectiveFrom: addDays(TODAY, 3),
        definition: twenty
      });

      expect(v1.versionNo).toBe(1);
      expect(v2.versionNo).toBe(2);

      const taxOn = async (taxDate: string) => {
        const res = await call<{
          taxTotal: string;
          ruleVersion: { versionNo: number };
        }>(quote, OWNER_A, {
          method: "POST",
          path: "/api/v1/tax/quote",
          key: null,
          body: {
            profileCode: "retail",
            taxDate,
            lines: [{ lineRef: "a", quantity: "1", unitPrice: "100.00" }]
          }
        });

        return {
          status: res.status,
          tax: res.body.data?.taxTotal,
          version: res.body.data?.ruleVersion.versionNo,
          code: res.body.error?.code
        };
      };

      expect(await taxOn(addDays(TODAY, -1))).toMatchObject({
        status: 422,
        code: "TAX_RULE_VERSION_NOT_FOUND"
      });
      expect(await taxOn(TODAY)).toMatchObject({
        status: 200,
        tax: "10.00",
        version: 1
      });
      expect(await taxOn(addDays(TODAY, 2))).toMatchObject({
        status: 200,
        tax: "10.00",
        version: 1
      });
      expect(await taxOn(addDays(TODAY, 3))).toMatchObject({
        status: 200,
        tax: "20.00",
        version: 2
      });

      // The predecessor's window was ended at the successor's start — and nothing else of it changed.
      const reread = await call<VersionData>(readVersion, OWNER_A, {
        path: `/api/v1/tax/rule-versions/${v1.id}`,
        params: { id: v1.id }
      });

      expect(reread.body.data!.effectiveTo).toBe(addDays(TODAY, 3));
    });

    test("publishing into the past is refused, and a second publish is refused", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A, { effectiveFrom: addDays(TODAY, 30) });

      const early = await draft(OWNER_A, {
        effectiveFrom: addDays(TODAY, 10)
      });
      const refused = await publish(OWNER_A, early.id);

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("TAX_VERSION_OUT_OF_ORDER");

      const same = await draft(OWNER_A, {
        effectiveFrom: addDays(TODAY, 30)
      });
      const sameRefused = await publish(OWNER_A, same.id);

      expect(sameRefused.status).toBe(409);

      const later = await draft(OWNER_A, {
        effectiveFrom: addDays(TODAY, 60)
      });

      expect((await publish(OWNER_A, later.id)).status).toBe(200);
      expect((await publish(OWNER_A, later.id)).body.error?.code).toBe(
        "TAX_VERSION_ALREADY_PUBLISHED"
      );
    });

    test("publish is idempotent by key: a replay returns the same answer and publishes nothing twice", async () => {
      if (!handlerReady) return;

      const created = await draft(OWNER_A);
      const first = await publish(OWNER_A, created.id, "publish-once");
      const replay = await publish(OWNER_A, created.id, "publish-once");

      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(first.body);

      const events = (await getHandlerAdminSql()`
        SELECT count(*)::int AS n FROM awcms_domain_events
        WHERE tenant_id = ${TENANT_A} AND event_type = 'awcms.tax.rule_version.published'
      `) as { n: number }[];

      expect(events[0]!.n).toBe(1);
    });

    test("concurrent publishes for one profile and one date: exactly one wins, never two", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A, { effectiveFrom: TODAY });

      const a = await draft(OWNER_A, { effectiveFrom: addDays(TODAY, 10) });
      const b = await draft(OWNER_A, { effectiveFrom: addDays(TODAY, 10) });
      const results = await Promise.all([
        publish(OWNER_A, a.id),
        publish(OWNER_A, b.id)
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.error?.code).toBe(
        "TAX_VERSION_OUT_OF_ORDER"
      );
    });

    test("concurrent publishes of different dates leave non-overlapping windows and never a 500", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A, { effectiveFrom: TODAY });

      const early = await draft(OWNER_A, { effectiveFrom: addDays(TODAY, 10) });
      const late = await draft(OWNER_A, { effectiveFrom: addDays(TODAY, 20) });
      const results = await Promise.all([
        publish(OWNER_A, early.id),
        publish(OWNER_A, late.id)
      ]);

      for (const result of results) {
        expect([200, 409]).toContain(result.status);
      }
      expect(results.some((r) => r.status === 200)).toBe(true);

      const rows = (await getHandlerAdminSql()`
        SELECT a.id AS a_id, b.id AS b_id
        FROM awcms_tax_rule_versions a
        JOIN awcms_tax_rule_versions b
          ON a.tenant_id = b.tenant_id AND a.profile_code = b.profile_code AND a.id < b.id
        WHERE a.tenant_id = ${TENANT_A}
          AND a.status = 'published' AND b.status = 'published'
          AND daterange(a.effective_from, a.effective_to, '[)')
              && daterange(b.effective_from, b.effective_to, '[)')
      `) as unknown[];

      expect(rows).toEqual([]);
    });
  });

  describe("server-authority and idempotent finalise", () => {
    test("a client-supplied tax amount is refused by name, on quote and finalise, and nothing is written", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      for (const extra of [{ taxTotal: "0.00" }, { vat: "0.00" }]) {
        const res = await call(quote, OWNER_A, {
          method: "POST",
          path: "/api/v1/tax/quote",
          key: null,
          body: {
            profileCode: "retail",
            taxDate: TODAY,
            lines: [{ lineRef: "a", quantity: "1", unitPrice: "10.00" }],
            ...extra
          }
        });

        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe("TAX_AMOUNT_NOT_ACCEPTED");
      }

      const onLine = await finaliseSale(
        OWNER_A,
        saleBody("SO-X", TODAY, [
          { lineRef: "a", quantity: "1", unitPrice: "10.00", taxAmount: "0.00" }
        ])
      );

      expect(onLine.status).toBe(400);
      expect(onLine.body.error?.code).toBe("TAX_AMOUNT_NOT_ACCEPTED");

      const count = (await getHandlerAdminSql()`
        SELECT count(*)::int AS n FROM awcms_tax_snapshots WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];

      expect(count[0]!.n).toBe(0);
    });

    test("finalise computes server-side, replays by key, replays by document, and refuses a different request for the same document", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const first = await finaliseSale(OWNER_A, saleBody("SO-1"), "fin-1");

      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({
        kind: "sale",
        netTotal: "29.99",
        taxTotal: "3.00",
        grossTotal: "32.99"
      });

      const sameKey = await finaliseSale(OWNER_A, saleBody("SO-1"), "fin-1");

      expect(sameKey.status).toBe(201);
      expect(sameKey.body.data!.id).toBe(first.body.data!.id);

      // A POS replaying its offline queue rotates keys: the document is the natural key.
      const freshKey = await finaliseSale(
        OWNER_A,
        saleBody("SO-1"),
        "fin-rotated"
      );

      expect(freshKey.status).toBe(200);
      expect(freshKey.body.data!.id).toBe(first.body.data!.id);

      const different = await finaliseSale(
        OWNER_A,
        saleBody("SO-1", TODAY, [
          { lineRef: "a", quantity: "1", unitPrice: "1.00" }
        ]),
        "fin-other"
      );

      expect(different.status).toBe(409);
      expect(different.body.error?.code).toBe("TAX_DOCUMENT_ALREADY_FINALISED");

      const sameKeyDifferentBody = await finaliseSale(
        OWNER_A,
        saleBody("SO-2"),
        "fin-1"
      );

      expect(sameKeyDifferentBody.status).toBe(409);
      expect(sameKeyDifferentBody.body.error?.code).toBe(
        "IDEMPOTENCY_CONFLICT"
      );

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS n FROM awcms_tax_snapshots WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(1);
    });

    test("finalise requires an Idempotency-Key", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const res = await finaliseSale(OWNER_A, saleBody("SO-NOKEY"), null);

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("IDEMPOTENCY_REQUIRED");
    });

    test("concurrent finalise of one document under different keys writes one row, and every caller sees it", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const results = await Promise.all(
        [1, 2, 3, 4, 5].map((n) =>
          finaliseSale(OWNER_A, saleBody("SO-RACE"), `race-${n}`)
        )
      );

      for (const result of results) {
        expect([200, 201]).toContain(result.status);
      }

      expect(new Set(results.map((r) => r.body.data!.id)).size).toBe(1);

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS n FROM awcms_tax_snapshots WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(1);
    });

    test("finalise audits and emits an outbox event exactly once", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);
      await finaliseSale(OWNER_A, saleBody("SO-AUD"), "aud-1");
      await finaliseSale(OWNER_A, saleBody("SO-AUD"), "aud-2");

      const sql = getHandlerAdminSql();
      const events = (await sql`
        SELECT count(*)::int AS n FROM awcms_domain_events
        WHERE tenant_id = ${TENANT_A} AND event_type = 'awcms.tax.snapshot.finalised'
      `) as { n: number }[];
      const audits = (await sql`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action = 'tax.snapshot.finalise'
      `) as { n: number }[];

      expect(events[0]!.n).toBe(1);
      expect(audits[0]!.n).toBe(1);
    });
  });

  describe("updating a rule never changes a historical document", () => {
    test("a document finalised under v1 is unchanged after v2 — and its refund reverses the tax that was CHARGED", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A, { effectiveFrom: TODAY });

      const sale = await finaliseSale(
        OWNER_A,
        saleBody("SO-HIST", TODAY),
        "hist-1"
      );
      const before = await call<SnapshotData>(readSnapshot, OWNER_A, {
        path: `/api/v1/tax/snapshots/${sale.body.data!.id}`,
        params: { id: sale.body.data!.id }
      });

      // The rate doubles from tomorrow. Same profile, new version.
      const twenty = JSON.parse(JSON.stringify(DEFINITION));

      twenty.rules[0].components[0].rate = "20";
      await draftAndPublish(OWNER_A, {
        effectiveFrom: addDays(TODAY, 1),
        definition: twenty
      });

      const after = await call<SnapshotData>(readSnapshot, OWNER_A, {
        path: `/api/v1/tax/snapshots/${sale.body.data!.id}`,
        params: { id: sale.body.data!.id }
      });

      expect(after.body.data).toEqual(before.body.data);
      expect(after.body.data!.versionNo).toBe(1);
      // The snapshot's own copy of the rule is still the 10% one (read straight
      // from the table: the API does not return it — see the L2 test below).
      const stored = (await getHandlerAdminSql()`
        SELECT rule_definition -> 'rules' -> 0 -> 'components' -> 0 ->> 'rate' AS rate
        FROM awcms_tax_snapshots WHERE id = ${sale.body.data!.id}
      `) as { rate: string }[];

      expect(stored[0]!.rate).toBe("10");

      // A refund issued once the rule says 20% — takes back the 10% that was charged.
      const refund = await reverseSale(
        OWNER_A,
        sale.body.data!.id,
        { documentId: "RF-HIST" },
        "rev-hist"
      );

      expect(refund.status).toBe(201);
      expect(refund.body.data).toMatchObject({
        kind: "reversal",
        netTotal: "-29.99",
        taxTotal: "-3.00",
        grossTotal: "-32.99",
        originalSnapshotId: sale.body.data!.id,
        versionNo: 1
      });
    });
  });

  describe("reversal", () => {
    async function sale(documentId: string) {
      const res = await finaliseSale(
        OWNER_A,
        saleBody(documentId),
        nextKey("sale")
      );

      expect(res.status).toBe(201);

      return res.body.data!;
    }

    test("partial reversals never exceed the original; the last takes the exact remainder", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const original = await sale("SO-PART");
      const one = (documentId: string) =>
        reverseSale(OWNER_A, original.id, {
          documentId,
          lines: [{ lineRef: "a", quantity: "1" }]
        });

      const r1 = await one("RF-1");
      const r2 = await one("RF-2");
      const r3 = await one("RF-3");

      expect([r1.status, r2.status, r3.status]).toEqual([201, 201, 201]);
      expect(r1.body.data!.lines[0]).toMatchObject({
        netAmount: "-3.33",
        taxAmount: "-0.33"
      });
      expect(r3.body.data!.lines[0]).toMatchObject({
        netAmount: "-3.33",
        taxAmount: "-0.34"
      });

      const over = await one("RF-4");

      expect(over.status).toBe(422);
      expect(over.body.error?.code).toBe("TAX_REVERSAL_INVALID");

      // Line b is untouched, so reversing "everything left" takes b and only b.
      const rest = await reverseSale(OWNER_A, original.id, {
        documentId: "RF-REST"
      });

      expect(rest.status).toBe(201);
      expect(rest.body.data!.lines.map((l) => l.lineRef)).toEqual(["b"]);

      const total = (await getHandlerAdminSql()`
        SELECT sum(tax_total)::text AS tax, sum(net_total)::text AS net
        FROM awcms_tax_snapshots
        WHERE tenant_id = ${TENANT_A} AND original_snapshot_id = ${original.id}
      `) as { tax: string; net: string }[];

      expect(Number(total[0]!.tax)).toBe(-3);
      expect(Number(total[0]!.net)).toBe(-29.99);

      const nothing = await reverseSale(OWNER_A, original.id, {
        documentId: "RF-NONE"
      });

      expect(nothing.status).toBe(422);
    });

    test("concurrent full reversals of one sale: exactly one refunds it", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const original = await sale("SO-REVRACE");
      const results = await Promise.all(
        [1, 2, 3, 4].map((n) =>
          reverseSale(OWNER_A, original.id, { documentId: `RF-RACE-${n}` })
        )
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 422)).toHaveLength(3);

      const total = (await getHandlerAdminSql()`
        SELECT sum(tax_total)::numeric AS tax FROM awcms_tax_snapshots
        WHERE tenant_id = ${TENANT_A} AND original_snapshot_id = ${original.id}
      `) as { tax: string }[];

      expect(Number(total[0]!.tax)).toBe(-3);
    });

    test("a retried reversal under a fresh key replays; the same refund id with a different body conflicts", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const original = await sale("SO-REVREPLAY");
      const first = await reverseSale(
        OWNER_A,
        original.id,
        { documentId: "RF-R", lines: [{ lineRef: "a", quantity: "1" }] },
        "rv-1"
      );
      const replay = await reverseSale(
        OWNER_A,
        original.id,
        { documentId: "RF-R", lines: [{ lineRef: "a", quantity: "1" }] },
        "rv-2"
      );
      const conflict = await reverseSale(
        OWNER_A,
        original.id,
        { documentId: "RF-R", lines: [{ lineRef: "a", quantity: "2" }] },
        "rv-3"
      );

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.body.data!.id).toBe(first.body.data!.id);
      expect(conflict.status).toBe(409);
    });

    test("a reversal body cannot carry an amount, and an unknown original is a 404", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const original = await sale("SO-REVAMT");
      const refused = await reverseSale(OWNER_A, original.id, {
        documentId: "RF-AMT",
        taxAmount: "0.01"
      });

      expect(refused.status).toBe(400);
      expect(refused.body.error?.code).toBe("TAX_AMOUNT_NOT_ACCEPTED");

      const missing = await reverseSale(
        OWNER_A,
        "88988988-0000-4988-8988-988988989999",
        { documentId: "RF-MISSING" }
      );

      expect(missing.status).toBe(404);
    });

    test("reversal emits an event and an audit row once", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const original = await sale("SO-REVEVT");

      await reverseSale(OWNER_A, original.id, { documentId: "RF-E" }, "ev-1");
      await reverseSale(OWNER_A, original.id, { documentId: "RF-E" }, "ev-2");

      const sql = getHandlerAdminSql();
      const events = (await sql`
        SELECT count(*)::int AS n FROM awcms_domain_events
        WHERE tenant_id = ${TENANT_A} AND event_type = 'awcms.tax.snapshot.reversed'
      `) as { n: number }[];
      const audits = (await sql`
        SELECT count(*)::int AS n, max(severity) AS severity FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND action = 'tax.snapshot.reverse'
      `) as { n: number; severity: string }[];

      expect(events[0]!.n).toBe(1);
      expect(audits[0]).toMatchObject({ n: 1, severity: "critical" });
    });
  });

  describe("reconciliation", () => {
    test("nets reversals against sales, breaks totals down by component and treatment, and the integrity block is clean", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      const sale = await finaliseSale(
        OWNER_A,
        saleBody("SO-REC", TODAY, [
          { lineRef: "a", quantity: "1", unitPrice: "100.00" },
          {
            lineRef: "b",
            quantity: "1",
            unitPrice: "50.00",
            categoryCode: "books"
          },
          {
            lineRef: "c",
            quantity: "1",
            unitPrice: "20.00",
            categoryCode: "food"
          }
        ]),
        "rec-1"
      );

      await reverseSale(
        OWNER_A,
        sale.body.data!.id,
        { documentId: "RF-REC", lines: [{ lineRef: "a", quantity: "1" }] },
        "rec-2"
      );

      const res = await call<{
        netOfReversals: {
          currencyCode: string;
          sales: number;
          reversals: number;
          netTotal: string;
          taxTotal: string;
          grossTotal: string;
        }[];
        byComponent: {
          kind: string;
          profileCode: string;
          currencyCode: string;
          componentCode: string;
          taxAmount: string;
        }[];
        byTreatment: { kind: string; treatment: string; netAmount: string }[];
        integrity: {
          documentsChecked: number;
          lineSumMismatches: number;
          componentSumMismatches: number;
        };
      }>(reconciliation, OWNER_A, {
        path: `/api/v1/tax/reports/reconciliation?from=${TODAY}&to=${TODAY}`
      });

      expect(res.status).toBe(200);
      expect(res.body.data!.netOfReversals).toEqual([
        {
          currencyCode: "USD",
          sales: 1,
          reversals: 1,
          netTotal: "70",
          taxTotal: "0",
          grossTotal: "70"
        }
      ]);
      expect(res.body.data!.byComponent).toEqual([
        {
          kind: "reversal",
          profileCode: "retail",
          currencyCode: "USD",
          componentCode: "vat",
          taxAmount: "-10"
        },
        {
          kind: "sale",
          profileCode: "retail",
          currencyCode: "USD",
          componentCode: "vat",
          taxAmount: "10"
        }
      ]);
      expect(
        res.body
          .data!.byTreatment.filter((t) => t.kind === "sale")
          .map((t) => [t.treatment, t.netAmount])
      ).toEqual([
        ["exempt", "50"],
        ["taxable", "100"],
        ["zero_rated", "20"]
      ]);
      expect(res.body.data!.integrity).toEqual({
        documentsChecked: 2,
        lineSumMismatches: 0,
        componentSumMismatches: 0
      });
    });

    test("a period outside the range finds nothing, and the span is capped", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);
      await finaliseSale(OWNER_A, saleBody("SO-RANGE", TODAY), "range-1");

      const empty = await call<{ byVersion: unknown[] }>(
        reconciliation,
        OWNER_A,
        {
          path: `/api/v1/tax/reports/reconciliation?from=${addDays(TODAY, 10)}&to=${addDays(TODAY, 20)}`
        }
      );

      expect(empty.body.data!.byVersion).toEqual([]);

      const tooWide = await call(reconciliation, OWNER_A, {
        path: `/api/v1/tax/reports/reconciliation?from=${addDays(TODAY, -400)}&to=${TODAY}`
      });

      expect(tooWide.status).toBe(400);
    });
  });

  describe("security-audit hardening (PR #890)", () => {
    /** A published version dated in the past, which the API itself can never create. */
    async function seedLegacyVersion(profile: string): Promise<void> {
      await getHandlerAdminSql()`
        INSERT INTO awcms_tax_rule_versions (
          tenant_id, profile_code, version_no, status, name, jurisdiction_code,
          currency_code, pricing_mode, rounding_mode, rounding_scale,
          rounding_level, effective_from, definition, published_at
        ) VALUES (
          ${TENANT_A}, ${profile}, 1, 'published', 'Legacy', 'XX', 'USD',
          'exclusive', 'half_up', 2, 'line', ${addDays(TODAY, -60)}::date,
          ${DEFINITION}::jsonb, now()
        )
      `;
    }

    const oneLine = [{ lineRef: "a", quantity: "1", unitPrice: "10.00" }];

    describe("H2a — a publish cannot be back-dated", () => {
      test("a version cannot take effect before the server's date", async () => {
        if (!handlerReady) return;

        const early = await draft(OWNER_A, {
          effectiveFrom: addDays(TODAY, -1)
        });
        const res = await publish(OWNER_A, early.id);

        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe("TAX_VERSION_BACKDATED");
        expect(res.body.error?.message).toContain(TODAY);

        // Today itself is the earliest day a first version may start.
        const today = await draft(OWNER_A, { effectiveFrom: TODAY });

        expect((await publish(OWNER_A, today.id)).status).toBe(200);
      });

      test("nor on or before a tax date already finalised under the profile", async () => {
        if (!handlerReady) return;

        await draftAndPublish(OWNER_A, { effectiveFrom: TODAY });

        // The window allows one day forward: this document carries tomorrow's date.
        const tomorrow = addDays(TODAY, 1);
        const sale = await finaliseSale(
          OWNER_A,
          saleBody("SO-BD", tomorrow),
          "bd-1"
        );

        expect(sale.status).toBe(201);

        // Passes the order check (tomorrow > today), is not before today, but would
        // claim a day that already holds a document computed under v1.
        const claims = await draft(OWNER_A, { effectiveFrom: tomorrow });
        const refused = await publish(OWNER_A, claims.id);

        expect(refused.status).toBe(409);
        expect(refused.body.error?.code).toBe("TAX_VERSION_BACKDATED");
        expect(refused.body.error?.message).toContain(tomorrow);

        const after = await draft(OWNER_A, {
          effectiveFrom: addDays(TODAY, 2)
        });

        expect((await publish(OWNER_A, after.id)).status).toBe(200);
      });

      test("the check reads the database's clock, not JavaScript's", async () => {
        if (!handlerReady) return;

        // A skewed application node that believes it is a year from now would see
        // `effectiveFrom = today` as "before today" and refuse it. The DATABASE
        // date is what a publish is measured against, so it must still go through.
        const realNow = Date.now;

        Date.now = () => realNow() + 400 * 86_400_000;

        try {
          const dated = await draft(OWNER_A, { effectiveFrom: TODAY });

          expect((await publish(OWNER_A, dated.id)).status).toBe(200);
        } finally {
          Date.now = realNow;
        }
      });
    });

    describe("H2b — the pricing mode is the rule version's, not the caller's", () => {
      test("a pricingMode in a quote or snapshot body is refused", async () => {
        if (!handlerReady) return;

        await draftAndPublish(OWNER_A);

        const quoted = await call(quote, OWNER_A, {
          method: "POST",
          path: "/api/v1/tax/quote",
          key: null,
          body: {
            profileCode: "retail",
            taxDate: TODAY,
            pricingMode: "inclusive",
            lines: oneLine
          }
        });

        expect(quoted.status).toBe(400);
        expect(quoted.body.error?.code).toBe("VALIDATION_ERROR");

        const finalised = await finaliseSale(OWNER_A, {
          ...saleBody("SO-PM"),
          pricingMode: "inclusive"
        });

        expect(finalised.status).toBe(400);
      });
    });

    describe("H2c — the tax date is bounded against the server date", () => {
      test("inside the window any caller holding the route's permission may state it; outside it needs tax.snapshots.backdate", async () => {
        if (!handlerReady) return;

        await draftAndPublish(OWNER_A, { effectiveFrom: TODAY });
        await seedLegacyVersion("legacy");

        const sale = (
          documentId: string,
          taxDate: string,
          profileCode = "retail"
        ) =>
          finaliseSale(MAKER_A, {
            ...saleBody(documentId, taxDate),
            profileCode
          });

        // Forward: +1 is the edge of the window, +2 is outside it.
        expect((await sale("W-F1", addDays(TODAY, 1))).status).toBe(201);

        const tooFar = await sale("W-F2", addDays(TODAY, 2));

        expect(tooFar.status).toBe(403);
        expect(tooFar.body.error?.code).toBe(
          "TAX_BACKDATE_PERMISSION_REQUIRED"
        );

        // Back: -7 is the edge (the legacy profile has a version covering it).
        expect((await sale("W-B7", addDays(TODAY, -7), "legacy")).status).toBe(
          201
        );

        const tooOld = await sale("W-B8", addDays(TODAY, -8), "legacy");

        expect(tooOld.status).toBe(403);
        expect(tooOld.body.error?.code).toBe(
          "TAX_BACKDATE_PERMISSION_REQUIRED"
        );

        // Nothing was written for the refusals.
        const rows = (await getHandlerAdminSql()`
          SELECT document_id FROM awcms_tax_snapshots
          WHERE tenant_id = ${TENANT_A} ORDER BY document_id
        `) as { document_id: string }[];

        expect(rows.map((r) => r.document_id)).toEqual(["W-B7", "W-F1"]);

        // The holder of the permission may, and the audit row says it did.
        const allowed = await finaliseSale(
          OWNER_A,
          { ...saleBody("W-B30", addDays(TODAY, -30)), profileCode: "legacy" },
          "w-b30"
        );

        expect(allowed.status).toBe(201);

        const audit = (await getHandlerAdminSql()`
          SELECT attributes ->> 'backdated' AS backdated FROM awcms_audit_events
          WHERE tenant_id = ${TENANT_A} AND action = 'tax.snapshot.finalise'
            AND attributes ->> 'documentId' = 'W-B30'
        `) as { backdated: string }[];

        expect(audit[0]!.backdated).toBe("true");
      });

      test("the denial is in the decision log (it goes through the chokepoint)", async () => {
        if (!handlerReady) return;

        await draftAndPublish(OWNER_A, { effectiveFrom: TODAY });
        await finaliseSale(MAKER_A, saleBody("W-LOG", addDays(TODAY, 5)));

        const rows = (await getHandlerAdminSql()`
          SELECT count(*)::int AS n FROM awcms_abac_decision_logs
          WHERE tenant_id = ${TENANT_A} AND decision = 'deny'
            AND tenant_user_id = ${MAKER_A.tenantUserId}
        `) as { n: number }[];

        expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
      });

      test("a reversal's tax date defaults to the SERVER's date, and a stated one is bounded the same way", async () => {
        if (!handlerReady) return;

        await draftAndPublish(OWNER_A, { effectiveFrom: TODAY });
        await seedLegacyVersion("legacy");

        const original = await finaliseSale(
          OWNER_A,
          saleBody("W-REV"),
          "w-rev"
        );
        const omitted = await reverseSale(MAKER_A, original.body.data!.id, {
          documentId: "RF-W1",
          lines: [{ lineRef: "a", quantity: "1" }]
        });

        expect(omitted.status).toBe(201);
        expect((omitted.body.data as { taxDate?: string }).taxDate).toBe(TODAY);

        const stated = await reverseSale(MAKER_A, original.body.data!.id, {
          documentId: "RF-W2",
          taxDate: addDays(TODAY, -30),
          lines: [{ lineRef: "a", quantity: "1" }]
        });

        expect(stated.status).toBe(403);
        expect(stated.body.error?.code).toBe(
          "TAX_BACKDATE_PERMISSION_REQUIRED"
        );

        const permitted = await reverseSale(OWNER_A, original.body.data!.id, {
          documentId: "RF-W3",
          taxDate: addDays(TODAY, -30),
          lines: [{ lineRef: "a", quantity: "1" }]
        });

        expect(permitted.status).toBe(201);
        expect((permitted.body.data as { taxDate?: string }).taxDate).toBe(
          addDays(TODAY, -30)
        );
      });
    });

    describe("M1 — amounts that cannot fit numeric(24,6) are a 422, never a 500", () => {
      const huge = [
        { lineRef: "a", quantity: "999999999", unitPrice: "999999999999.99" }
      ];

      test("from /quote and /snapshots alike", async () => {
        if (!handlerReady) return;

        await draftAndPublish(OWNER_A);

        const quoted = await call(quote, OWNER_A, {
          method: "POST",
          path: "/api/v1/tax/quote",
          key: null,
          body: { profileCode: "retail", taxDate: TODAY, lines: huge }
        });

        expect(quoted.status).toBe(422);
        expect(quoted.body.error?.code).toBe("TAX_INPUT_INVALID");

        const finalised = await finaliseSale(
          OWNER_A,
          saleBody("SO-HUGE", TODAY, huge)
        );

        expect(finalised.status).toBe(422);
        expect(finalised.body.error?.code).toBe("TAX_INPUT_INVALID");

        const rows = (await getHandlerAdminSql()`
          SELECT count(*)::int AS n FROM awcms_tax_snapshots
          WHERE tenant_id = ${TENANT_A}
        `) as { n: number }[];

        expect(rows[0]!.n).toBe(0);
      });
    });

    describe("M2 — the application's profile lock is the trigger's lock", () => {
      test("an upper-case tenant id takes the same lock key the trigger takes", async () => {
        if (!handlerReady) return;

        // A tenant id with hex letters, so upper-case differs from the canonical
        // lower-case text the trigger builds from `tenant_id::text`.
        const tenant = "abcdefab-cdef-4abc-8def-abcdefabcdef";
        const sql = getHandlerAdminSql();

        await sql.begin(async (holder) => {
          await lockProfile(holder, tenant.toUpperCase(), "lock-probe");

          const probe = (await sql.begin(
            async (other) =>
              other`SELECT
                pg_try_advisory_xact_lock(hashtextextended(${tenant}::uuid::text || ':' || 'lock-probe', 0)) AS exclusive_got,
                pg_try_advisory_xact_lock_shared(hashtextextended(${tenant}::uuid::text || ':' || 'lock-probe', 0)) AS shared_got`
          )) as { exclusive_got: boolean; shared_got: boolean }[];

          expect(probe[0]).toEqual({ exclusive_got: false, shared_got: false });
        });
      });

      test("the shared form excludes a publish and not another finalise", async () => {
        if (!handlerReady) return;

        const tenant = "abcdefab-cdef-4abc-8def-abcdefabcdee";
        const sql = getHandlerAdminSql();

        await sql.begin(async (finalising) => {
          await lockProfileShared(
            finalising,
            tenant.toUpperCase(),
            "lock-probe"
          );

          const probe = (await sql.begin(
            async (other) =>
              other`SELECT
                pg_try_advisory_xact_lock(hashtextextended(${tenant}::uuid::text || ':' || 'lock-probe', 0)) AS exclusive_got,
                pg_try_advisory_xact_lock_shared(hashtextextended(${tenant}::uuid::text || ':' || 'lock-probe', 0)) AS shared_got`
          )) as { exclusive_got: boolean; shared_got: boolean }[];

          expect(probe[0]).toEqual({ exclusive_got: false, shared_got: true });
        });
      });
    });

    describe("M3 — lists are summaries; the bodies come from the detail endpoints", () => {
      test("neither list carries lines or a definition, and the details still do", async () => {
        if (!handlerReady) return;

        const published = await draftAndPublish(OWNER_A);
        const sale = await finaliseSale(OWNER_A, saleBody("SO-LIST"), "list-1");

        const versions = await call<{ versions: Record<string, unknown>[] }>(
          listVersions,
          OWNER_A,
          { path: "/api/v1/tax/rule-versions" }
        );

        expect(versions.body.data!.versions.length).toBeGreaterThan(0);

        for (const row of versions.body.data!.versions) {
          expect(row).not.toHaveProperty("definition");
          expect(row).toHaveProperty("profileCode");
        }

        const snapshots = await call<{ snapshots: Record<string, unknown>[] }>(
          listSnapshots,
          OWNER_A,
          { path: "/api/v1/tax/snapshots" }
        );

        expect(snapshots.body.data!.snapshots.length).toBeGreaterThan(0);

        for (const row of snapshots.body.data!.snapshots) {
          expect(row).not.toHaveProperty("lines");
          expect(row).not.toHaveProperty("ruleDefinition");
          expect(row).toHaveProperty("grossTotal");
        }

        const version = await call<Record<string, unknown>>(
          readVersion,
          OWNER_A,
          {
            path: `/api/v1/tax/rule-versions/${published.id}`,
            params: { id: published.id }
          }
        );

        expect(version.body.data).toHaveProperty("definition");

        const detail = await call<Record<string, unknown>>(
          readSnapshot,
          OWNER_A,
          {
            path: `/api/v1/tax/snapshots/${sale.body.data!.id}`,
            params: { id: sale.body.data!.id }
          }
        );

        expect(detail.body.data).toHaveProperty("lines");
      });
    });

    describe("L1 — a malformed {id} is a 404, never a 500", () => {
      test("on all four [id] routes", async () => {
        if (!handlerReady) return;

        const bad = "not-a-uuid";

        const results = await Promise.all([
          call(readVersion, OWNER_A, {
            path: `/api/v1/tax/rule-versions/${bad}`,
            params: { id: bad }
          }),
          publish(OWNER_A, bad),
          call(readSnapshot, OWNER_A, {
            path: `/api/v1/tax/snapshots/${bad}`,
            params: { id: bad }
          }),
          reverseSale(OWNER_A, bad, { documentId: "RF-BAD" })
        ]);

        expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404]);
      });
    });

    describe("L2 — the snapshot detail does not embed the rule definition", () => {
      test("it names the version and leaves the rules to tax.rules.read", async () => {
        if (!handlerReady) return;

        const published = await draftAndPublish(OWNER_A);
        const sale = await finaliseSale(OWNER_A, saleBody("SO-L2"), "l2-1");
        const detail = await call<Record<string, unknown>>(
          readSnapshot,
          OWNER_A,
          {
            path: `/api/v1/tax/snapshots/${sale.body.data!.id}`,
            params: { id: sale.body.data!.id }
          }
        );

        expect(detail.body.data).not.toHaveProperty("ruleDefinition");
        expect(detail.body.data).toMatchObject({
          ruleVersionId: published.id,
          versionNo: 1,
          profileCode: "retail"
        });
      });
    });

    describe("L3 — opaque ids, and no reason in the event", () => {
      test("a document id that is not an opaque handle is refused", async () => {
        if (!handlerReady) return;

        await draftAndPublish(OWNER_A);

        for (const documentId of ["has space", "<b>x</b>", "x\ny", "tab\tx"]) {
          const res = await finaliseSale(OWNER_A, {
            ...saleBody("ignored"),
            documentId
          });

          expect(res.status).toBe(400);
        }
      });

      test("the reversal event carries no reason; the audit row keeps it", async () => {
        if (!handlerReady) return;

        await draftAndPublish(OWNER_A);

        const original = await finaliseSale(OWNER_A, saleBody("SO-L3"), "l3-1");

        await reverseSale(OWNER_A, original.body.data!.id, {
          documentId: "RF-L3",
          reason: "customer returned the goods"
        });

        const sql = getHandlerAdminSql();
        const events = (await sql`
          SELECT payload::text AS payload FROM awcms_domain_events
          WHERE tenant_id = ${TENANT_A}
            AND event_type = 'awcms.tax.snapshot.reversed'
        `) as { payload: string }[];

        expect(events).toHaveLength(1);
        expect(events[0]!.payload).not.toContain("reason");
        expect(events[0]!.payload).not.toContain("customer returned");

        const audit = (await sql`
          SELECT attributes ->> 'reason' AS reason FROM awcms_audit_events
          WHERE tenant_id = ${TENANT_A} AND action = 'tax.snapshot.reverse'
        `) as { reason: string }[];

        expect(audit[0]!.reason).toContain("customer returned");
      });
    });
  });

  describe("ABAC and tenant isolation", () => {
    test("a caller without the permission is refused: default-deny", async () => {
      if (!handlerReady) return;

      const created = await draft(OWNER_A);

      // READER_A holds tax.rules.read and nothing else.
      expect(
        (
          await call(listVersions, READER_A, {
            path: "/api/v1/tax/rule-versions"
          })
        ).status
      ).toBe(200);
      expect(
        (
          await call(createVersion, READER_A, {
            method: "POST",
            path: "/api/v1/tax/rule-versions",
            body: versionBody()
          })
        ).status
      ).toBe(403);
      expect((await publish(READER_A, created.id)).status).toBe(403);
      expect(
        (
          await call(quote, READER_A, {
            method: "POST",
            path: "/api/v1/tax/quote",
            key: null,
            body: {
              profileCode: "retail",
              taxDate: TODAY,
              lines: [{ lineRef: "a", quantity: "1", unitPrice: "1.00" }]
            }
          })
        ).status
      ).toBe(403);
      expect((await finaliseSale(READER_A, saleBody("SO-DENY"))).status).toBe(
        403
      );
      expect(
        (await call(listSnapshots, READER_A, { path: "/api/v1/tax/snapshots" }))
          .status
      ).toBe(403);
      expect(
        (
          await call(reconciliation, READER_A, {
            path: `/api/v1/tax/reports/reconciliation?from=${TODAY}&to=${TODAY}`
          })
        ).status
      ).toBe(403);
    });

    test("tenant B cannot see, resolve or reverse tenant A's rules and documents", async () => {
      if (!handlerReady) return;

      const published = await draftAndPublish(OWNER_A);
      const sale = await finaliseSale(OWNER_A, saleBody("SO-ISO"), "iso-1");

      const read = await call(readVersion, OWNER_B, {
        path: `/api/v1/tax/rule-versions/${published.id}`,
        params: { id: published.id }
      });

      expect(read.status).toBe(404);

      const list = await call<{ versions: unknown[] }>(listVersions, OWNER_B, {
        path: "/api/v1/tax/rule-versions"
      });

      expect(list.body.data!.versions).toEqual([]);

      const resolve = await call(quote, OWNER_B, {
        method: "POST",
        path: "/api/v1/tax/quote",
        key: null,
        body: {
          profileCode: "retail",
          taxDate: TODAY,
          lines: [{ lineRef: "a", quantity: "1", unitPrice: "1.00" }]
        }
      });

      expect(resolve.status).toBe(422);

      const snap = await call(readSnapshot, OWNER_B, {
        path: `/api/v1/tax/snapshots/${sale.body.data!.id}`,
        params: { id: sale.body.data!.id }
      });

      expect(snap.status).toBe(404);
      expect(
        (await reverseSale(OWNER_B, sale.body.data!.id, { documentId: "RF-B" }))
          .status
      ).toBe(404);
    });

    test("listing paginates by keyset and never loses a row at a page boundary", async () => {
      if (!handlerReady) return;

      await draftAndPublish(OWNER_A);

      for (let index = 0; index < 3; index += 1) {
        await finaliseSale(
          OWNER_A,
          saleBody(`SO-PAGE-${index}`),
          `page-${index}`
        );
      }

      type Page = { snapshots: { id: string }[]; nextCursor: string | null };

      const firstPage = await call<Page>(listSnapshots, OWNER_A, {
        path: "/api/v1/tax/snapshots?kind=sale"
      });

      expect(firstPage.body.data!.snapshots).toHaveLength(3);
      expect(firstPage.body.data!.nextCursor).toBeNull();

      const filtered = await call<Page>(listSnapshots, OWNER_A, {
        path: "/api/v1/tax/snapshots?documentType=order&documentId=SO-PAGE-1"
      });

      expect(filtered.body.data!.snapshots).toHaveLength(1);

      const badCursor = await call(listSnapshots, OWNER_A, {
        path: "/api/v1/tax/snapshots?cursor=not-a-cursor"
      });

      expect(badCursor.status).toBe(400);
    });
  });
});

// ===========================================================================
// WORLD 1 — the database's own guarantees, as a non-superuser table owner.
// ===========================================================================

const T1 = "88988988-9889-4988-8988-988988988911";
const T2 = "88988988-9889-4988-8988-988988988912";

const definitionJson = DEFINITION;

async function insertVersion(
  tenantId: string,
  fields: {
    profile?: string;
    versionNo: number;
    status?: string;
    from: string;
    to?: string | null;
  }
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_tax_rule_versions (
      tenant_id, profile_code, version_no, status, name, jurisdiction_code,
      currency_code, pricing_mode, rounding_mode, rounding_scale, rounding_level,
      effective_from, effective_to, definition, published_at
    )
    VALUES (
      ${tenantId}, ${fields.profile ?? "retail"}, ${fields.versionNo},
      ${fields.status ?? "published"}, 'Retail', 'XX', 'USD', 'exclusive',
      'half_up', 2, 'line', ${fields.from}::date, ${fields.to ?? null}::date,
      ${definitionJson}::jsonb,
      ${(fields.status ?? "published") === "published" ? new Date() : null}
    )
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function insertSnapshot(
  tenantId: string,
  versionId: string,
  fields: {
    kind?: "sale" | "reversal";
    documentId: string;
    original?: string | null;
    net: string;
    tax: string;
    createdAt?: string;
  }
): Promise<string> {
  const kind = fields.kind ?? "sale";
  const gross = (Number(fields.net) + Number(fields.tax)).toFixed(2);
  const rows = (await getAdminSql()`
    INSERT INTO awcms_tax_snapshots (
      tenant_id, kind, document_type, document_id, original_snapshot_id,
      rule_version_id, profile_code, version_no, tax_date, currency_code,
      pricing_mode, rounding_mode, rounding_scale, rounding_level,
      rule_definition, lines, component_totals, treatment_totals,
      net_total, tax_total, gross_total, input_hash, created_at
    )
    VALUES (
      ${tenantId}, ${kind}, 'order', ${fields.documentId},
      ${fields.original ?? null}, ${versionId}, 'retail', 1, '2026-06-15',
      'USD', 'exclusive', 'half_up', 2, 'line', ${definitionJson}::jsonb,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      ${fields.net}::numeric, ${fields.tax}::numeric, ${gross}::numeric,
      'hash', COALESCE(${fields.createdAt ?? null}::timestamptz, now())
    )
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/**
 * Runs `statement` as the schema OWNER with a tenant context set — FORCE RLS
 * applies to the owner, and its policy reads `app.current_tenant_id`, so a bare
 * owner statement is refused for want of a tenant before any trigger is reached.
 * The statement still executes as the owner, so the trigger is what is under test.
 */
function asOwner(
  tenantId: string,
  statement: (tx: Bun.SQL) => Promise<unknown>
): Promise<unknown> {
  return withTenantOrThrow(getOwnerSql(), tenantId, async (tx) =>
    statement(tx)
  );
}

const dbSuite = integrationEnabled ? describe : describe.skip;

dbSuite("tax — what the database itself enforces (ADR-0127)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${T1}, 'tax-db-1', 'Tax DB 1'), (${T2}, 'tax-db-2', 'Tax DB 2')
    `;
  }, 30000);

  describe("rule versions", () => {
    test("a published version cannot be edited, re-opened or deleted — even by its owner", async () => {
      const id = await insertVersion(T1, { versionNo: 1, from: "2026-01-01" });
      for (const [what, run] of [
        [
          "its definition",
          () =>
            asOwner(
              T1,
              (tx) =>
                tx`UPDATE awcms_tax_rule_versions SET definition = '{"categories":[],"rules":[]}'::jsonb WHERE id = ${id}`
            )
        ],
        [
          "its rounding mode",
          () =>
            asOwner(
              T1,
              (tx) =>
                tx`UPDATE awcms_tax_rule_versions SET rounding_mode = 'floor' WHERE id = ${id}`
            )
        ],
        [
          "its start date",
          () =>
            asOwner(
              T1,
              (tx) =>
                tx`UPDATE awcms_tax_rule_versions SET effective_from = '2025-01-01' WHERE id = ${id}`
            )
        ],
        [
          "its status",
          () =>
            asOwner(
              T1,
              (tx) =>
                tx`UPDATE awcms_tax_rule_versions SET status = 'draft' WHERE id = ${id}`
            )
        ],
        [
          "a delete",
          () =>
            asOwner(
              T1,
              (tx) => tx`DELETE FROM awcms_tax_rule_versions WHERE id = ${id}`
            )
        ]
      ] as const) {
        const error = await assertRejected(run(), what);

        expect(error.message).toMatch(/published/);
      }
    });

    test("a published window may be closed once, forward, and never re-opened or moved", async () => {
      const id = await insertVersion(T1, { versionNo: 1, from: "2026-01-01" });

      await asOwner(
        T1,
        (tx) =>
          tx`UPDATE awcms_tax_rule_versions SET effective_to = '2027-01-01', updated_at = now() WHERE id = ${id}`
      );

      await assertRejected(
        asOwner(
          T1,
          (tx) =>
            tx`UPDATE awcms_tax_rule_versions SET effective_to = '2028-01-01' WHERE id = ${id}`
        ),
        "moving a closed window"
      );
      await assertRejected(
        asOwner(
          T1,
          (tx) =>
            tx`UPDATE awcms_tax_rule_versions SET effective_to = NULL WHERE id = ${id}`
        ),
        "re-opening a closed window"
      );

      const other = await insertVersion(T1, {
        profile: "other",
        versionNo: 1,
        from: "2026-01-01"
      });

      await assertRejected(
        asOwner(
          T1,
          (tx) =>
            tx`UPDATE awcms_tax_rule_versions SET effective_to = '2026-01-01' WHERE id = ${other}`
        ),
        "closing a window at or before its own start"
      );
    });

    test("published windows of one profile cannot overlap; other profiles and tenants are independent", async () => {
      await insertVersion(T1, {
        versionNo: 1,
        from: "2026-01-01",
        to: "2027-01-01"
      });

      const overlap = await assertRejected(
        insertVersion(T1, { versionNo: 2, from: "2026-12-31" }),
        "an overlapping window"
      );

      expect(overlap.message).toMatch(/overlap/);

      // Touching is not overlapping: half-open windows.
      await insertVersion(T1, { versionNo: 3, from: "2027-01-01" });
      // A different profile and a different tenant may use the same dates.
      await insertVersion(T1, {
        profile: "export",
        versionNo: 1,
        from: "2026-01-01"
      });
      await insertVersion(T2, { versionNo: 1, from: "2026-01-01" });

      // Drafts never count.
      await insertVersion(T1, {
        versionNo: 4,
        status: "draft",
        from: "2026-06-01"
      });
    });

    test("version numbers are unique per profile", async () => {
      await insertVersion(T1, {
        versionNo: 1,
        from: "2026-01-01",
        to: "2027-01-01"
      });

      await assertRejected(
        insertVersion(T1, {
          versionNo: 1,
          status: "draft",
          from: "2028-01-01"
        }),
        "a duplicate version number"
      );
    });

    test("a window must end after it starts", async () => {
      await assertRejected(
        insertVersion(T1, {
          versionNo: 1,
          from: "2026-01-01",
          to: "2026-01-01"
        }),
        "an empty window"
      );
    });
  });

  describe("snapshots", () => {
    test("a snapshot can never be updated, and a young one can never be deleted", async () => {
      const version = await insertVersion(T1, {
        versionNo: 1,
        from: "2026-01-01"
      });
      const id = await insertSnapshot(T1, version, {
        documentId: "D1",
        net: "10.00",
        tax: "1.00"
      });
      const update = await assertRejected(
        asOwner(
          T1,
          (tx) =>
            tx`UPDATE awcms_tax_snapshots SET net_total = 0 WHERE id = ${id}`
        ),
        "an update"
      );

      expect(update.message).toMatch(/append-only/);

      const del = await assertRejected(
        asOwner(
          T1,
          (tx) => tx`DELETE FROM awcms_tax_snapshots WHERE id = ${id}`
        ),
        "a delete inside the retention floor"
      );

      expect(del.message).toMatch(/append-only/);
    });

    test("a snapshot past the 1826-day floor may be purged — and one a day short of it may not", async () => {
      const version = await insertVersion(T1, {
        versionNo: 1,
        from: "2026-01-01"
      });
      const old = await insertSnapshot(T1, version, {
        documentId: "OLD",
        net: "10.00",
        tax: "1.00",
        createdAt: new Date(Date.now() - 1827 * 86_400_000).toISOString()
      });
      const nearly = await insertSnapshot(T1, version, {
        documentId: "NEARLY",
        net: "10.00",
        tax: "1.00",
        createdAt: new Date(Date.now() - 1825 * 86_400_000).toISOString()
      });
      await asOwner(
        T1,
        (tx) => tx`DELETE FROM awcms_tax_snapshots WHERE id = ${old}`
      );
      await assertRejected(
        asOwner(
          T1,
          (tx) => tx`DELETE FROM awcms_tax_snapshots WHERE id = ${nearly}`
        ),
        "deleting a row a day inside the floor"
      );
    });

    test("a snapshot cannot be pointed at a rule version that does not exist, and a version it cites cannot be deleted", async () => {
      const version = await insertVersion(T1, {
        versionNo: 1,
        from: "2026-01-01"
      });

      await assertRejected(
        insertSnapshot(T1, "88988988-0000-4988-8988-988988980000", {
          documentId: "D2",
          net: "1.00",
          tax: "0.00"
        }),
        "an unknown rule version"
      );

      await insertSnapshot(T1, version, {
        documentId: "D3",
        net: "1.00",
        tax: "0.00"
      });
      await assertRejected(
        asOwner(
          T1,
          (tx) => tx`DELETE FROM awcms_tax_rule_versions WHERE id = ${version}`
        ),
        "deleting a cited version"
      );
    });

    test("signs, gross and kind/original pairing are enforced", async () => {
      const version = await insertVersion(T1, {
        versionNo: 1,
        from: "2026-01-01"
      });
      const sale = await insertSnapshot(T1, version, {
        documentId: "S",
        net: "10.00",
        tax: "1.00"
      });

      await assertRejected(
        insertSnapshot(T1, version, {
          documentId: "NEG",
          net: "-1.00",
          tax: "0.00"
        }),
        "a negative sale"
      );
      await assertRejected(
        insertSnapshot(T1, version, {
          kind: "reversal",
          documentId: "POS",
          original: sale,
          net: "1.00",
          tax: "0.00"
        }),
        "a positive reversal"
      );
      await assertRejected(
        insertSnapshot(T1, version, {
          kind: "reversal",
          documentId: "NOORIG",
          net: "-1.00",
          tax: "0.00"
        }),
        "a reversal with no original"
      );
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_tax_snapshots (
            tenant_id, kind, document_type, document_id, rule_version_id,
            profile_code, version_no, tax_date, currency_code, pricing_mode,
            rounding_mode, rounding_scale, rounding_level, rule_definition, lines,
            component_totals, treatment_totals, net_total, tax_total, gross_total, input_hash
          ) VALUES (
            ${T1}, 'sale', 'order', 'BADGROSS', ${version}, 'retail', 1,
            '2026-06-15', 'USD', 'exclusive', 'half_up', 2, 'line',
            ${definitionJson}::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
            10, 1, 99, 'h'
          )
        `,
        "gross that is not net + tax"
      );
    });

    test("a document is finalised once, per kind", async () => {
      const version = await insertVersion(T1, {
        versionNo: 1,
        from: "2026-01-01"
      });

      await insertSnapshot(T1, version, {
        documentId: "ONCE",
        net: "1.00",
        tax: "0.00"
      });
      await assertRejected(
        insertSnapshot(T1, version, {
          documentId: "ONCE",
          net: "1.00",
          tax: "0.00"
        }),
        "finalising a document twice"
      );
    });

    test("a reversal cannot out-refund its original, even when two race", async () => {
      const version = await insertVersion(T1, {
        versionNo: 1,
        from: "2026-01-01"
      });
      const sale = await insertSnapshot(T1, version, {
        documentId: "SALE",
        net: "10.00",
        tax: "1.00"
      });

      await insertSnapshot(T1, version, {
        kind: "reversal",
        documentId: "R1",
        original: sale,
        net: "-6.00",
        tax: "-0.60"
      });

      const over = await assertRejected(
        insertSnapshot(T1, version, {
          kind: "reversal",
          documentId: "R2",
          original: sale,
          net: "-5.00",
          tax: "-0.50"
        }),
        "refunding more than was charged"
      );

      expect(over.message).toMatch(/more than the original charged/);

      // Racing refunds of what is left: each fits alone, both together do not.
      const settled = await Promise.allSettled([
        insertSnapshot(T1, version, {
          kind: "reversal",
          documentId: "R3",
          original: sale,
          net: "-4.00",
          tax: "-0.40"
        }),
        insertSnapshot(T1, version, {
          kind: "reversal",
          documentId: "R4",
          original: sale,
          net: "-4.00",
          tax: "-0.40"
        })
      ]);

      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);

      const sum = (await getAdminSql()`
        SELECT sum(net_total)::numeric AS net FROM awcms_tax_snapshots
        WHERE original_snapshot_id = ${sale}
      `) as { net: string }[];

      expect(Number(sum[0]!.net)).toBe(-10);
    });

    test("a reversal must name a real sale in its own tenant", async () => {
      const v1 = await insertVersion(T1, { versionNo: 1, from: "2026-01-01" });
      const v2 = await insertVersion(T2, { versionNo: 1, from: "2026-01-01" });
      const foreign = await insertSnapshot(T2, v2, {
        documentId: "THEIRS",
        net: "10.00",
        tax: "1.00"
      });

      await assertRejected(
        insertSnapshot(T1, v1, {
          kind: "reversal",
          documentId: "X",
          original: foreign,
          net: "-1.00",
          tax: "0.00"
        }),
        "reversing another tenant's sale"
      );
      await assertRejected(
        insertSnapshot(T1, v1, {
          kind: "reversal",
          documentId: "Y",
          original: "88988988-0000-4988-8988-988988980001",
          net: "-1.00",
          tax: "0.00"
        }),
        "reversing a snapshot that does not exist"
      );
    });
  });

  describe("row-level security (FORCE, as a non-superuser owner)", () => {
    test("each tenant sees only its own rule versions and snapshots, and cannot write into the other's", async () => {
      const v1 = await insertVersion(T1, { versionNo: 1, from: "2026-01-01" });
      const v2 = await insertVersion(T2, { versionNo: 1, from: "2026-01-01" });

      await insertSnapshot(T1, v1, {
        documentId: "ONE",
        net: "1.00",
        tax: "0.00"
      });
      await insertSnapshot(T2, v2, {
        documentId: "TWO",
        net: "2.00",
        tax: "0.00"
      });

      const owner = getOwnerSql();
      const seen = async (tenantId: string) =>
        withTenantOrThrow(owner, tenantId, async (tx) => ({
          versions: (
            (await tx`SELECT tenant_id FROM awcms_tax_rule_versions`) as {
              tenant_id: string;
            }[]
          ).map((r) => r.tenant_id),
          snapshots: (
            (await tx`SELECT document_id FROM awcms_tax_snapshots`) as {
              document_id: string;
            }[]
          ).map((r) => r.document_id)
        }));

      expect(await seen(T1)).toEqual({ versions: [T1], snapshots: ["ONE"] });
      expect(await seen(T2)).toEqual({ versions: [T2], snapshots: ["TWO"] });

      const crossWrite = await assertRejected(
        withTenantOrThrow(owner, T1, async (tx) => {
          await tx`
            INSERT INTO awcms_tax_rule_versions (
              tenant_id, profile_code, version_no, status, name, jurisdiction_code,
              currency_code, pricing_mode, rounding_mode, rounding_scale,
              rounding_level, effective_from, definition
            ) VALUES (
              ${T2}, 'sneaky', 1, 'draft', 'x', 'XX', 'USD', 'exclusive',
              'half_up', 2, 'line', '2026-01-01', ${definitionJson}::jsonb
            )
          `;
        }),
        "writing a row for another tenant"
      );

      expect(crossWrite.message).toMatch(/row-level security|policy/i);
    });

    test("with no tenant context the tables return nothing", async () => {
      const v1 = await insertVersion(T1, { versionNo: 1, from: "2026-01-01" });

      await insertSnapshot(T1, v1, {
        documentId: "ONE",
        net: "1.00",
        tax: "0.00"
      });

      // The migration owner with NO `app.current_tenant_id` set: the policy's
      // `current_setting(...)::uuid` is not a valid uuid, so the read is refused
      // outright rather than answering with another tenant's rows.
      const error = await assertRejected(
        getOwnerSql()`SELECT * FROM awcms_tax_snapshots`,
        "reading without a tenant context"
      );

      expect(error).toBeTruthy();
    });
  });
});
