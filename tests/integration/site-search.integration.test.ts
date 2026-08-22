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
import { countSearchFacets } from "../../src/modules/site-search/application/search-service";
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

/**
 * Issue #633 — the vocabulary rows a term facet joins. Inserted through the
 * ADMIN connection like every other fixture here, so the descriptor's own join
 * (which runs as the app/worker role) is the thing under test rather than the
 * seeding.
 */
async function insertTerm(
  tenantId: string,
  taxonomyType: string,
  slug: string,
  name: string
): Promise<string> {
  const id = crypto.randomUUID();
  await getAdminSql()`
    INSERT INTO awcms_blog_terms
      (id, tenant_id, taxonomy_type, name, slug, created_at, updated_at)
    VALUES (${id}, ${tenantId}, ${taxonomyType}, ${name}, ${slug}, now(), now())
  `;
  return id;
}

async function linkPostTerm(
  tenantId: string,
  postId: string,
  termId: string
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_blog_post_terms (tenant_id, post_id, term_id)
    VALUES (${tenantId}, ${postId}, ${termId})
  `;
}

async function insertInstitution(
  tenantId: string,
  slug: string,
  name: string
): Promise<string> {
  const id = crypto.randomUUID();
  await getAdminSql()`
    INSERT INTO awcms_blog_institutions
      (id, tenant_id, branch, name, slug, created_at, updated_at)
    VALUES (${id}, ${tenantId}, 'legislative', ${name}, ${slug}, now(), now())
  `;
  return id;
}

async function linkPostInstitution(
  tenantId: string,
  postId: string,
  institutionId: string
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_blog_post_institutions (tenant_id, post_id, institution_id)
    VALUES (${tenantId}, ${postId}, ${institutionId})
  `;
}

async function setRegion(postId: string, regionCode: string): Promise<void> {
  await getAdminSql()`
    UPDATE awcms_blog_posts SET region_code = ${regionCode} WHERE id = ${postId}
  `;
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

  describe("facet counts (Issue #607)", () => {
    test("count the whole matching set, and are NOT narrowed by the type filter", async () => {
      await insertPost(TENANT_A, {
        title: "Kalteng flood one",
        body: "banjir kalteng",
        slug: "flood-1"
      });
      await insertPost(TENANT_A, {
        title: "Kalteng flood two",
        body: "banjir kalteng",
        slug: "flood-2"
      });
      await insertPost(TENANT_A, {
        title: "Unrelated aardvark",
        body: "nothing to do with it",
        slug: "other"
      });

      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
      );

      const facets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, { query: "kalteng", locale: "en" })
      );

      expect(facets.resourceTypes).toEqual([{ value: "blog_post", count: 2 }]);
    });

    test("a query matching nothing yields no facet values, not a zero row", async () => {
      await insertPost(TENANT_A, {
        title: "Something",
        body: "body",
        slug: "s"
      });
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
      );

      const facets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, {
          query: "zzzzunmatchable",
          locale: "en"
        })
      );

      expect(facets.resourceTypes).toEqual([]);
    });

    test("a facet count NEVER includes another tenant's rows", async () => {
      // The negative assertion Issue #607 asks for by name. A COUNT leaks the
      // existence of content without displaying it, so a facet that escaped its
      // tenant would be a disclosure with nothing on screen to notice it by.
      await insertPost(TENANT_A, {
        title: "Shared keyword aardvark",
        body: "a body",
        slug: "a"
      });
      await insertPost(TENANT_B, {
        title: "Shared keyword aardvark",
        body: "b body",
        slug: "b1"
      });
      await insertPost(TENANT_B, {
        title: "Shared keyword aardvark again",
        body: "b body",
        slug: "b2"
      });

      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
      );
      await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_B, SOURCES)
      );

      const aFacets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, { query: "aardvark", locale: "en" })
      );
      const bFacets = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        countSearchFacets(tx, TENANT_B, { query: "aardvark", locale: "en" })
      );

      // Non-vacuous in both directions: B really does hold more than A, so a
      // count that leaked would be visibly wrong rather than coincidentally
      // equal.
      expect(aFacets.resourceTypes).toEqual([{ value: "blog_post", count: 1 }]);
      expect(bFacets.resourceTypes).toEqual([{ value: "blog_post", count: 2 }]);
    });

    test("the admitted-type allow-list bounds the facets too", async () => {
      await insertPost(TENANT_A, {
        title: "Allowed aardvark",
        body: "body",
        slug: "a"
      });
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
      );

      // A type the tenant has not admitted must not be counted — otherwise the
      // facet advertises a document the result query would refuse to return.
      const facets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, {
          query: "aardvark",
          locale: "en",
          enabledResourceTypes: ["blog_page"]
        })
      );

      expect(facets.resourceTypes).toEqual([]);
    });
  });

  describe("term facets (Issue #633)", () => {
    /**
     * Seeds one tenant with a shape that exercises all three facet mechanisms
     * at once: a shared vocabulary table split by `taxonomy_type` (channel vs
     * topic), a separate entity table reached through its own link table
     * (institution), and a plain column on the source row (region).
     */
    async function seedFacetedPosts(tenantId: string): Promise<void> {
      const politik = await insertTerm(
        tenantId,
        "channel",
        "politik",
        "Politik"
      );
      const ekonomi = await insertTerm(
        tenantId,
        "channel",
        "ekonomi",
        "Ekonomi"
      );
      const pemilu = await insertTerm(tenantId, "topic", "pemilu", "Pemilu");
      const dprd = await insertInstitution(
        tenantId,
        "dprd-kobar",
        "DPRD Kobar"
      );

      const first = await insertPost(tenantId, {
        title: "Banjir kalteng satu",
        body: "kalteng banjir",
        slug: "banjir-1"
      });
      const second = await insertPost(tenantId, {
        title: "Banjir kalteng dua",
        body: "kalteng banjir",
        slug: "banjir-2"
      });
      const third = await insertPost(tenantId, {
        title: "Anggaran kalteng",
        body: "kalteng anggaran",
        slug: "anggaran"
      });

      await linkPostTerm(tenantId, first, politik);
      await linkPostTerm(tenantId, first, pemilu);
      await linkPostTerm(tenantId, second, politik);
      await linkPostTerm(tenantId, third, ekonomi);
      await linkPostInstitution(tenantId, first, dprd);
      await setRegion(first, "62.71");
      await setRegion(second, "62.71");
      await setRegion(third, "62.02");

      await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
        reconcileTenantSearchIndex(tx, tenantId, SOURCES)
      );
    }

    test("channel, topic, institution and region are all counted", async () => {
      await seedFacetedPosts(TENANT_A);

      const facets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, { query: "kalteng", locale: "en" })
      );

      expect(facets.terms.channel).toEqual([
        { value: "politik", label: "Politik", count: 2 },
        { value: "ekonomi", label: "Ekonomi", count: 1 }
      ]);
      expect(facets.terms.topic).toEqual([
        { value: "pemilu", label: "Pemilu", count: 1 }
      ]);
      expect(facets.terms.institution).toEqual([
        { value: "dprd-kobar", label: "DPRD Kobar", count: 1 }
      ]);
      // A column facet with no label column: the code is its own label, which
      // is honest about what the source actually stored.
      expect(facets.terms.region).toEqual([
        { value: "62.71", label: "62.71", count: 2 },
        { value: "62.02", label: "62.02", count: 1 }
      ]);
    });

    test("a facet is NOT narrowed by its own filter, but IS by the others", async () => {
      await seedFacetedPosts(TENANT_A);

      const facets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, {
          query: "kalteng",
          locale: "en",
          termFilters: { channel: "politik" }
        })
      );

      // The channel list is unchanged — this is the whole rule. A reader who
      // picked "Politik" must still be able to see that "Ekonomi" exists and
      // click back to it; a list showing only their current selection is a
      // one-way door.
      expect(facets.terms.channel).toEqual([
        { value: "politik", label: "Politik", count: 2 },
        { value: "ekonomi", label: "Ekonomi", count: 1 }
      ]);

      // Region IS narrowed by the channel filter: both `politik` posts are in
      // 62.71, and 62.02 (the `ekonomi` post) has dropped out. That is the
      // other half of the rule, and it is what makes the remaining counts true
      // of the list the reader is actually looking at.
      expect(facets.terms.region).toEqual([
        { value: "62.71", label: "62.71", count: 2 }
      ]);
    });

    test("filtering by a term actually narrows the RESULTS, not just the counts", async () => {
      await seedFacetedPosts(TENANT_A);

      const filtered = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT_A,
        (tx) =>
          searchSiteContent(tx, TENANT_A, {
            query: "kalteng",
            locale: "en",
            termFilters: { channel: "ekonomi" },
            limit: 10
          })
      );

      expect(filtered.items.map((i) => i.url)).toEqual([
        "/blog/tenant-a/anggaran"
      ]);
    });

    test("two filters mean BOTH, not either", async () => {
      await seedFacetedPosts(TENANT_A);

      const both = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        searchSiteContent(tx, TENANT_A, {
          query: "kalteng",
          locale: "en",
          termFilters: { channel: "politik", topic: "pemilu" },
          limit: 10
        })
      );

      // Only the first post carries both. If containment were ever swapped for
      // an OR, this would return two — and a reader narrowing twice would watch
      // the list grow.
      expect(both.items).toHaveLength(1);
      expect(both.items[0]!.url).toBe("/blog/tenant-a/banjir-1");
    });

    test("a soft-deleted term disappears from the facet on the next reconcile", async () => {
      await seedFacetedPosts(TENANT_A);

      await getAdminSql()`
        UPDATE awcms_blog_terms SET deleted_at = now() WHERE slug = 'politik'
      `;
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
      );

      const facets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, { query: "kalteng", locale: "en" })
      );

      // Proves two things at once: `valueNullColumns` is really applied, and
      // the checksum notices a change that touched no column of the post
      // itself. Without the facets in the checksum this reconcile would report
      // "unchanged" and the deleted channel would keep being offered.
      expect(facets.terms.channel).toEqual([
        { value: "ekonomi", label: "Ekonomi", count: 1 }
      ]);
    });

    test("a term facet NEVER counts another tenant's rows", async () => {
      // The term facets get their OWN negative rather than inheriting the type
      // facet's. A join is the one place a row from another tenant can be
      // reached without the outer predicate noticing, and a COUNT discloses the
      // existence of content with nothing on screen to notice it by.
      await seedFacetedPosts(TENANT_A);

      const shared = await insertTerm(
        TENANT_B,
        "channel",
        "politik",
        "Politik"
      );
      const bPost = await insertPost(TENANT_B, {
        title: "Kalteng tenant b",
        body: "kalteng lain",
        slug: "b-post"
      });
      await linkPostTerm(TENANT_B, bPost, shared);
      await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_B, SOURCES)
      );

      const aFacets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, { query: "kalteng", locale: "en" })
      );
      const bFacets = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        countSearchFacets(tx, TENANT_B, { query: "kalteng", locale: "en" })
      );

      // Both tenants use the slug `politik`. If either count included the
      // other's rows it would read 3 here.
      expect(aFacets.terms.channel).toEqual([
        { value: "politik", label: "Politik", count: 2 },
        { value: "ekonomi", label: "Ekonomi", count: 1 }
      ]);
      expect(bFacets.terms.channel).toEqual([
        { value: "politik", label: "Politik", count: 1 }
      ]);
    });

    test("a facet with nothing matching is absent, not present-and-empty", async () => {
      await seedFacetedPosts(TENANT_A);

      const facets = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        countSearchFacets(tx, TENANT_A, { query: "aardvark", locale: "en" })
      );

      expect(facets.terms).toEqual({});
    });
  });
  /**
   * Finding D5 of the 17 August 2026 audit round — a reconcile that reported
   * `failures=0` while a whole source had stopped indexing.
   *
   * `failureCount` sums the per-DOCUMENT failures recorded on each
   * `SourceReconcileResult`. A source whose reconcile THREW never reached
   * `results.push`, so it contributed nothing to that sum, and the `break`
   * meant every source after it was never attempted either. The engine
   * returned `status: "failed"`; the script summing the number never looked at
   * it. `site-search:reconcile complete … failures=0`, exit 0, and public
   * search silently frozen for that source.
   *
   * The source used here fails inside `buildExtractionQuery`'s identifier
   * assertion, which runs BEFORE any SQL — so the transaction stays healthy and
   * `finalizeRun` still commits the run row. That is the reachable half of the
   * finding. The other half, a source that fails on a DATABASE error, aborts
   * the transaction, takes `finalizeRun` down with it and rejects out of the
   * call entirely; that was always loud, and `scripts/site-search-reconcile.ts`
   * now catches it per tenant rather than abandoning the rest of the run.
   */
  describe("a source that dies is NAMED, not averaged into failures=0 (D5)", () => {
    const BROKEN = {
      key: "test_broken.source",
      ownerModuleKey: "test_broken",
      resourceType: "broken",
      tableName: "awcms_blog_posts",
      localeColumn: "locale",
      updatedAtColumn: "updated_at",
      // Rejected by `assertSafeIdentifier` — a plain JS throw, before a single
      // statement is sent.
      titleColumn: "title; DROP TABLE awcms_blog_posts",
      bodyColumns: ["content_text"],
      slugColumn: "slug",
      urlTemplate: "/blog/:tenantCode/:slug",
      publicPredicateSql: "status = 'published'"
    } as unknown as (typeof SOURCES)[number];

    test("the run reports WHICH source failed and which were never attempted", async () => {
      await insertPost(TENANT_A, {
        title: "Indexable one",
        body: "indexable body",
        slug: "indexable"
      });

      const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_A, [BROKEN, ...SOURCES])
      );

      expect(result.status).toBe("failed");
      // The number the operator used to read. It is STILL zero — no document
      // failed to map or upsert — which is exactly why it could never have
      // carried this fact and why the fix is a separate field rather than a
      // bigger count.
      expect(result.failureCount).toBe(0);
      expect(result.failedSources).toEqual([BROKEN.key]);
      expect(result.unattemptedSources).toEqual(SOURCES.map((s) => s.key));
      expect(result.lastError).toContain("unsafe titleColumn identifier");
    });

    test("sources that DID run are still reported, and their documents indexed", async () => {
      // Ordering flipped: the real sources run first, the broken one last. The
      // engine must report both halves — what succeeded and what did not — not
      // collapse the run to a single verdict.
      await insertPost(TENANT_A, {
        title: "Alpha bright fox",
        body: "fox body",
        slug: "alpha"
      });

      const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_A, [...SOURCES, BROKEN])
      );

      expect(result.status).toBe("failed");
      expect(result.results).toHaveLength(SOURCES.length);
      expect(result.totalIndexed).toBe(1);
      expect(result.failedSources).toEqual([BROKEN.key]);
      // Nothing came after it, so nothing was abandoned.
      expect(result.unattemptedSources).toEqual([]);

      // The run row COMMITTED: this failure path leaves the transaction usable,
      // which is what makes the misreported result observable at all.
      const runs = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        fetchRecentRuns(tx, TENANT_A, 1)
      );
      expect(runs[0]!.status).toBe("failed");
      expect(Number(runs[0]!.failureCount)).toBe(0);
    });

    test("a clean run names nothing — the fields are not always-populated noise", async () => {
      await insertPost(TENANT_A, {
        title: "Clean run",
        body: "clean body",
        slug: "clean"
      });

      const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        reconcileTenantSearchIndex(tx, TENANT_A, SOURCES)
      );

      expect(result.status).toBe("succeeded");
      expect(result.failedSources).toEqual([]);
      expect(result.unattemptedSources).toEqual([]);
    });
  });
});
