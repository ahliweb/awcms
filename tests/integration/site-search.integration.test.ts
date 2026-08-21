/**
 * Integration tests for `site_search` (ADR-0040, migrations sql/064 + sql/065)
 * against a real PostgreSQL under the ephemeral-database harness. These prove
 * exactly the claims a typecheck and a text-level drift guard cannot:
 *
 *   1. **Publication state is enforced at the source→index boundary** — a
 *      draft/private/soft-deleted/future-dated post is never even read INTO the
 *      index, so it can never surface as a public result.
 *   2. **No stale leakage** — unpublishing at the source and re-reconciling
 *      removes the document; a subsequent public query returns nothing.
 *   3. **Reconcile/rebuild are deterministic and idempotent** — a third run with
 *      no source change reports every document `unchanged` (checksum-gated skip)
 *      and matches the source count.
 *   4. **Tenant and locale isolation hold under the real runtime role** —
 *      including a raw cross-tenant SELECT of the index table, which RLS FORCE
 *      must reduce to this tenant's rows only.
 *   5. **XSS and SQL injection** — a post whose body contains a `<script>` tag
 *      yields a snippet containing only our own `<mark>` tags, and a query that
 *      is a SQL fragment runs harmlessly as a bound parameter.
 *
 * Skipped unless a real database is configured (see tests/integration/harness.ts).
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { getRegisteredSearchSources } from "../../src/modules/site-search/presentation/search-sources";
import {
  rebuildTenantSearchIndex,
  reconcileTenantSearchIndex,
  reindexSearchResource
} from "../../src/modules/site-search/application/search-index-engine";
import {
  decodeSearchCursor,
  searchSiteContent,
  suggestSiteContent
} from "../../src/modules/site-search/application/search-service";
import {
  fetchIndexStatus,
  fetchRecentRuns
} from "../../src/modules/site-search/application/search-diagnostics";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTHOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const SOURCES = getRegisteredSearchSources();

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT_A}, 'tenant-a', 'Tenant A', 'active'),
      (${TENANT_B}, 'tenant-b', 'Tenant B', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

type PostSeed = {
  title: string;
  body: string;
  slug: string;
  status?: string;
  visibility?: string;
  locale?: string;
  publishedAt?: Date | null;
  deletedAt?: Date | null;
};

async function insertPost(tenantId: string, seed: PostSeed): Promise<string> {
  const id = crypto.randomUUID();
  await getAdminSql()`
    INSERT INTO awcms_blog_posts
      (id, tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, published_at, deleted_at, created_at, updated_at)
    VALUES (
      ${id}, ${tenantId}, ${AUTHOR}, ${seed.title}, ${seed.slug}, '{}'::jsonb, ${seed.body},
      ${seed.status ?? "published"}, ${seed.visibility ?? "public"}, ${seed.locale ?? "en"},
      ${seed.publishedAt === undefined ? new Date("2026-01-01T00:00:00Z") : seed.publishedAt},
      ${seed.deletedAt ?? null}, now(), now()
    )
  `;
  return id;
}

async function docCount(tenantId: string): Promise<number> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const rows = (await tx`
      SELECT count(*)::int AS count FROM awcms_site_search_documents
    `) as { count: number }[];
    return rows[0]!.count;
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("site_search module (integration, ADR-0040)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedTenants();
  });

  test("the base registry contributes exactly the two blog_content sources", () => {
    // Pages joined in Issue #625, once `sql/136` gave `awcms_worker` the SELECT
    // the reconcile job needs. Pinned as an exact list on purpose: a source
    // appearing here without anyone noticing means a table is being read by a
    // 03:00 job, and the shape of that mistake is a `permission denied` nobody
    // is awake for.
    expect(SOURCES.map((s) => s.key)).toEqual([
      "blog_content.post",
      "blog_content.page"
    ]);
  });

  test("awcms_worker can actually SELECT every table those sources name", async () => {
    // `site-search:sources:check` proves the GRANT was WRITTEN. This proves it
    // was APPLIED — against a real Postgres with the real migrations, which is
    // the difference between a green gate and a job that runs at 03:00.
    const sql = getAdminSql();
    const tables = [...new Set(SOURCES.map((source) => source.tableName))];

    const grants = (await sql.unsafe(`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'awcms_worker'
        AND table_name IN (${tables.map((table) => `'${table}'`).join(", ")})
    `)) as { table_name: string; privilege_type: string }[];

    for (const table of tables) {
      expect(
        grants.some(
          (grant) =>
            grant.table_name === table && grant.privilege_type === "SELECT"
        )
      ).toBe(true);
    }

    // And SELECT only on pages: the indexer never writes a source, and an
    // unused UPDATE on the table holding the Pedoman Media Siber is not a
    // harmless extra.
    expect(
      grants
        .filter((grant) => grant.table_name === "awcms_blog_pages")
        .map((grant) => grant.privilege_type)
    ).toEqual(["SELECT"]);
  });

  test("reconcile indexes ONLY published-public posts (publication filter at the source boundary)", async () => {
    await insertPost(TENANT_A, {
      title: "Alpha bright fox",
      body: "the quick brown fox",
      slug: "alpha"
    });
    await insertPost(TENANT_A, {
      title: "Draft hidden",
      body: "secret draft body",
      slug: "draft",
      status: "draft"
    });
    await insertPost(TENANT_A, {
      title: "Private one",
      body: "private body",
      slug: "priv",
      visibility: "private"
    });
    await insertPost(TENANT_A, {
      title: "Deleted one",
      body: "deleted body",
      slug: "del",
      deletedAt: new Date()
    });
    await insertPost(TENANT_A, {
      title: "Future one",
      body: "future body",
      slug: "fut",
      publishedAt: new Date(Date.now() + 86_400_000)
    });

    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );

    expect(await docCount(TENANT_A)).toBe(1);
    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, { query: "fox", locale: "en", limit: 20 })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBe("Alpha bright fox");
    // The public URL is path-tenant-scoped (ADR-0009) with a server-resolved
    // tenant_code, not the awcms-micro host-resolved /news/:slug.
    expect(result.items[0]!.url).toBe("/blog/tenant-a/alpha");
  });

  test("a draft body's distinctive word is unreachable through search", async () => {
    await insertPost(TENANT_A, {
      title: "Draft hidden",
      body: "unpublishedwombat appears only in the draft",
      slug: "draft",
      status: "draft"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "unpublishedwombat",
        locale: "en",
        limit: 20
      })
    );
    expect(result.items).toHaveLength(0);
  });

  test("unpublish + reconcile removes the document with NO stale leakage", async () => {
    const id = await insertPost(TENANT_A, {
      title: "Removable panther",
      body: "panther body",
      slug: "rem"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    expect(await docCount(TENANT_A)).toBe(1);

    await getAdminSql()`
      UPDATE awcms_blog_posts SET status = 'draft', updated_at = now() WHERE id = ${id}
    `;
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    expect(await docCount(TENANT_A)).toBe(0);

    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "panther",
        locale: "en",
        limit: 20
      })
    );
    expect(result.items).toHaveLength(0);
  });

  test("reindexSearchResource: publish indexes one; archive removes it", async () => {
    const id = await insertPost(TENANT_A, {
      title: "Single lynx",
      body: "lynx body",
      slug: "lynx"
    });
    const first = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reindexSearchResource(tx, TENANT_A, SOURCES[0]!, id)
    );
    expect(first).toBe("indexed");
    expect(await docCount(TENANT_A)).toBe(1);

    await getAdminSql()`
      UPDATE awcms_blog_posts SET status = 'archived', updated_at = now() WHERE id = ${id}
    `;
    const second = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reindexSearchResource(tx, TENANT_A, SOURCES[0]!, id)
    );
    expect(second).toBe("removed");
    expect(await docCount(TENANT_A)).toBe(0);
  });

  test("rebuild is idempotent and reconcile matches source counts/checksums", async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertPost(TENANT_A, {
        title: `Post ${i} otter`,
        body: `body ${i}`,
        slug: `p-${i}`
      });
    }
    const first = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      rebuildTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    expect(first.status).toBe("succeeded");
    expect(first.results[0]!.sourceCount).toBe(5);
    expect(await docCount(TENANT_A)).toBe(5);

    // Rebuild again — end state identical regardless of prior state.
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      rebuildTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    expect(await docCount(TENANT_A)).toBe(5);

    // Reconcile a third time with no source change: every document unchanged.
    const third = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    expect(third.results[0]!.unchanged).toBe(5);
    expect(third.results[0]!.added).toBe(0);
    expect(third.results[0]!.updated).toBe(0);
    expect(third.results[0]!.removed).toBe(0);
  });

  test("an edited title re-indexes as `updated`, not as a duplicate document", async () => {
    const id = await insertPost(TENANT_A, {
      title: "Original marmot",
      body: "marmot body",
      slug: "marmot"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    await getAdminSql()`
      UPDATE awcms_blog_posts SET title = 'Renamed marmot', updated_at = now() WHERE id = ${id}
    `;
    const run = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    expect(run.results[0]!.updated).toBe(1);
    expect(run.results[0]!.added).toBe(0);
    expect(await docCount(TENANT_A)).toBe(1);
  });

  test("cross-tenant isolation: tenant A never sees tenant B content (RLS FORCE + predicate)", async () => {
    await insertPost(TENANT_A, {
      title: "Shared keyword aardvark",
      body: "a body",
      slug: "a"
    });
    await insertPost(TENANT_B, {
      title: "Shared keyword aardvark",
      body: "b body",
      slug: "b"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_B, SOURCES)
    );

    const aResult = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "aardvark",
        locale: "en",
        limit: 20
      })
    );
    expect(aResult.items).toHaveLength(1);
    expect(aResult.items[0]!.url).toBe("/blog/tenant-a/a");

    // RLS also blocks a RAW cross-tenant read of the index table — the query
    // below has no tenant predicate at all.
    const visible = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_A,
      async (tx) => {
        const rows = (await tx`
        SELECT count(*)::int AS c FROM awcms_site_search_documents
      `) as { c: number }[];
        return rows[0]!.c;
      }
    );
    expect(visible).toBe(1);
  });

  test("cross-locale isolation: an EN query never returns an ID-locale document", async () => {
    await insertPost(TENANT_A, {
      title: "Kucing lucu",
      body: "kucing body",
      slug: "id-cat",
      locale: "id"
    });
    await insertPost(TENANT_A, {
      title: "Funny cat",
      body: "cat body",
      slug: "en-cat",
      locale: "en"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );

    const enResult = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "kucing",
        locale: "en",
        limit: 20
      })
    );
    expect(enResult.items).toHaveLength(0);

    const idResult = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "kucing",
        locale: "id",
        limit: 20
      })
    );
    expect(idResult.items).toHaveLength(1);
  });

  test("XSS: a post body containing a script tag yields an ESCAPED snippet", async () => {
    await insertPost(TENANT_A, {
      title: "Injection test wolverine",
      body: "hello <script>alert(document.cookie)</script> wolverine world",
      slug: "xss"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "wolverine",
        locale: "en",
        limit: 20
      })
    );
    expect(result.items).toHaveLength(1);
    const snippet = result.items[0]!.snippet;
    // Whether ts_headline's parser dropped the tag tokens or renderSafeSnippet
    // escaped them, the ONLY tags that can appear are our own <mark>/</mark>.
    expect(snippet).not.toContain("<script");
    const tags = snippet.match(/<[^>]+>/g) ?? [];
    expect(tags.every((t) => t === "<mark>" || t === "</mark>")).toBe(true);
  });

  test("SQL injection: a malicious query string is safely parameterized", async () => {
    await insertPost(TENANT_A, {
      title: "Benign gopher",
      body: "gopher body",
      slug: "g"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "gopher'; DROP TABLE awcms_site_search_documents; --",
        locale: "en",
        limit: 20
      })
    );
    // The table still exists and the query ran as a bound parameter.
    expect(await docCount(TENANT_A)).toBe(1);
    expect(Array.isArray(result.items)).toBe(true);
  });

  test("suggest returns trigram title matches, tenant-scoped", async () => {
    await insertPost(TENANT_A, {
      title: "Chameleon guide",
      body: "guide body",
      slug: "cham"
    });
    await insertPost(TENANT_B, {
      title: "Chameleon secret",
      body: "secret",
      slug: "cham-b"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );
    await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_B, SOURCES)
    );

    const suggestions = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_A,
      (tx) =>
        suggestSiteContent(tx, TENANT_A, {
          query: "chamele",
          locale: "en",
          limit: 8
        })
    );
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.every((s) => s.title.includes("Chameleon"))).toBe(true);
    expect(suggestions.some((s) => s.title === "Chameleon secret")).toBe(false);
  });

  test("admitted-type filter restricts results (the text[] bind path)", async () => {
    await insertPost(TENANT_A, {
      title: "Typed capybara",
      body: "capybara body",
      slug: "cap"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );

    const included = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "capybara",
        locale: "en",
        enabledResourceTypes: ["blog_post"],
        limit: 20
      })
    );
    expect(included.items).toHaveLength(1);

    const excluded = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      searchSiteContent(tx, TENANT_A, {
        query: "capybara",
        locale: "en",
        enabledResourceTypes: ["some_other_type"],
        limit: 20
      })
    );
    expect(excluded.items).toHaveLength(0);
  });

  test("keyset pagination walks the whole result set exactly once", async () => {
    for (let i = 0; i < 5; i += 1) {
      await insertPost(TENANT_A, {
        title: `Numbat number ${i}`,
        body: "numbat body",
        slug: `nb-${i}`
      });
    }
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      // The cursor is opaque to callers; a real client round-trips the string
      // through the query param, which is exactly what decodeSearchCursor does.
      const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        searchSiteContent(tx, TENANT_A, {
          query: "numbat",
          locale: "en",
          limit: 2,
          cursor: decodeSearchCursor(cursor)
        })
      );
      seen.push(...result.items.map((i) => i.resourceId));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  test("index status + run ledger reflect the reconcile that just ran", async () => {
    await insertPost(TENANT_A, {
      title: "Ledger quokka",
      body: "quokka body",
      slug: "quokka"
    });
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      reconcileTenantSearchIndex(tx, TENANT_A, SOURCES, {
        trigger: "scheduled"
      })
    );

    const status = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      fetchIndexStatus(tx, TENANT_A)
    );
    expect(status.documentCount).toBe(1);
    expect(status.byResourceType).toEqual([
      { resourceType: "blog_post", count: 1 }
    ]);
    expect(status.openFailureCount).toBe(0);
    expect(status.lastRun?.status).toBe("succeeded");
    expect(status.lastRun?.trigger).toBe("scheduled");
    expect(status.latestIndexedAt).not.toBeNull();

    const runs = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      fetchRecentRuns(tx, TENANT_A, 10)
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.runType).toBe("reconcile");
    expect(runs[0]!.documentsIndexed).toBe(1);
    expect(runs[0]!.finishedAt).not.toBeNull();
  });
});
