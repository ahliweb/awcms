/**
 * Issue #637 — a static build on a DIFFERENT origin can send the visit-ingest
 * beacon, and the row is really written.
 *
 * The pure origin policy is covered in `tests/analytics-beacon-cors.test.ts`.
 * What only a real database can prove is the half that decides who is let in:
 * the `Origin` allow-list is `awcms_tenant_domains` read through the SECURITY
 * DEFINER lookup, and the two ways to get that wrong — granting a host that is
 * not an active tenant domain, and refusing one that is — are both invisible to
 * a mock that returns whatever the test told it to.
 *
 * The four things asserted here, in the order they matter:
 *
 *   1. an `Origin` that IS an active tenant domain gets the grant;
 *   2. an unknown host, and a domain that is merely `pending_verification`,
 *      get no grant — the allow-list is the verified set, not the requested one;
 *   3. a cross-origin POST from a granted origin actually WRITES a visitor
 *      session — the whole point of the issue, which every earlier layer of
 *      this feature could pass while still recording nothing;
 *   4. the origin's tenant and the body's `tenantCode` are INDEPENDENT: the row
 *      lands under the tenant the body names. CORS decided whether a browser
 *      may read the answer; it did not decide whose analytics this is.
 *
 * WORLD 2 (harness.ts) — real route handlers reach for `getDatabaseClient()`
 * internally, so this runs against the migrated `DATABASE_URL` database and
 * seeds through `getHandlerAdminSql()`.
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
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import {
  OPTIONS as collectOPTIONS,
  POST as collectPOST
} from "../../src/pages/api/v1/analytics/collect";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ACTIVE_HOST = "news.example.test";
const PENDING_HOST = "pending.example.test";
const COLLECT_PATH = "/api/v1/analytics/collect";

let handlerReady = false;
let previousEnabled: string | undefined;

async function seed(): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT_A}, 'beacon-a', 'Beacon A', 'active'),
      (${TENANT_B}, 'beacon-b', 'Beacon B', 'active')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO awcms_tenant_domains
      (tenant_id, hostname, normalized_hostname, status, verified_at)
    VALUES
      (${TENANT_A}, ${ACTIVE_HOST}, ${ACTIVE_HOST}, 'active', now()),
      (${TENANT_A}, ${PENDING_HOST}, ${PENDING_HOST}, 'pending_verification', NULL)
  `;
}

async function preflight(origin: string) {
  return invoke(collectOPTIONS, {
    method: "OPTIONS",
    path: COLLECT_PATH,
    headers: { origin }
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("analytics beacon cross-origin policy (integration)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();

    // The module's master switch defaults to OFF, and an off module answers
    // 202 without writing anything — which would make assertion 3 pass for the
    // wrong reason. Turn it on for this file only, and put it back after.
    previousEnabled = process.env.VISITOR_ANALYTICS_ENABLED;
    process.env.VISITOR_ANALYTICS_ENABLED = "true";
  });

  afterAll(async () => {
    if (previousEnabled === undefined) {
      delete process.env.VISITOR_ANALYTICS_ENABLED;
    } else {
      process.env.VISITOR_ANALYTICS_ENABLED = previousEnabled;
    }

    if (handlerReady) {
      await teardownHandlerDatabase();
    }
  });

  beforeEach(async () => {
    if (!handlerReady) {
      return;
    }
    await resetHandlerDatabase();
    await seed();
  });

  afterEach(async () => {
    if (handlerReady) {
      await resetHandlerDatabase();
    }
  });

  test("an active tenant domain is granted, and the grant is never `*`", async () => {
    if (!handlerReady) {
      return;
    }

    const { status, response } = await preflight(`https://${ACTIVE_HOST}`);

    expect(status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      `https://${ACTIVE_HOST}`
    );
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true"
    );
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS"
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "content-type"
    );
    expect(response.headers.get("vary")).toBe("Origin");
  });

  test("an unknown host is refused, and still says Vary", async () => {
    if (!handlerReady) {
      return;
    }

    const { status, response } = await preflight("https://nobody.example.test");

    expect(status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    // A refusal is as origin-dependent as a grant. Without this, one cached
    // object serves one origin's answer to another.
    expect(response.headers.get("vary")).toBe("Origin");
  });

  test("a domain that is only pending_verification is refused", async () => {
    if (!handlerReady) {
      return;
    }

    // The allow-list is the VERIFIED set. A tenant claiming a hostname it has
    // not proven it controls must not be able to grant itself cross-origin
    // access by claiming it.
    const { response } = await preflight(`https://${PENDING_HOST}`);

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a cross-origin POST from a granted origin actually records a visit", async () => {
    if (!handlerReady) {
      return;
    }

    const { status, response } = await invoke(collectPOST, {
      method: "POST",
      path: COLLECT_PATH,
      headers: {
        origin: `https://${ACTIVE_HOST}`,
        "content-type": "application/json"
      },
      body: { tenantCode: "beacon-a", path: "/berita/contoh" }
    });

    expect(status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      `https://${ACTIVE_HOST}`
    );

    const rows = (await getHandlerAdminSql()`
      SELECT tenant_id, area, current_path
      FROM awcms_visitor_sessions
      WHERE tenant_id = ${TENANT_A}
    `) as { tenant_id: string; area: string; current_path: string | null }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.area).toBe("public");
  });

  test("the origin's tenant and the body's tenantCode are independent", async () => {
    if (!handlerReady) {
      return;
    }

    // `news.example.test` belongs to tenant A; the body names tenant B. CORS
    // answered "may this browser read our response", NOT "whose analytics is
    // this" — so the row belongs to B, and A gets nothing. If these two ever
    // become one decision, this test is what notices.
    const { status } = await invoke(collectPOST, {
      method: "POST",
      path: COLLECT_PATH,
      headers: {
        origin: `https://${ACTIVE_HOST}`,
        "content-type": "application/json"
      },
      body: { tenantCode: "beacon-b", path: "/berita/lain" }
    });

    expect(status).toBe(202);

    const rows = (await getHandlerAdminSql()`
      SELECT tenant_id FROM awcms_visitor_sessions
    `) as { tenant_id: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe(TENANT_B);
  });

  test("a refused origin still records — CORS hides the answer, not the write", async () => {
    if (!handlerReady) {
      return;
    }

    // Worth pinning because it surprises people: CORS is enforced by the
    // BROWSER on the response. A caller that is not a browser (curl, a server,
    // a scraper) was never blocked by any of this and still is not. What
    // actually bounds that caller is the per-IP rate limit and the fact that a
    // public tenant code is all it could ever have.
    const { status, response } = await invoke(collectPOST, {
      method: "POST",
      path: COLLECT_PATH,
      headers: {
        origin: "https://nobody.example.test",
        "content-type": "application/json"
      },
      body: { tenantCode: "beacon-a", path: "/berita/contoh" }
    });

    expect(status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();

    const rows = (await getHandlerAdminSql()`
      SELECT tenant_id FROM awcms_visitor_sessions
    `) as { tenant_id: string }[];

    expect(rows).toHaveLength(1);
  });
});
