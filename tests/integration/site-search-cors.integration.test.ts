/**
 * ADR-0107 — a reader's browser on a statically built site can search, and it
 * searches ITS OWN tenant.
 *
 * The pure policy is covered in `tests/site-search-cors.test.ts`. What only a
 * real database can prove is the half a mock cannot be trusted with, and it is
 * the half the whole design exists for:
 *
 *   1. an `Origin` that IS an active tenant domain is granted, and the answer
 *      carries that tenant's documents;
 *   2. **a cross-origin request never falls through to the DEFAULT tenant.**
 *      `PUBLIC_DEFAULT_TENANT_ID` is set to a different tenant for this whole
 *      file, so if the origin rule were dropped and the host chain ran instead,
 *      tenant A's site would be served tenant B's articles — with a 200, a
 *      populated result list, and nothing anywhere reporting a problem. Both
 *      the granted and the refused path assert against that;
 *   3. a domain that is only `pending_verification` is refused — the allow-list
 *      is the VERIFIED set, so a tenant cannot grant itself access to another
 *      origin by merely claiming a hostname;
 *   4. a refusal is byte-identical to "no results" in the BODY and differs only
 *      in the absence of the grant header.
 *
 * WORLD 2 (harness.ts) — the route handlers reach for `getDatabaseClient()`
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
import { GET as searchQueryGET } from "../../src/pages/api/v1/site-search/query";
import { GET as searchSuggestGET } from "../../src/pages/api/v1/site-search/suggest";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ACTIVE_HOST = "search-a.example.test";
const PENDING_HOST = "search-pending.example.test";
const UNKNOWN_ORIGIN = "https://nobody.example.test";

/** Two tokens that exist in exactly one tenant each — so a result set names its own tenant. */
const TOKEN_A = "gembalasapi";
const TOKEN_B = "kelapasawitmuda";

const QUERY_PATH = "/api/v1/site-search/query";
const SUGGEST_PATH = "/api/v1/site-search/suggest";

let handlerReady = false;
let previousDefaultTenantId: string | undefined;

type QueryBody = {
  success: boolean;
  data: {
    items: { title: string; url: string }[];
    facets: { resourceTypes: unknown[]; terms: Record<string, unknown> };
    query: string;
    locale: string;
  };
};

async function seed(): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status, default_locale)
    VALUES
      (${TENANT_A}, 'search-a', 'Search A', 'active', 'id'),
      (${TENANT_B}, 'search-b', 'Search B', 'active', 'id')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO awcms_tenant_domains
      (tenant_id, hostname, normalized_hostname, status, verified_at)
    VALUES
      (${TENANT_A}, ${ACTIVE_HOST}, ${ACTIVE_HOST}, 'active', now()),
      (${TENANT_A}, ${PENDING_HOST}, ${PENDING_HOST}, 'pending_verification', NULL)
  `;

  await sql`
    INSERT INTO awcms_site_search_settings (tenant_id, enabled, suggestions_enabled)
    VALUES (${TENANT_A}, true, true), (${TENANT_B}, true, true)
  `;

  await sql`
    INSERT INTO awcms_site_search_documents
      (tenant_id, source_key, resource_type, resource_id, locale, url,
       title, summary, body_text, tags_text, source_updated_at, source_checksum)
    VALUES
      (${TENANT_A}, 'blog_content.post', 'blog_post', 'post-a', 'id',
       '/blog/search-a/artikel-a', ${`Artikel ${TOKEN_A}`}, 'Ringkasan A',
       ${`Badan artikel ${TOKEN_A}`}, '', now(), 'checksum-a'),
      (${TENANT_B}, 'blog_content.post', 'blog_post', 'post-b', 'id',
       '/blog/search-b/artikel-b', ${`Artikel ${TOKEN_B}`}, 'Ringkasan B',
       ${`Badan artikel ${TOKEN_B}`}, '', now(), 'checksum-b')
  `;
}

async function search(
  query: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: QueryBody; response: Response }> {
  return invoke<QueryBody>(searchQueryGET, {
    method: "GET",
    path: `${QUERY_PATH}?q=${encodeURIComponent(query)}`,
    headers
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("public search cross-origin policy (integration)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();

    // The trap this file exists to catch. With the origin rule removed, EVERY
    // request below — including the ones from an origin this deployment has
    // never heard of — would resolve to tenant B through the host chain's
    // env fallback and answer with B's articles.
    previousDefaultTenantId = process.env.PUBLIC_DEFAULT_TENANT_ID;
    process.env.PUBLIC_DEFAULT_TENANT_ID = TENANT_B;
  });

  afterAll(async () => {
    if (previousDefaultTenantId === undefined) {
      delete process.env.PUBLIC_DEFAULT_TENANT_ID;
    } else {
      process.env.PUBLIC_DEFAULT_TENANT_ID = previousDefaultTenantId;
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

  test("a registered active domain is granted and gets ITS OWN tenant's results", async () => {
    if (!handlerReady) {
      return;
    }

    const { status, body, response } = await search(TOKEN_A, {
      origin: `https://${ACTIVE_HOST}`
    });

    expect(status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      `https://${ACTIVE_HOST}`
    );
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("vary")).toBe("Origin");
    // Search needs no cookie, so the grant must not be credentialed.
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();

    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.url).toBe("/blog/search-a/artikel-a");
  });

  test("the granted tenant is the ORIGIN's, not the deployment default's", async () => {
    if (!handlerReady) {
      return;
    }

    // Searching for a token that exists only in tenant B, from tenant A's
    // origin. A non-empty answer here means the request resolved to B — the
    // cross-tenant leak this design exists to prevent.
    const { body } = await search(TOKEN_B, {
      origin: `https://${ACTIVE_HOST}`
    });

    expect(body.data.items).toHaveLength(0);
  });

  test("an unknown origin is refused and is NOT handed the default tenant", async () => {
    if (!handlerReady) {
      return;
    }

    const { status, body, response } = await search(TOKEN_B, {
      origin: UNKNOWN_ORIGIN
    });

    expect(status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
    // The refusal is a REFUSAL, not merely an unreadable answer: the default
    // tenant's article never enters the response at all, so nothing is
    // disclosed to a caller that ignores CORS (curl, a proxy, a crawler).
    expect(body.data.items).toHaveLength(0);
    // ...and the shape is the neutral payload, identical to "no results".
    expect(body.data.facets).toEqual({ resourceTypes: [], terms: {} });
    expect(body.data.query).toBe("");
  });

  test("a pending_verification domain is refused", async () => {
    if (!handlerReady) {
      return;
    }

    // The allow-list is the VERIFIED set. A tenant that has merely CLAIMED a
    // hostname must not be able to open a cross-origin read with it.
    const { body, response } = await search(TOKEN_A, {
      origin: `https://${PENDING_HOST}`
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(body.data.items).toHaveLength(0);
  });

  test("suggest follows the same rule, on the same allow-list", async () => {
    if (!handlerReady) {
      return;
    }

    const granted = await invoke<{
      success: boolean;
      data: { items: { title: string }[] };
    }>(searchSuggestGET, {
      method: "GET",
      path: `${SUGGEST_PATH}?q=${TOKEN_A.slice(0, 6)}`,
      headers: { origin: `https://${ACTIVE_HOST}` }
    });

    expect(granted.response.headers.get("access-control-allow-origin")).toBe(
      `https://${ACTIVE_HOST}`
    );
    expect(granted.body.data.items.length).toBeGreaterThan(0);

    const refused = await invoke<{
      success: boolean;
      data: { items: { title: string }[] };
    }>(searchSuggestGET, {
      method: "GET",
      path: `${SUGGEST_PATH}?q=${TOKEN_B.slice(0, 6)}`,
      headers: { origin: UNKNOWN_ORIGIN }
    });

    expect(
      refused.response.headers.get("access-control-allow-origin")
    ).toBeNull();
    expect(refused.body.data.items).toHaveLength(0);
  });

  test("a same-origin request keeps the host path and gets no grant header", async () => {
    if (!handlerReady) {
      return;
    }

    // No `Origin` header: a plain navigation, `curl`, or this repo's own
    // `/search` page. It resolves through the unchanged host chain — which here
    // means the default tenant, B — and carries no CORS grant.
    const { body, response } = await search(TOKEN_B);

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.url).toBe("/blog/search-b/artikel-b");
  });
});
