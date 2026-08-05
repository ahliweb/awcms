/**
 * Query budgets on the heaviest ADMIN read paths and the SITEMAP builder —
 * closing gap C5 of the second-pass assessment (the first budget file,
 * `query-budget.integration.test.ts`, covers only the public blog read paths;
 * its header explains why a count is the only cheap probe for an N+1 and why
 * every fixture seeds MORE rows than the budget allows — all of that applies
 * here unchanged).
 *
 * ## Which paths, and why these
 *
 * Every `src/pages/admin/*.astro` screen was read and ranked by the number of
 * read functions it calls inside its `withTenantOrThrow`:
 *
 * - **`/admin` (index.astro)** calls FOUR report functions — tenant activity,
 *   access/audit, sync health, module usage — 15 queries across nine tables.
 *   It is the heaviest admin read path in the repo, and the one page every
 *   admin lands on first, so a regression here is paid on every session.
 * - **`/admin/blog` (blog.astro)** calls TWO — `listBlogPostsForAdmin` plus a
 *   conditional `listBlogRevisions` — and is the daily editorial surface of
 *   the largest module. Its list renders up to 20 rows and its revision panel
 *   up to 20 more, so a per-row query would land at 20+ immediately.
 * - Every OTHER admin screen (including `/admin/media`'s keyset browse) calls
 *   ONE read function issuing one or two queries. A budget there would restate
 *   that single function's shape rather than guard an aggregation, so they are
 *   deliberately not budgeted.
 *
 * The **sitemap builder** (`seo_distribution`'s discovery aggregator) is the
 * other classic N+1 shape in this repo: it aggregates cross-module content
 * through injected `seo_facts` providers and resolves media per batch. It is
 * public, unauthenticated, and rebuilt on every edge-cache MISS.
 *
 * ## Budgets are set at the measured ACTUAL, not actual-plus-headroom
 *
 * Each ceiling below equals the exact count the implementation issues today
 * (breakdowns in the per-test comments). That is deliberate: a query budget
 * exists to catch regressions, and headroom is exactly the space a small
 * regression hides in. Even a +1 — one extra probe per request on the most
 * visited admin page — fails the test and has to be argued in review.
 * Tightening after an implementation improves is welcome; loosening must be
 * an argued change.
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
import { countQueries } from "./query-budget";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { fetchTenantActivityReport } from "../../src/modules/reporting/application/tenant-activity-report";
import { fetchAccessAuditReport } from "../../src/modules/reporting/application/access-audit-report";
import { fetchSyncHealthReport } from "../../src/modules/reporting/application/sync-health-report";
import { fetchModuleUsageReport } from "../../src/modules/reporting/application/module-usage-report";
import { listBlogPostsForAdmin } from "../../src/modules/blog-content/application/blog-post-directory";
import { listBlogRevisions } from "../../src/modules/blog-content/application/blog-revision-directory";
import { createBlogContentSeoFactsAdapter } from "../../src/modules/blog-content/application/seo-facts-port-adapter";
import {
  buildSitemapIndexPayload,
  buildSitemapPagePayload,
  type SeoDiscoveryContext
} from "../../src/modules/seo-distribution/application/seo-discovery-service";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** Fixed HISTORICAL instant (not a "now" anchor — those must come from the DB). */
const PUBLISHED_AT = new Date("2026-06-01T00:00:00.000Z");
/** Injected render clock for the sitemap builder — any instant after PUBLISHED_AT. */
const RENDER_NOW = new Date("2026-07-24T00:00:00.000Z");

/**
 * Comfortably more than any budget below, so per-item work cannot hide: with a
 * budget set at the actual, even ONE extra query fails, but 40 rows also makes
 * a full-blown per-row implementation land at 40+, unmistakably.
 */
const SEEDED_POSTS = 40;
const SEEDED_ROWS = 40;
const SEEDED_SYNC_NODES = 6;
const QUEUE_ROWS_PER_NODE = 4;
/** More than `listBlogRevisions`'s default limit of 20, so the limit is exercised. */
const SEEDED_REVISIONS = 30;

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration(
  "query budgets — heaviest admin screens + sitemap builder",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });

    afterAll(async () => {
      await teardownIntegrationDatabase();
    });

    beforeEach(async () => {
      await resetDatabase();

      const admin = getAdminSql();

      await admin`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
        VALUES (${TENANT}, 'budget', 'Budget Tenant', 'active')
        ON CONFLICT (id) DO NOTHING
      `;

      // One statement, many rows — `generate_series`, never a bound array and
      // never a loop, for the reasons `query-budget.integration.test.ts`
      // records (a seeding loop would itself be the N+1 this file catches, and
      // Bun.SQL interpolates `${array}` as comma-joined TEXT → 22P02).
      await admin`
        INSERT INTO awcms_blog_posts
          (tenant_id, author_tenant_user_id, title, slug, content_json,
           content_text, status, visibility, locale, published_at)
        SELECT ${TENANT}, ${ACTOR}, 'Post ' || n, 'post-' || n, '{}'::jsonb, 'body',
               'published', 'public', 'en', ${PUBLISHED_AT}
        FROM generate_series(1, ${SEEDED_POSTS}) AS n
      `;

      // Revisions for ONE post (the panel opens per post): more than the list
      // limit of 20, so per-revision work would add 30+ queries.
      await admin`
        INSERT INTO awcms_blog_revisions
          (tenant_id, resource_type, resource_id, revision_number, title,
           content_json, content_text, status, created_by_tenant_user_id)
        SELECT ${TENANT}, 'post', p.id, n, 'Rev ' || n, '{}'::jsonb, 'body',
               'draft', ${ACTOR}
        FROM awcms_blog_posts p, generate_series(1, ${SEEDED_REVISIONS}) AS n
        WHERE p.tenant_id = ${TENANT} AND p.slug = 'post-1'
      `;

      // ── Dashboard fixture — every table the four reports aggregate. ──────
      // Time anchors are DB-side (`now() - interval …`), never a JS clock: the
      // access-audit report windows on the DB's `now()`, and a JS-module-scope
      // `new Date()` is the documented fixture trap in this suite.
      await admin`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        SELECT ${TENANT}, 'person', 'Person ' || n
        FROM generate_series(1, ${SEEDED_ROWS}) AS n
      `;

      await admin`
        INSERT INTO awcms_identities
          (tenant_id, profile_id, login_identifier, password_hash, last_login_at)
        SELECT ${TENANT}, p.id, 'user-' || p.id, 'not-a-real-hash',
               now() - interval '1 hour'
        FROM awcms_profiles p
        WHERE p.tenant_id = ${TENANT}
      `;

      await admin`
        INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
        SELECT ${TENANT}, i.id, 'active'
        FROM awcms_identities i
        WHERE i.tenant_id = ${TENANT}
      `;

      await admin`
        INSERT INTO awcms_offices (tenant_id, office_code, office_name, status)
        SELECT ${TENANT}, 'office-' || n, 'Office ' || n, 'active'
        FROM generate_series(1, ${SEEDED_ROWS}) AS n
      `;

      // Half allow / half deny; `created_at` defaults to the DB's now(), which
      // keeps every row inside the report's 30-day window by construction.
      await admin`
        INSERT INTO awcms_abac_decision_logs
          (tenant_id, module_key, activity_code, action, decision, reason)
        SELECT ${TENANT}, 'blog_content', 'posts', 'read',
               CASE WHEN n % 2 = 0 THEN 'allow' ELSE 'deny' END,
               'query-budget fixture'
        FROM generate_series(1, ${SEEDED_ROWS}) AS n
      `;

      await admin`
        INSERT INTO awcms_audit_events
          (tenant_id, module_key, action, resource_type, message)
        SELECT ${TENANT}, 'blog_content', 'update', 'post',
               'query-budget fixture ' || n
        FROM generate_series(1, ${SEEDED_ROWS}) AS n
      `;

      await admin`
        INSERT INTO awcms_sync_nodes
          (tenant_id, node_code, node_name, status, last_pushed_at)
        SELECT ${TENANT}, 'node-' || n, 'Node ' || n,
               CASE WHEN n % 2 = 0 THEN 'active' ELSE 'inactive' END,
               now() - interval '1 hour'
        FROM generate_series(1, ${SEEDED_SYNC_NODES}) AS n
      `;

      await admin`
        INSERT INTO awcms_object_sync_queue
          (tenant_id, node_id, object_key, local_path, checksum_sha256,
           byte_size, requires_upload, status)
        SELECT ${TENANT}, sn.id, 'objects/' || sn.node_code || '/' || n,
               '/tmp/object-' || n, repeat('a', 64), 1024, true,
               CASE WHEN n % 2 = 0 THEN 'pending' ELSE 'failed' END
        FROM awcms_sync_nodes sn, generate_series(1, ${QUEUE_ROWS_PER_NODE}) AS n
        WHERE sn.tenant_id = ${TENANT}
      `;

      // ── Sitemap fixture — a verified primary domain, without which the
      // builders 404 (a sitemap <loc> must be absolute). ────────────────────
      await admin`
        INSERT INTO awcms_tenant_domains
          (tenant_id, hostname, normalized_hostname, domain_type, status, is_primary)
        VALUES (${TENANT}, 'budget.example', 'budget.example', 'custom_domain',
                'active', true)
      `;
    });

    // ── /admin — the dashboard ────────────────────────────────────────────

    test(`the admin dashboard aggregates its four reports in 15 queries across ${SEEDED_ROWS}-row fixtures`, async () => {
      // The exact workload index.astro runs inside ONE withTenantOrThrow,
      // awaited sequentially (concurrent queries on one tx connection leak it).
      //
      // Budget breakdown — 15 = 4 + 3 + 3 + 5:
      //   fetchTenantActivityReport  4 (tenant row, users, offices, last login)
      //   fetchAccessAuditReport     3 (windowed group-by, total, audit events)
      //   fetchSyncHealthReport      3 (nodes agg, conflicts, queue agg)
      //   fetchModuleUsageReport     5 (one metric each for tenant_admin,
      //                                 profile_identity, identity_access,
      //                                 sync_storage, reporting; the other
      //                                 registered modules define no metric)
      // A sixth module metric legitimately raises this by one — that is a
      // per-MODULE constant, and raising it is exactly the argued change this
      // ceiling exists to force.
      const { result, queries } = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT,
        async (tx) =>
          countQueries(tx, async (counting) => ({
            tenantActivity: await fetchTenantActivityReport(counting, TENANT),
            accessAudit: await fetchAccessAuditReport(counting, TENANT),
            syncHealth: await fetchSyncHealthReport(counting, TENANT),
            moduleUsage: await fetchModuleUsageReport(counting, TENANT)
          }))
      );

      // The fixture actually reached every aggregate — a budget over an empty
      // table proves nothing.
      expect(result.tenantActivity.activeUserCount).toBe(SEEDED_ROWS);
      expect(result.tenantActivity.activeOfficeCount).toBe(SEEDED_ROWS);
      expect(result.tenantActivity.mostRecentLoginAt).not.toBeNull();
      expect(result.accessAudit.allowCount).toBe(SEEDED_ROWS / 2);
      expect(result.accessAudit.denyCount).toBe(SEEDED_ROWS / 2);
      expect(result.accessAudit.totalDecisionCount).toBe(SEEDED_ROWS);
      expect(result.accessAudit.auditEventCount).toBe(SEEDED_ROWS);
      expect(result.syncHealth.totalNodeCount).toBe(SEEDED_SYNC_NODES);
      expect(result.syncHealth.activeNodeCount).toBe(SEEDED_SYNC_NODES / 2);
      expect(result.syncHealth.pendingObjectCount).toBe(
        (SEEDED_SYNC_NODES * QUEUE_ROWS_PER_NODE) / 2
      );
      expect(result.syncHealth.failedObjectCount).toBe(
        (SEEDED_SYNC_NODES * QUEUE_ROWS_PER_NODE) / 2
      );
      // Pins the ×5 term of the breakdown: if a module gains a metric, this
      // line and the budget fail TOGETHER, naming the reason.
      expect(
        result.moduleUsage.filter(
          (entry) => entry.metricLabel !== "No metric defined yet"
        ).length
      ).toBe(5);

      expect(queries).toBeLessThanOrEqual(15);
    });

    // ── /admin/blog — the editorial list ──────────────────────────────────

    test(`the admin blog list is constant-query across ${SEEDED_POSTS} posts`, async () => {
      // Budget breakdown — 2: the page window + the total count (the screen's
      // "page 1, 2, 3" controls need the total; both share one WHERE shape).
      const { result, queries } = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT,
        async (tx) =>
          countQueries(tx, (counting) =>
            listBlogPostsForAdmin(counting, TENANT, { page: 1 })
          )
      );

      expect(result.items.length).toBe(20);
      expect(result.total).toBe(SEEDED_POSTS);
      expect(queries).toBeLessThanOrEqual(2);
    });

    test("paging the admin blog list deeper does not cost more queries", async () => {
      // The quiet regression shape: an implementation that walks earlier pages
      // or re-resolves something per page stays correct and slows with depth.
      const countFor = async (page: number): Promise<number> =>
        (
          await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) =>
            countQueries(tx, (counting) =>
              listBlogPostsForAdmin(counting, TENANT, { page })
            )
          )
        ).queries;

      expect(await countFor(2)).toBe(await countFor(1));
    });

    test(`opening the revision panel adds exactly one query (${SEEDED_REVISIONS} revisions seeded)`, async () => {
      const postRows = (await getAdminSql()`
        SELECT id FROM awcms_blog_posts
        WHERE tenant_id = ${TENANT} AND slug = 'post-1'
      `) as { id: string }[];
      const postId = postRows[0]!.id;

      // The full `?post=<id>` page load blog.astro performs: list + one
      // bounded revision query for the ONE selected post. Budget 3 = 2 + 1.
      // Fetching revisions per ROW instead would cost 20+ queries — the exact
      // trade blog.astro's `?post=` comment records choosing against.
      const { result, queries } = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT,
        async (tx) =>
          countQueries(tx, async (counting) => {
            const listing = await listBlogPostsForAdmin(counting, TENANT, {
              page: 1
            });
            const revisions = await listBlogRevisions(
              counting,
              TENANT,
              "post",
              postId
            );
            return { listing, revisions };
          })
      );

      expect(result.listing.items.length).toBe(20);
      // 30 seeded, list limit 20 — the limit is exercised, not incidental.
      expect(result.revisions.length).toBe(20);
      expect(queries).toBeLessThanOrEqual(3);
    });

    // ── /sitemap.xml + /sitemap-{n}.xml — the discovery aggregator ────────

    /**
     * Providers wired exactly as the route composition root wires them for a
     * blog-enabled tenant (`seo-distribution.integration.test.ts` builds its
     * context the same way): the single declared `seo_facts` provider with the
     * path-based base path, no media port (the seeded posts carry no images,
     * so the media batch resolve is legitimately zero queries). The budgets
     * are therefore per-provider: a SECOND provider adds its own bounded
     * constant (an argued change), but per-ITEM work still blows through,
     * because 40 items dwarf any per-provider constant.
     */
    const discoveryCtx = (tx: Bun.SQL): SeoDiscoveryContext => ({
      tx,
      tenantId: TENANT,
      tenantDisplayName: "Budget Tenant",
      defaultLocale: "en",
      providers: [createBlogContentSeoFactsAdapter("/blog/budget")],
      mediaLibrary: null,
      now: RENDER_NOW
    });

    test(`the sitemap index builder is constant-query across ${SEEDED_POSTS} posts`, async () => {
      // Budget breakdown — 4 = loadBase 3 (settings, primary host, settings
      // updated_at) + summarizeAll 1 (the provider's single aggregate; the
      // index sizes itself from this roll-up, never from a full listing).
      const { result, queries } = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT,
        async (tx) =>
          countQueries(tx, (counting) =>
            buildSitemapIndexPayload(discoveryCtx(counting))
          )
      );

      expect(result).not.toBeNull();
      // 40 posts, 10 000 URLs per child page → exactly one child.
      expect(result!.body).toContain("/sitemap-1.xml");
      expect(result!.body).not.toContain("/sitemap-2.xml");
      expect(queries).toBeLessThanOrEqual(4);
    });

    test(`a sitemap child page is constant-query across ${SEEDED_POSTS} posts`, async () => {
      // Budget breakdown — 6 = loadBase 3 + summarizeAll 1 (page-count check)
      // + listWindow 2 (per-provider summary + ONE bounded window query) +
      // media resolve 0 (no image ids). The per-item shapes this ceiling
      // exists to catch: resolving each post's media individually, or paging
      // the provider row by row — either lands at 40+.
      const { result, queries } = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT,
        async (tx) =>
          countQueries(tx, (counting) =>
            buildSitemapPagePayload(discoveryCtx(counting), 1)
          )
      );

      expect(result).not.toBeNull();
      // Every seeded post is published+public → every one is in the urlset.
      expect((result!.body.match(/<loc>/g) ?? []).length).toBe(SEEDED_POSTS);
      expect(result!.body).toContain(
        "<loc>https://budget.example/blog/budget/post-1</loc>"
      );
      expect(queries).toBeLessThanOrEqual(6);
    });
  }
);
