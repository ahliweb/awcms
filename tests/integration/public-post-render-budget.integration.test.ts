/**
 * Query budget for the tag-link part of a public post view (Issue #1454).
 *
 * Measured before this change, on a tenant with 5,000 posts, 800 tags and
 * 15,000 assignments: the "most-used tags" aggregate alone cost about 10 ms of
 * execution plus 3 ms of planning on EVERY view, and lifted the median
 * `interactive` slot hold from 0.8 ms to 8 ms, which is what made the 8-slot
 * gate the ceiling at about 300 views/s.
 *
 * The numbers below are EXACT, like `middleware-query-budget`: a ceiling with
 * slack hides the difference between "improved" and "regressed into the slack".
 *   - cold, linking on:   2 (settings + ranked candidates), and NO count query
 *   - warm, linking on:   1 (settings only; the ranked list is cached)
 *   - post opted out:     0
 *   - tenant opted out:   1 (settings only, no tag query)
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
import { countQueries } from "./query-budget";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { renderContentHtmlWithInternalTagLinks } from "../../src/modules/blog-content/application/internal-tag-link-rendering";
import { resetTagLinkCandidateCacheForTests } from "../../src/modules/blog-content/application/tag-link-candidate-cache";
import { updateBlogTerm } from "../../src/modules/blog-content/application/blog-taxonomy-directory";

const TENANT = "f7777777-7777-4777-8777-777777777777";
const OTHER = "f7888888-8888-4888-8888-888888888888";
const HTML = "<p>Sepak Bola dan Politik hari ini.</p>";

async function seedTenantWithTags(
  tenant: string,
  code: string,
  names: string[]
): Promise<string[]> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenant}, ${code}, ${code})
  `;

  const ids: string[] = [];

  for (const name of names) {
    const rows = (await admin`
      INSERT INTO awcms_blog_terms (tenant_id, taxonomy_type, name, slug)
      VALUES (${tenant}, 'tag', ${name}, ${name.toLowerCase().replace(/ /g, "-")})
      RETURNING id
    `) as { id: string }[];

    ids.push(rows[0]!.id);
  }

  return ids;
}

const render = (tenant: string, postDisabled = false) =>
  withTenantOrThrow(getRuntimeSql(), tenant, (tx) =>
    countQueries(tx, (counting) =>
      renderContentHtmlWithInternalTagLinks(
        counting,
        tenant,
        HTML,
        postDisabled,
        "/blog/x",
        {}
      )
    )
  );

const suite = integrationEnabled ? describe : describe.skip;

suite("public post view — tag-link query budget", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    resetTagLinkCandidateCacheForTests();
    await resetDatabase();
    await seedTenantWithTags(TENANT, "budget-a", ["Sepak Bola", "Politik"]);
  });

  test("cold costs 2 queries, warm costs 1, and the output is identical", async () => {
    const cold = await render(TENANT);
    const warm = await render(TENANT);

    expect(cold.queries).toBe(2);
    expect(warm.queries).toBe(1);
    expect(cold.result).toContain('href="/blog/x/tag/sepak-bola"');
    expect(warm.result).toBe(cold.result);
  });

  test("a post that opts out pays no query", async () => {
    const { queries, result } = await render(TENANT, true);

    expect(queries).toBe(0);
    expect(result).toBe(HTML);
  });

  test("a tenant that opted out pays only the settings read", async () => {
    await getAdminSql()`
      INSERT INTO awcms_blog_internal_tag_link_settings (tenant_id, enabled)
      VALUES (${TENANT}, false)
    `;

    const { queries, result } = await render(TENANT);

    expect(queries).toBe(1);
    expect(result).toBe(HTML);
  });

  test("another tenant never receives this tenant's cached tags", async () => {
    await seedTenantWithTags(OTHER, "budget-b", ["Ekonomi"]);

    await render(TENANT);
    const other = await render(OTHER);

    expect(other.result).toBe(HTML);
    expect(other.result).not.toContain("sepak-bola");
  });

  test("renaming a tag in this process takes effect on the next view", async () => {
    const [id] = await getAdminSql()`
      SELECT id FROM awcms_blog_terms WHERE tenant_id = ${TENANT} AND slug = 'politik'
    `;
    const before = await render(TENANT);

    expect(before.result).toContain("/tag/politik");

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      updateBlogTerm(tx, TENANT, (id as { id: string }).id, {
        name: "Pemilu",
        slug: "pemilu"
      })
    );

    const after = await render(TENANT);

    expect(after.result).not.toContain("/tag/politik");
  });
});
