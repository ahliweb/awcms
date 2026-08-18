import { describe, expect, test } from "bun:test";

/**
 * Every column list in `blog-post-directory.ts` must fetch every field
 * `BlogPostRow` declares.
 *
 * ## The class of defect this catches
 *
 * `toView()` maps a `BlogPostRow` to a `BlogPostView`. TypeScript checks that
 * mapping, and it checks the `BlogPostRow` type — but it CANNOT check that the
 * SQL actually selected those columns, because the query results are cast
 * (`as BlogPostRow[]`). A cast is an assertion, not a verification.
 *
 * So adding a field to `BlogPostRow` and to `toView()` and to ONE of the eight
 * column lists typechecks perfectly, and the other seven silently return
 * `undefined` for it. `undefined` is not `null`: it serialises to a MISSING KEY
 * in JSON, so the field vanishes from the API response for exactly the reads
 * that forgot it — while the read that remembered works, which is what makes it
 * look like a data problem rather than a query problem.
 *
 * Issue #591 added `unpublish_at` and hit precisely this: the first patch
 * updated three of the eight lists, and nothing failed.
 *
 * ## Why this is a source test and not a database test
 *
 * It needs no database, so it runs in the same `bun test` as everything else
 * rather than only in the integration suite — which is the difference between
 * catching this on the PR and catching it in production.
 */

const DIRECTORY = "src/modules/blog-content/application/blog-post-directory.ts";

/** Columns that are computed/joined in a specific query rather than being plain row fields. */
const NOT_A_PLAIN_COLUMN = new Set<string>([]);

describe("blog post column lists", () => {
  test("every BlogPostRow field appears in every column list that builds one", async () => {
    const source = await Bun.file(DIRECTORY).text();

    // 1. The declared row shape.
    const rowTypeMatch = source.match(/type BlogPostRow = \{([\s\S]*?)\n\};/);
    expect(rowTypeMatch).not.toBeNull();

    const declaredColumns = [...rowTypeMatch![1]!.matchAll(/^\s*(\w+)\??:/gm)]
      .map((m) => m[1]!)
      .filter((name) => !NOT_A_PLAIN_COLUMN.has(name));

    expect(declaredColumns.length).toBeGreaterThan(20);
    expect(declaredColumns).toContain("unpublish_at");
    expect(declaredColumns).toContain("scheduled_at");

    // 2. Every SELECT/RETURNING list that ends in the row's last column. Anchor
    //    on `translation_group_id` because every list that builds a full
    //    BlogPostRow ends with it — a list that does not is not building one.
    const lists = [
      ...source.matchAll(
        /(?:SELECT|RETURNING)\s+([\s\S]*?translation_group_id)/g
      )
    ].map((m) => m[1]!);

    expect(lists.length).toBeGreaterThanOrEqual(6);

    const missing: string[] = [];

    for (const [index, list] of lists.entries()) {
      // Strip SQL comments so a column NAMED in prose does not count as fetched.
      const withoutComments = list.replace(/--.*$/gm, "");
      const fetched = new Set(
        [...withoutComments.matchAll(/\b([a-z_]+)\b/g)].map((m) => m[1]!)
      );

      for (const column of declaredColumns) {
        if (!fetched.has(column)) {
          missing.push(`list #${index + 1} does not fetch \`${column}\``);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("the transition writer preserves unpublish_at rather than clearing it", async () => {
    const source = await Bun.file(DIRECTORY).text();

    // `scheduled_at` is CLEARED on a transition away from `scheduled`;
    // `unpublish_at` must NOT be, or publishing a post silently cancels the
    // withdrawal the editor set while scheduling it.
    expect(source).toContain("unpublish_at = CASE");
    expect(source).toContain("options.unpublishAt === undefined");
  });
});
