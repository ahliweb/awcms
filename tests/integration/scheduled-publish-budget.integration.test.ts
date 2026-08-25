/**
 * A query budget on a JOB — the scheduled publish/unpublish sweeps.
 *
 * ## Why this file exists
 *
 * `post-term-assignment-budget.integration.test.ts` opened the write side of
 * the budget suites and said what it was leaving behind: nine more write paths
 * with a query per item, and one of them — this sweep — calling the per-post
 * `fetchPostTermIds` inside its loop, "bounded by how many posts are due in one
 * sweep, which at a cutover is not small".
 *
 * It was worse than a term fetch. Per due post the sweep issued: one term
 * fetch, one managed-media enforcement read PER checklist evaluation (and it
 * evaluates twice), one media resolve per evaluation, one `UPDATE`, one edge
 * cache purge enqueue, and one audit `INSERT`. At the batch bound of 200 that
 * is well over a thousand round trips on the ONE reserved `maintenance`
 * connection the job holds — and the job runs it for EVERY active tenant, in
 * sequence.
 *
 * Nothing in it was per-post except the verdict.
 *
 * ## Measured, not estimated
 *
 * Every budget below was first run against the previous implementation, which
 * is how the numbers in the second column were obtained:
 *
 * | Sweep (12 due posts)              | Before | After |
 * | --------------------------------- | ------ | ----- |
 * | publish, enforcement off          |     40 |     6 |
 * | publish, enforcement on           |     52 |     7 |
 * | unpublish                         |     27 |     4 |
 *
 * The slope is what matters: 4 + 3N, 4 + 4N and 3 + 2N respectively, against
 * a flat 6, 7 and 4. At the batch bound of 200 due posts that is 604, 804 and
 * 403 round trips — per tenant, on one reserved `maintenance` connection, in a
 * job that visits every active tenant in sequence.
 *
 * ## The budgets are EXACT, and the fixture is far larger than they are
 *
 * Exact rather than a ceiling, for the reason the term-assignment budget gives:
 * the property is that the number does NOT move with the number of due posts,
 * and `toBeLessThanOrEqual` passes a per-post regression as long as the fixture
 * stays small. Twelve posts are due in every case here, so any per-post query
 * overshoots by at least twelve.
 *
 * Both bounds are asserted the same way at two sizes — twelve posts and one —
 * because "the number does not move" is a claim about the DIFFERENCE, and a
 * single measurement cannot make it.
 *
 * ## Both configurations, because they cost different things
 *
 * With managed-media enforcement OFF — every deployment that has not opted in —
 * the checklist is not applicable and the port answers from `process.env`
 * without touching the database. With it ON, each evaluation reads the tenant
 * flag and resolves the batch's media references, and THAT is the shape that
 * used to be paid per post. Both are measured; a fix that only helped the
 * default configuration would have left the expensive one alone.
 *
 * ## Correctness is asserted beside every count
 *
 * A budget on its own is satisfied by a sweep that publishes nothing. Every
 * case checks the statuses that actually landed and the audit rows that
 * actually exist, because "fewer queries" and "did the same thing" are
 * different claims.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { countPoolQueries } from "./query-budget";
import {
  publishDueScheduledPosts,
  unpublishDuePosts
} from "../../src/modules/blog-content/application/blog-scheduled-publish";
import { mediaLibraryPortAdapter } from "../../src/modules/media-library/application/media-library-port-adapter";

const TENANT = "f8888888-8888-4888-8888-888888888888";
const AUTHOR = "f8000000-0000-4000-8000-000000000001";

/** An order of magnitude more than any budget here, so a per-post query cannot hide. */
const DUE_COUNT = 12;

/**
 * `SET LOCAL` + `SELECT` the due batch + blog settings + term ids for the whole
 * batch + the batched `UPDATE` + the batched audit `INSERT`.
 *
 * The edge cache is off in this suite, so `enqueueModuleContentPurge` is a JS
 * no-op and contributes nothing; with it on it adds ONE, not one per post.
 */
const PUBLISH_QUERY_BUDGET = 6;

/**
 * The same, plus what the checklist costs when enforcement is active: the
 * tenant flag and the media resolve, ONCE PER PASS rather than once per post.
 * Only the first pass runs here — every post is blocked, so the second pass
 * has no candidates to re-check and issues nothing — and no `UPDATE` follows.
 */
const PUBLISH_ENFORCED_BLOCKED_QUERY_BUDGET = 7;

/** `SET LOCAL` + the due `SELECT` + the batched `UPDATE` + the batched audit `INSERT`. */
const UNPUBLISH_QUERY_BUDGET = 4;

/**
 * A complete, separated `NEWS_MEDIA_R2_*` block: `evaluateManagedMediaReadiness`
 * is fail-closed, so a missing var silently turns enforcement back OFF and the
 * "enforced" cases below would measure the unenforced path while looking like
 * they measured the other one.
 */
const R2_ENV: Record<string, string> = {
  NEWS_MEDIA_R2_ENABLED: "true",
  NEWS_MEDIA_R2_ACCOUNT_ID: "acct-news",
  NEWS_MEDIA_R2_ACCESS_KEY_ID: "key-news",
  NEWS_MEDIA_R2_SECRET_ACCESS_KEY: "secret-news",
  NEWS_MEDIA_R2_BUCKET: "bucket-news",
  NEWS_MEDIA_R2_PUBLIC_BASE_URL: "https://media.example.test"
};

function enableManagedMediaEnv(): void {
  for (const [name, value] of Object.entries(R2_ENV)) {
    process.env[name] = value;
  }
}

function clearManagedMediaEnv(): void {
  for (const name of Object.keys(R2_ENV)) {
    delete process.env[name];
  }
}

async function seedTenant(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'sweep-budget', 'Sweep Budget Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'sweep-budget@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;
}

/**
 * `count` posts due for publication. `featuredMediaId` points at a media object
 * that does not exist, which the checklist (when it runs at all) treats as an
 * unsafe reference — the cheapest way to make a post fail every time without
 * seeding a media registry.
 */
async function seedDuePosts(
  count: number,
  options: { featuredMediaId?: string | null } = {}
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, scheduled_at, featured_media_id)
    SELECT ${TENANT}, ${AUTHOR}, 'Due ' || n, 'due-' || n, '{}'::jsonb, 'body',
           'scheduled', 'public', 'id', now() - interval '1 hour',
           ${options.featuredMediaId ?? null}
    FROM generate_series(1, ${count}) AS n
  `;
}

/** `count` published posts whose withdrawal window has closed. */
async function seedDueUnpublishPosts(count: number): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, published_at, unpublish_at)
    SELECT ${TENANT}, ${AUTHOR}, 'Live ' || n, 'live-' || n, '{}'::jsonb, 'body',
           'published', 'public', 'id', now() - interval '2 hours',
           now() - interval '1 hour'
    FROM generate_series(1, ${count}) AS n
  `;
}

/** Marks the tenant as having opted into managed-media enforcement. */
async function enableManagedMediaForTenant(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_media_library_tenant_state
      (tenant_id, managed_media_enforced_at, updated_at)
    VALUES (${TENANT}, now(), now())
  `;
}

async function statusCounts(): Promise<Record<string, number>> {
  const rows = (await getAdminSql()`
    SELECT status, count(*)::int AS count
    FROM awcms_blog_posts WHERE tenant_id = ${TENANT}
    GROUP BY status
  `) as { status: string; count: number }[];

  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

async function auditActionCounts(): Promise<Record<string, number>> {
  const rows = (await getAdminSql()`
    SELECT action, count(*)::int AS count
    FROM awcms_audit_events WHERE tenant_id = ${TENANT}
    GROUP BY action
  `) as { action: string; count: number }[];

  return Object.fromEntries(rows.map((row) => [row.action, row.count]));
}

const suite = integrationEnabled ? describe : describe.skip;

suite("the scheduled sweeps cost the same for twelve posts as for one", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    clearManagedMediaEnv();
    await resetDatabase();
    await seedTenant();
  });

  afterEach(() => {
    clearManagedMediaEnv();
  });

  test("twelve due posts publish within a fixed budget", async () => {
    await seedDuePosts(DUE_COUNT);

    const { result, queries } = await countPoolQueries(
      getRuntimeSql(),
      (counting) =>
        publishDueScheduledPosts(counting, TENANT, mediaLibraryPortAdapter)
    );

    expect(queries).toBe(PUBLISH_QUERY_BUDGET);
    expect(result.publishedCount).toBe(DUE_COUNT);
    expect(result.blockedCount).toBe(0);
    expect(await statusCounts()).toEqual({ published: DUE_COUNT });

    // One row per post plus the run summary — batching the INSERT must not
    // batch away the trail.
    expect(await auditActionCounts()).toEqual({
      "blog.post.published": DUE_COUNT,
      "blog.post.scheduled_publish_executed": 1
    });
  });

  test("one due post costs the same as twelve", async () => {
    await seedDuePosts(1);

    const { result, queries } = await countPoolQueries(
      getRuntimeSql(),
      (counting) =>
        publishDueScheduledPosts(counting, TENANT, mediaLibraryPortAdapter)
    );

    // The number does not move with the input. That is the whole property.
    expect(queries).toBe(PUBLISH_QUERY_BUDGET);
    expect(result.publishedCount).toBe(1);
  });

  test("a sweep with nothing due writes only its summary", async () => {
    const { result, queries } = await countPoolQueries(
      getRuntimeSql(),
      (counting) =>
        publishDueScheduledPosts(counting, TENANT, mediaLibraryPortAdapter)
    );

    // `SET LOCAL` + the due `SELECT` + the "nothing due" audit row. The empty
    // batch must not cost a settings read, a term read or an empty `UPDATE`.
    expect(queries).toBe(3);
    expect(result.publishedCount).toBe(0);
    expect(await auditActionCounts()).toEqual({
      "blog.post.scheduled_publish_skipped": 1
    });
  });

  test("with enforcement ON, the checklist is asked once per pass, not once per post", async () => {
    enableManagedMediaEnv();
    await enableManagedMediaForTenant();
    await seedDuePosts(DUE_COUNT, {
      featuredMediaId: "f8999999-9999-4999-8999-999999999999"
    });

    const { result, queries } = await countPoolQueries(
      getRuntimeSql(),
      (counting) =>
        publishDueScheduledPosts(counting, TENANT, mediaLibraryPortAdapter)
    );

    expect(queries).toBe(PUBLISH_ENFORCED_BLOCKED_QUERY_BUDGET);

    // The checklist genuinely ran — nothing published, and every post is still
    // `scheduled` for a later run rather than silently dropped.
    expect(result.publishedCount).toBe(0);
    expect(result.blockedCount).toBe(DUE_COUNT);
    expect(await statusCounts()).toEqual({ scheduled: DUE_COUNT });
    expect(await auditActionCounts()).toEqual({
      "blog.post.scheduled_publish_blocked": DUE_COUNT,
      "blog.post.scheduled_publish_executed": 1
    });
  });

  test("with enforcement ON and one post due, the cost is unchanged", async () => {
    enableManagedMediaEnv();
    await enableManagedMediaForTenant();
    await seedDuePosts(1, {
      featuredMediaId: "f8999999-9999-4999-8999-999999999999"
    });

    const { result, queries } = await countPoolQueries(
      getRuntimeSql(),
      (counting) =>
        publishDueScheduledPosts(counting, TENANT, mediaLibraryPortAdapter)
    );

    expect(queries).toBe(PUBLISH_ENFORCED_BLOCKED_QUERY_BUDGET);
    expect(result.blockedCount).toBe(1);
  });

  test("blocked and publishable posts in one batch are separated correctly", async () => {
    enableManagedMediaEnv();
    await enableManagedMediaForTenant();

    // Six with a dangling featured media reference, six with none. The
    // checklist's other rules are not blocking by default, so the second group
    // passes and the first does not — one batch, two verdicts.
    await seedDuePosts(6, {
      featuredMediaId: "f8999999-9999-4999-8999-999999999999"
    });
    await getAdminSql()`
      INSERT INTO awcms_blog_posts
        (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
         status, visibility, locale, scheduled_at)
      SELECT ${TENANT}, ${AUTHOR}, 'Clean ' || n, 'clean-' || n, '{}'::jsonb, 'body',
             'scheduled', 'public', 'id', now() - interval '1 hour'
      FROM generate_series(1, 6) AS n
    `;

    const { result } = await countPoolQueries(getRuntimeSql(), (counting) =>
      publishDueScheduledPosts(counting, TENANT, mediaLibraryPortAdapter)
    );

    expect(result.publishedCount).toBe(6);
    expect(result.blockedCount).toBe(6);
    expect(await statusCounts()).toEqual({ published: 6, scheduled: 6 });

    const published = (await getAdminSql()`
      SELECT slug FROM awcms_blog_posts
      WHERE tenant_id = ${TENANT} AND status = 'published'
      ORDER BY slug
    `) as { slug: string }[];

    // The right six, not just six of them: a batch that published the blocked
    // half and blocked the clean half would satisfy every count above.
    expect(published.map((row) => row.slug)).toEqual([
      "clean-1",
      "clean-2",
      "clean-3",
      "clean-4",
      "clean-5",
      "clean-6"
    ]);
  });

  test("twelve due withdrawals cost a fixed budget", async () => {
    await seedDueUnpublishPosts(DUE_COUNT);

    const { result, queries } = await countPoolQueries(
      getRuntimeSql(),
      (counting) => unpublishDuePosts(counting, TENANT)
    );

    expect(queries).toBe(UNPUBLISH_QUERY_BUDGET);
    expect(result.unpublishedCount).toBe(DUE_COUNT);
    expect(await statusCounts()).toEqual({ archived: DUE_COUNT });
    expect(await auditActionCounts()).toEqual({
      "blog.post.unpublished": DUE_COUNT,
      "blog.post.scheduled_unpublish_executed": 1
    });
  });

  test("one due withdrawal costs the same as twelve", async () => {
    await seedDueUnpublishPosts(1);

    const { result, queries } = await countPoolQueries(
      getRuntimeSql(),
      (counting) => unpublishDuePosts(counting, TENANT)
    );

    expect(queries).toBe(UNPUBLISH_QUERY_BUDGET);
    expect(result.unpublishedCount).toBe(1);
  });

  test("`unpublish_at` survives the batched UPDATE", async () => {
    await seedDueUnpublishPosts(DUE_COUNT);

    await unpublishDuePosts(getRuntimeSql(), TENANT);

    const rows = (await getAdminSql()`
      SELECT count(*)::int AS count FROM awcms_blog_posts
      WHERE tenant_id = ${TENANT} AND unpublish_at IS NOT NULL
    `) as { count: number }[];

    // Deliberate, and documented at the statement: `unpublish_at` is the
    // RECORD of why the post is archived. Batching the UPDATE must not quietly
    // start clearing it.
    expect(rows[0]!.count).toBe(DUE_COUNT);
  });
});
