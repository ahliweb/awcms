/**
 * A query budget on the OTHER post-assignment write path.
 *
 * ## Why a second file rather than a case in the first
 *
 * `post-term-assignment-budget.integration.test.ts` pins
 * `syncPostTermAssignments` at two statements. `syncPostInstitutionAssignments`
 * is its twin — its own docstring says so, "exactly like
 * `syncPostTermAssignments`", because an article names its institutions the way
 * it names its terms and the post payload carries both.
 *
 * It was a twin in contract and not in cost. The term path was flattened when
 * `blog:legacy:import` made a 23,906-article archive its caller; this path,
 * which the SAME importer drives through the SAME payload, kept one `INSERT`
 * per institution. A sibling that advertises itself as a sibling is the easiest
 * kind to miss, because whoever fixed the first one has already read the second
 * and remembers agreeing with it.
 *
 * The budgets live in separate files because they are separate claims about
 * separate functions. One file asserting both would go green the moment either
 * regressed and the other absorbed it.
 *
 * ## Exact, with a fixture larger than the budget
 *
 * One `DELETE`, one `INSERT ... unnest`. Exact rather than a ceiling: the
 * property is that the number does not move with the number of institutions,
 * and `toBeLessThanOrEqual` would pass a per-item regression as long as the
 * fixture stayed small. Ten institutions is 11 queries under the old shape
 * against a budget of 2.
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
import { countQueries } from "./query-budget";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { syncPostInstitutionAssignments } from "../../src/modules/blog-content/application/institution-directory";

const TENANT = "f9999999-9999-4999-8999-999999999999";
const AUTHOR = "f9000000-0000-4000-8000-000000000001";

/** An order of magnitude past the budget, so a per-item query cannot hide. */
const INSTITUTION_COUNT = 10;

/** One `DELETE` for the old set, one `INSERT ... unnest` for the new one. */
const ASSIGNMENT_QUERY_BUDGET = 2;

async function seedFixtures(): Promise<string[]> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'inst-budget', 'Institution Budget Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'inst-budget@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;

  await admin`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale)
    VALUES (${TENANT}, ${AUTHOR}, 'Filed', 'filed', '{}'::jsonb, '',
            'published', 'public', 'id')
  `;

  const institutions = (await admin`
    INSERT INTO awcms_blog_institutions (tenant_id, branch, name, slug)
    SELECT ${TENANT}, 'legislative', 'DPRD ' || n, 'dprd-' || n
    FROM generate_series(1, ${INSTITUTION_COUNT}) AS n
    RETURNING id
  `) as { id: string }[];

  return institutions.map((row) => row.id);
}

async function postId(): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT id FROM awcms_blog_posts WHERE tenant_id = ${TENANT} AND slug = 'filed'
  `) as { id: string }[];

  return rows[0]!.id;
}

async function assignedInstitutionIds(id: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT institution_id FROM awcms_blog_post_institutions
    WHERE tenant_id = ${TENANT} AND post_id = ${id}
    ORDER BY institution_id
  `) as { institution_id: string }[];

  return rows.map((row) => row.institution_id);
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "filing a post under institutions costs two queries, whatever the count",
  () => {
    let institutionIds: string[] = [];

    beforeAll(async () => {
      await setupIntegrationDatabase();
    });

    afterAll(async () => {
      await teardownIntegrationDatabase();
    });

    beforeEach(async () => {
      await resetDatabase();
      institutionIds = await seedFixtures();
    });

    test("ten institutions cost two queries, and all ten land", async () => {
      const id = await postId();
      const runtime = getRuntimeSql();

      const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
        countQueries(tx, (counting) =>
          syncPostInstitutionAssignments(counting, TENANT, id, institutionIds)
        )
      );

      expect(queries).toBe(ASSIGNMENT_QUERY_BUDGET);
      expect(await assignedInstitutionIds(id)).toEqual(
        [...institutionIds].sort()
      );
    });

    test("one institution costs the same two queries", async () => {
      const id = await postId();
      const runtime = getRuntimeSql();

      const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
        countQueries(tx, (counting) =>
          syncPostInstitutionAssignments(counting, TENANT, id, [
            institutionIds[0]!
          ])
        )
      );

      // The number does not move with the input. That is the whole property.
      expect(queries).toBe(ASSIGNMENT_QUERY_BUDGET);
      expect(await assignedInstitutionIds(id)).toEqual([institutionIds[0]!]);
    });

    test("filing under nothing skips the INSERT entirely", async () => {
      const id = await postId();
      const runtime = getRuntimeSql();

      await withTenantOrThrow(runtime, TENANT, (tx) =>
        syncPostInstitutionAssignments(
          tx,
          TENANT,
          id,
          institutionIds.slice(0, 3)
        )
      );

      const { queries } = await withTenantOrThrow(runtime, TENANT, (tx) =>
        countQueries(tx, (counting) =>
          syncPostInstitutionAssignments(counting, TENANT, id, [])
        )
      );

      // An empty `unnest` would be a legal statement and a wasted round trip —
      // and the DELETE still has to run, or clearing an article's institutions
      // would silently do nothing.
      expect(queries).toBe(1);
      expect(await assignedInstitutionIds(id)).toEqual([]);
    });

    test("it REPLACES the set rather than adding to it", async () => {
      const id = await postId();
      const runtime = getRuntimeSql();

      await withTenantOrThrow(runtime, TENANT, (tx) =>
        syncPostInstitutionAssignments(
          tx,
          TENANT,
          id,
          institutionIds.slice(0, 4)
        )
      );
      await withTenantOrThrow(runtime, TENANT, (tx) =>
        syncPostInstitutionAssignments(tx, TENANT, id, institutionIds.slice(7))
      );

      expect(await assignedInstitutionIds(id)).toEqual(
        [...institutionIds.slice(7)].sort()
      );
    });

    test("a repeated id still raises the unique constraint rather than being swallowed", async () => {
      // Deliberately not deduplicated, the same decision its twin records: the
      // constraint refused a repeated pair before this change, and swallowing it
      // now would turn a loud error into a silent difference between what was
      // asked for and what landed. `unnest` changes the shape of the statement,
      // not the contract.
      const id = await postId();
      const runtime = getRuntimeSql();

      let raised = false;
      try {
        await withTenantOrThrow(runtime, TENANT, (tx) =>
          syncPostInstitutionAssignments(tx, TENANT, id, [
            institutionIds[0]!,
            institutionIds[0]!
          ])
        );
      } catch {
        raised = true;
      }

      expect(raised).toBe(true);
    });
  }
);
