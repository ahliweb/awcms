/**
 * `regionCode` (Issue #1312, sql/131's `awcms_blog_posts.region_code`) round
 * trips through the REAL write path — `createBlogPost`/`updateBlogPost`,
 * not a raw `UPDATE` against the column — against a real PostgreSQL.
 *
 * ## Why this needs a database, and why it is not covered by the unit tests
 *
 * `blog-content-posts-validation.test.ts` proves the SHAPE contract (a
 * dotted code is accepted, `abc`/`62.` are refused, `null` clears, absent is
 * left out of the patch). None of that touches SQL. The one class of defect
 * a pure test cannot see is the write itself: a column added to
 * `BlogPostRow`/`toView()` but left out of the `INSERT`/`UPDATE` parameter
 * list still type-checks and still "works" for every OTHER field, while
 * silently never persisting `region_code` at all — the exact class of bug
 * `tests/blog-post-column-list-parity.test.ts` catches for SELECT/RETURNING
 * lists but cannot catch for an `INSERT`/`UPDATE` binding, since neither is
 * a plain column list that test's regex can anchor on.
 *
 * `tests/integration/blog-post-feed-classifications.integration.test.ts`
 * already proves the READ side (a value written by a raw admin `UPDATE` is
 * projected correctly). This file closes the other half: a value handed to
 * the validated `CreateBlogPostInput`/`UpdateBlogPostInput` actually reaches
 * the column.
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  createBlogPost,
  fetchBlogPostById,
  updateBlogPost
} from "../../src/modules/blog-content/application/blog-post-directory";
import type { PortableTextDocument } from "../../src/modules/blog-content/domain/portable-text";

const TENANT = "f5555555-5555-4555-8555-555555555555";
const AUTHOR = "f5000000-0000-4000-8000-000000000001";

const BODY: PortableTextDocument = [
  {
    _type: "block",
    _key: "b1",
    style: "normal",
    markDefs: [],
    children: [{ _type: "span", _key: "s1", text: "Isi.", marks: [] }]
  }
] as PortableTextDocument;

function createInput(slug: string, regionCode: string | null) {
  return {
    title: "Judul",
    slug,
    excerpt: null,
    contentJson: {},
    bodyPortableText: BODY,
    locale: "id",
    visibility: "public" as const,
    featuredMediaId: null,
    seoImageMediaId: null,
    seoTitle: null,
    metaDescription: null,
    canonicalUrl: null,
    termIds: undefined,
    institutionIds: undefined,
    regionCode,
    translationGroupId: null,
    autoInternalTagLinksDisabled: false
  };
}

async function seedTenantAndAuthor(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'region-tenant', 'Region Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'region@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("regionCode round trip (integration, Issue #1312)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenantAndAuthor();
  });

  test("create persists a valid dotted code", async () => {
    const runtime = getRuntimeSql();

    const post = await withTenantOrThrow(runtime, TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("dibuat", "62.71.01"))
    );

    expect(post.regionCode).toBe("62.71.01");

    const fetched = await withTenantOrThrow(runtime, TENANT, (tx) =>
      fetchBlogPostById(tx, TENANT, post.id)
    );

    expect(fetched?.regionCode).toBe("62.71.01");
  });

  test('create with no regionCode stores null, not the string "undefined"', async () => {
    const runtime = getRuntimeSql();

    const post = await withTenantOrThrow(runtime, TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("tanpa-wilayah", null))
    );

    expect(post.regionCode).toBeNull();
  });

  test("update sets a previously-null regionCode", async () => {
    const runtime = getRuntimeSql();

    const post = await withTenantOrThrow(runtime, TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("disunting", null))
    );

    const updated = await withTenantOrThrow(runtime, TENANT, (tx) =>
      updateBlogPost(tx, TENANT, post.id, { regionCode: "62" })
    );

    expect(updated?.regionCode).toBe("62");
  });

  test("update WITHOUT regionCode in the patch leaves the stored value unchanged", async () => {
    const runtime = getRuntimeSql();

    const post = await withTenantOrThrow(runtime, TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("tak-disentuh", "62.71"))
    );

    const updated = await withTenantOrThrow(runtime, TENANT, (tx) =>
      updateBlogPost(tx, TENANT, post.id, { title: "Judul baru" })
    );

    expect(updated?.regionCode).toBe("62.71");
  });

  test("update with an explicit null CLEARS a previously-set regionCode", async () => {
    const runtime = getRuntimeSql();

    const post = await withTenantOrThrow(runtime, TENANT, (tx) =>
      createBlogPost(
        tx,
        TENANT,
        AUTHOR,
        createInput("dikosongkan", "62.71.01.2001")
      )
    );

    const updated = await withTenantOrThrow(runtime, TENANT, (tx) =>
      updateBlogPost(tx, TENANT, post.id, { regionCode: null })
    );

    expect(updated?.regionCode).toBeNull();
  });
});
