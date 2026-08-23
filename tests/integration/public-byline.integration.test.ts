/**
 * ADR-0109 — the opt-in public byline, against a real PostgreSQL.
 *
 * The pure half (validation, and the JSON-LD `author` node) is in
 * `tests/public-byline.test.ts`. Four properties here need a database, and each
 * of them is a way this feature could ship looking correct:
 *
 *   1. the `?view=full` feed carries the byline for the author who set one and
 *      `null` for the author who did not — the second half matters more, since
 *      "every article suddenly names somebody" is the failure mode of publishing
 *      an internal display name;
 *   2. **one query serves the whole page**, whatever its size. The batched
 *      lookup is invisible in review and would degrade to N+1 in exactly the
 *      shape #649 recorded and rejected;
 *   3. the byline is TENANT-scoped: the same person's row in another tenant is
 *      never read, which is what `awcms_tenant_users` (rather than a global
 *      principal field) buys;
 *   4. an ERASURE destroys it (ADR-0108's `anonymizedColumns` on the descriptor
 *      that ADR-0109 gave its first personal column).
 *
 * WORLD 1 (harness.ts) — an ephemeral migrated database; the reads run as the
 * least-privileged runtime role under FORCE RLS.
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
import { listBlogPostsFullPage } from "../../src/modules/blog-content/application/blog-post-directory";
import {
  fetchPublicBylinesForAuthors,
  updateOwnPublicBylineName
} from "../../src/modules/identity-access/application/own-byline";
import { buildSubjectPlan } from "../../src/modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../src/modules/data-lifecycle/domain/subject-data-registry";
import {
  loadColumnTypes,
  loadUniqueColumns,
  runSubjectErasure,
  ANONYMIZED_TEXT
} from "../../src/modules/data-lifecycle/application/subject-data-executor";
import { resolveSubject } from "../../src/modules/data-lifecycle/application/subject-request-service";
import { listModules } from "../../src/modules";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const BYLINE_AUTHOR = "a0000000-0000-4000-8000-00000000000a";
const PLAIN_AUTHOR = "a0000000-0000-4000-8000-00000000000b";
const TENANT_B_AUTHOR = "b0000000-0000-4000-8000-00000000000a";

const BYLINE = "Siti Rahayu";
const TENANT_B_BYLINE = "Someone Else Entirely";

let bylineAuthorIdentity = "";

async function seedAuthor(
  tenantId: string,
  tenantUserId: string,
  label: string,
  byline: string | null
): Promise<string> {
  const admin = getAdminSql();

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Internal ${label}`})
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.test`}, 'hash')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, public_byline_name)
    VALUES (${tenantUserId}, ${tenantId}, ${identity[0]!.id}, ${byline})
  `;

  return identity[0]!.id;
}

async function seedPost(
  tenantId: string,
  authorId: string,
  slug: string
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       body_portable_text, status, locale, published_at)
    VALUES (
      ${tenantId}, ${authorId}, ${`Article ${slug}`}, ${slug},
      '{}'::jsonb, ${`Body of ${slug}`}, '[]'::jsonb, 'published', 'id', now()
    )
  `;
}

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'byline-a', 'Byline A'),
           (${TENANT_B}, 'byline-b', 'Byline B')
  `;

  bylineAuthorIdentity = await seedAuthor(
    TENANT_A,
    BYLINE_AUTHOR,
    "byline-author",
    BYLINE
  );
  await seedAuthor(TENANT_A, PLAIN_AUTHOR, "plain-author", null);
  await seedAuthor(TENANT_B, TENANT_B_AUTHOR, "b-author", TENANT_B_BYLINE);

  await seedPost(TENANT_A, BYLINE_AUTHOR, "with-byline");
  await seedPost(TENANT_A, PLAIN_AUTHOR, "without-byline");
}

const suite = integrationEnabled ? describe : describe.skip;

suite("the opt-in public byline (ADR-0109)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("the build feed carries the byline, and `null` where nobody set one", async () => {
    const page = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listBlogPostsFullPage(tx, TENANT_A, { limit: 50 })
    );

    const withByline = page.items.find((item) => item.slug === "with-byline");
    const withoutByline = page.items.find(
      (item) => item.slug === "without-byline"
    );

    expect(withByline?.authorByline).toBe(BYLINE);
    // The half that matters more: an author who has not opted in names NOBODY.
    // Publishing the internal display name would have made this `Internal
    // plain-author`, and every article on the site would suddenly carry a staff
    // name that nobody chose to publish.
    expect(withoutByline?.authorByline).toBeNull();
  });

  test("a whole page of posts costs ONE byline query, not one per post", async () => {
    // Thirty more posts by the same two authors. `fetchPublicBylinesForAuthors`
    // de-duplicates the ids, so this also proves the page is not paying per-ROW
    // for a value that is per-AUTHOR.
    for (let index = 0; index < 30; index += 1) {
      await seedPost(
        TENANT_A,
        index % 2 === 0 ? BYLINE_AUTHOR : PLAIN_AUTHOR,
        `bulk-${index}`
      );
    }

    const { result: page, queries } = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_A,
      (tx) =>
        countQueries(tx, (counting) =>
          listBlogPostsFullPage(counting, TENANT_A, { limit: 50 })
        )
    );

    expect(page.items).toHaveLength(32);
    expect(
      page.items.filter((item) => item.authorByline === BYLINE)
    ).toHaveLength(16);

    // The feed issues a bounded number of statements regardless of page size:
    // the page itself, terms, institutions, bylines. A ceiling of 6 over 32
    // posts is what makes this bite — a per-post byline lookup would be 30-odd
    // more. The number is a ceiling, not a target.
    expect(queries).toBeLessThanOrEqual(6);
  });

  test("a byline is TENANT-scoped: another tenant's row is never read", async () => {
    // The same physical person can hold a membership in two tenants and write
    // under two names. Reading tenant B's row here would publish the wrong name
    // — and it would do it silently, since both are plausible.
    const bylines = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      fetchPublicBylinesForAuthors(tx, TENANT_A, [
        BYLINE_AUTHOR,
        TENANT_B_AUTHOR
      ])
    );

    expect(bylines.get(BYLINE_AUTHOR)).toBe(BYLINE);
    expect(bylines.get(TENANT_B_AUTHOR)).toBeUndefined();
    expect([...bylines.values()]).not.toContain(TENANT_B_BYLINE);
  });

  test("the self-service write is keyed by the SESSION's identity, never by a supplied id", async () => {
    const updated = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      updateOwnPublicBylineName(tx, TENANT_A, bylineAuthorIdentity, "Nama Baru")
    );

    expect(updated).toEqual({
      tenantUserId: BYLINE_AUTHOR,
      publicBylineName: "Nama Baru"
    });

    // An identity that has no membership in this tenant writes nothing and is
    // reported as such, rather than silently matching zero rows and returning
    // success.
    const foreign = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      updateOwnPublicBylineName(
        tx,
        TENANT_A,
        "00000000-0000-4000-8000-000000000999",
        "Nama Palsu"
      )
    );

    expect(foreign).toBeNull();
  });

  test("an ERASURE destroys the byline (ADR-0108)", async () => {
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      const resolution = await resolveSubject(tx, TENANT_A, BYLINE_AUTHOR);
      if (!resolution.resolved) throw new Error("subject did not resolve");

      const plan = buildSubjectPlan(
        collectSubjectDataDescriptors(listModules()),
        { ...resolution.subject, tenantId: TENANT_A }
      );
      const tables = plan.entries.map((entry) => entry.tableName);
      const columnTypes = await loadColumnTypes(tx, tables);
      const uniqueColumns = await loadUniqueColumns(tx, tables);

      return runSubjectErasure(tx, TENANT_A, plan, columnTypes, uniqueColumns);
    });

    const rows = (await getAdminSql()`
      SELECT public_byline_name FROM awcms_tenant_users WHERE id = ${BYLINE_AUTHOR}
    `) as { public_byline_name: string | null }[];

    // The most visible place a name can survive an erasure is under the
    // articles the person wrote.
    expect(rows[0]!.public_byline_name).toBe(ANONYMIZED_TEXT);
    expect(rows[0]!.public_byline_name).not.toBe(BYLINE);
  });
});
