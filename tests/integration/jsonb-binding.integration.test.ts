/**
 * Issue #641 — against real PostgreSQL, because only Postgres can answer what a
 * stored jsonb value actually IS.
 *
 * ## The thing a unit test structurally cannot see
 *
 * `${JSON.stringify(x)}::jsonb` stores the jsonb SCALAR STRING rather than the
 * value, and nothing throws. A unit test builds the document in memory, where it
 * is a real array; a round trip through a reader that parses the string back
 * looks correct too. The only way to catch it is to ask the database
 * `jsonb_typeof`, or to run the code that branches on `Array.isArray`.
 *
 * ## Why it mattered
 *
 * ADR-0100 makes `body_portable_text` canonical and `content_json.blocks` a
 * lossy projection. `hasCanonicalPortableTextBody` (Issue #624) decides which
 * one a public page renders by asking `Array.isArray`. `Array.isArray` of a
 * string is false — so every post written through the normal path rendered the
 * lossy projection, silently, which is exactly the defect #624 exists to
 * prevent.
 *
 * The last test here is therefore the load-bearing one: it does not assert a
 * type, it asserts that the renderer takes the canonical branch for a post that
 * went through the real write path.
 *
 * WORLD 1 (harness.ts).
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
import { hasCanonicalPortableTextBody } from "../../src/modules/blog-content/domain/blog-body-rendering";
import type { PortableTextDocument } from "../../src/modules/blog-content/domain/portable-text";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTHOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const BODY: PortableTextDocument = [
  {
    _type: "block",
    _key: "b1",
    style: "normal",
    markDefs: [],
    children: [
      { _type: "span", _key: "s1", text: "Air naik di Kobar.", marks: [] }
    ]
  }
] as PortableTextDocument;

function createInput(slug: string, body: PortableTextDocument) {
  return {
    title: "Banjir",
    slug,
    excerpt: null,
    contentJson: {},
    bodyPortableText: body,
    locale: "id",
    visibility: "public" as const,
    featuredMediaId: null,
    seoImageMediaId: null,
    seoTitle: null,
    metaDescription: null,
    canonicalUrl: null,
    termIds: undefined,
    institutionIds: undefined,
    translationGroupId: null,
    autoInternalTagLinksDisabled: false
  };
}

async function storedType(slug: string): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT jsonb_typeof(body_portable_text) AS t
    FROM awcms_blog_posts WHERE slug = ${slug}
  `) as { t: string }[];
  return rows[0]!.t;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("jsonb binding (integration, Issue #641)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT}, 'lentera', 'Lentera', 'active')
      ON CONFLICT (id) DO NOTHING
    `;
  });

  test("createBlogPost stores an ARRAY, not a jsonb string", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("dibuat", BODY))
    );

    expect(await storedType("dibuat")).toBe("array");
  });

  test("updateBlogPost stores an ARRAY too", async () => {
    // The update path had its own occurrence, spelled differently (a ternary
    // Prettier wrapped across two lines), which is why the gate matches a
    // multi-line window rather than a single line.
    const created = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("disunting", BODY))
    );

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      updateBlogPost(tx, TENANT, created.id, {
        bodyPortableText: [
          {
            _type: "block",
            _key: "b2",
            style: "normal",
            markDefs: [],
            children: [
              { _type: "span", _key: "s2", text: "Air surut.", marks: [] }
            ]
          }
        ] as PortableTextDocument
      } as never)
    );

    expect(await storedType("disunting")).toBe("array");
  });

  test("the column reads back as an array, so jsonb operators work on it", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("operator", BODY))
    );

    const rows = (await getAdminSql()`
      SELECT jsonb_array_length(body_portable_text) AS len,
             body_portable_text -> 0 ->> '_type' AS first_type
      FROM awcms_blog_posts WHERE slug = 'operator'
    `) as { len: number; first_type: string }[];

    // Against a jsonb STRING both of these fail or return null — which is what
    // makes the stored type matter beyond tidiness.
    expect(rows[0]!.len).toBe(1);
    expect(rows[0]!.first_type).toBe("block");
  });

  test("the public renderer takes the CANONICAL branch for a real post", async () => {
    // The load-bearing one. `hasCanonicalPortableTextBody` asks
    // `Array.isArray`, so while the column held a string this was false for
    // every post ever written and the reader silently got the lossy
    // `content_json` projection instead — the defect Issue #624 exists to
    // prevent, present the whole time and reported by nothing.
    const created = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("dirender", BODY))
    );

    const fetched = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      fetchBlogPostById(tx, TENANT, created.id)
    );

    expect(
      hasCanonicalPortableTextBody({
        bodyPortableText: fetched!.bodyPortableText,
        contentJson: fetched!.contentJson as Record<string, unknown>
      })
    ).toBe(true);
  });

  test("the repair migration turns an existing jsonb string into an array", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createBlogPost(tx, TENANT, AUTHOR, createInput("lama", BODY))
    );

    // Re-create the pre-fix state on purpose: a row whose canonical body is a
    // jsonb STRING, exactly as every row written before this issue.
    await getAdminSql()`
      ALTER TABLE awcms_blog_posts NO FORCE ROW LEVEL SECURITY
    `;
    await getAdminSql()`
      UPDATE awcms_blog_posts
      SET body_portable_text = to_jsonb(body_portable_text::text)
      WHERE slug = 'lama'
    `;
    expect(await storedType("lama")).toBe("string");

    await getAdminSql()`
      UPDATE awcms_blog_posts
      SET body_portable_text = (body_portable_text #>> '{}')::jsonb
      WHERE jsonb_typeof(body_portable_text) = 'string'
        AND (body_portable_text #>> '{}') ~ '^\\s*\\['
    `;
    await getAdminSql()`
      ALTER TABLE awcms_blog_posts FORCE ROW LEVEL SECURITY
    `;

    expect(await storedType("lama")).toBe("array");

    const rows = (await getAdminSql()`
      SELECT body_portable_text -> 0 ->> 'style' AS style
      FROM awcms_blog_posts WHERE slug = 'lama'
    `) as { style: string }[];
    expect(rows[0]!.style).toBe("normal");
  });
});
