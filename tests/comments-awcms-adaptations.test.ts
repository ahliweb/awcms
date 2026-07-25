/**
 * Tests for the parts of `comments` that are AWCMS-SPECIFIC — the port-time
 * adaptations and defect fixes that awcms-micro's own suite cannot cover
 * because the behaviour there is different or absent.
 *
 * Everything here is a guard against silent regression of a decision, not a
 * restatement of the implementation.
 */
import { describe, expect, test } from "bun:test";

import { buildCommentableResourceUrl } from "../src/modules/comments/application/commentable-resource-engine";
import { applyModerationAction } from "../src/modules/comments/domain/comment-status";
import { getRegisteredCommentableResources } from "../src/lib/comments/commentable-resources";
import { listModules } from "../src/modules";
import { WORKER_ROLE_GRANTS } from "../scripts/security-readiness";
import type { CommentableResourceDescriptor } from "../src/modules/_shared/module-contract";

const BLOG_POST_DESCRIPTOR: CommentableResourceDescriptor = {
  key: "blog_content.post",
  ownerModuleKey: "blog_content",
  resourceType: "blog_post",
  tableName: "awcms_blog_posts",
  localeColumn: "locale",
  slugColumn: "slug",
  urlTemplate: "/blog/:tenantCode/:slug",
  publicationFilter: { equals: { status: "published" } },
  defaultPolicy: "moderated-anonymous"
};

describe(":tenantCode URL template (AWCMS adaptation over awcms-micro)", () => {
  test("substitutes the server-resolved tenant code", () => {
    expect(
      buildCommentableResourceUrl(BLOG_POST_DESCRIPTOR, {
        resourceId: "11111111-1111-1111-1111-111111111111",
        slug: "hello-world",
        tenantCode: "acme"
      })
    ).toBe("/blog/acme/hello-world");
  });

  test("percent-encodes every substituted value", () => {
    expect(
      buildCommentableResourceUrl(BLOG_POST_DESCRIPTOR, {
        resourceId: "id",
        slug: "a b/c",
        tenantCode: "a b"
      })
    ).toBe("/blog/a%20b/a%20b%2Fc");
  });

  test("THROWS rather than emitting a literal :tenantCode placeholder", () => {
    // A silently malformed public URL is served to every visitor of that page
    // and is stored on the thread row; failing loudly at resolution time is the
    // cheaper failure by a wide margin.
    expect(() =>
      buildCommentableResourceUrl(BLOG_POST_DESCRIPTOR, {
        resourceId: "id",
        slug: "s",
        tenantCode: null
      })
    ).toThrow(/requires a tenantCode/);

    expect(() =>
      buildCommentableResourceUrl(BLOG_POST_DESCRIPTOR, {
        resourceId: "id",
        slug: "s",
        tenantCode: ""
      })
    ).toThrow(/requires a tenantCode/);
  });

  test("a template without :tenantCode does not require one", () => {
    expect(
      buildCommentableResourceUrl(
        { ...BLOG_POST_DESCRIPTOR, urlTemplate: "/p/:id" },
        { resourceId: "abc", slug: null }
      )
    ).toBe("/p/abc");
  });
});

describe("blog_content contributes matching search + comment descriptors", () => {
  /**
   * `blog_content` declares the SAME publication predicate twice: once for
   * `site_search` and once for `comments`. Both answer "is this post public
   * right now?", so drift between them is a real defect in either direction —
   * a post searchable but not commentable, or worse, commentable while
   * unpublished. Nothing in the type system couples them, so this test is the
   * coupling.
   */
  test("the two publicationFilters are identical", () => {
    const blog = listModules().find((m) => m.key === "blog_content");
    expect(blog).toBeDefined();

    const searchSource = blog!.searchSources?.find(
      (s) => s.key === "blog_content.post"
    );
    const commentable = blog!.commentableResources?.find(
      (c) => c.key === "blog_content.post"
    );
    expect(searchSource).toBeDefined();
    expect(commentable).toBeDefined();

    expect(commentable!.publicationFilter).toEqual(
      searchSource!.publicationFilter
    );
    // The other fields that decide WHICH rows are addressed must agree too.
    expect(commentable!.tableName).toBe(searchSource!.tableName);
    expect(commentable!.resourceType).toBe(searchSource!.resourceType);
    expect(commentable!.localeColumn).toBe(searchSource!.localeColumn);
    expect(commentable!.urlTemplate).toBe(searchSource!.urlTemplate);
  });

  test("the registered set is discovered through listModules(), not hard-coded", () => {
    const registered = getRegisteredCommentableResources();
    expect(registered.map((d) => d.key)).toContain("blog_content.post");
    // Every descriptor must be owned by a module that actually declares it.
    for (const descriptor of registered) {
      const owner = listModules().find(
        (m) => m.key === descriptor.ownerModuleKey
      );
      expect(owner).toBeDefined();
      expect(owner!.commentableResources).toContain(descriptor);
    }
  });
});

describe("moderation fixes over awcms-micro", () => {
  test("archive is only legal from approved, and routes through the transition guard", () => {
    const outcome = applyModerationAction("approved", "archive");
    expect(outcome.status).toBe("rejected");
    expect(outcome.publiclyVisible).toBe(false);
    expect(outcome.impliedReasonCode).toBe("archived");

    // Nothing else was ever in public view, so there is nothing to withdraw.
    expect(() => applyModerationAction("pending", "archive")).toThrow();
    expect(() => applyModerationAction("rejected", "archive")).toThrow();
    expect(() => applyModerationAction("spam", "archive")).toThrow();
    expect(() => applyModerationAction("deleted", "archive")).toThrow();
  });

  test("soft delete is terminal — no action recovers a deleted comment", () => {
    for (const action of [
      "approve",
      "reject",
      "spam",
      "archive",
      "restore"
    ] as const) {
      expect(() => applyModerationAction("deleted", action)).toThrow();
    }
  });
});

describe("worker grant matrix covers every comments table sql/066 grants", () => {
  /**
   * `scripts/security-readiness.ts` verifies the matrix against a live
   * database. This test verifies the matrix against the MIGRATION, with no
   * database at all, so the two cannot drift in CI where no Postgres runs.
   */
  test("the matrix entries match the migration's GRANT statements exactly", async () => {
    const migration = await Bun.file(
      "sql/066_awcms_comments_schema.sql"
    ).text();

    const granted = new Map<string, Set<string>>();
    const pattern =
      /GRANT\s+([A-Z,\s]+?)\s+ON\s+(awcms_comments_\w+)\s+TO\s+awcms_worker;/g;

    for (const match of migration.matchAll(pattern)) {
      const verbs = match[1]!.split(",").map((v) => v.trim());
      granted.set(match[2]!, new Set(verbs));
    }

    expect(granted.size).toBeGreaterThan(0);

    for (const [table, verbs] of granted) {
      const matrixVerbs = WORKER_ROLE_GRANTS[table];
      expect(
        matrixVerbs,
        `${table} is granted in sql/066 but absent from WORKER_ROLE_GRANTS`
      ).toBeDefined();
      expect(new Set(matrixVerbs)).toEqual(verbs);
    }

    // And nothing in the matrix claims a comments grant the migration never made.
    for (const table of Object.keys(WORKER_ROLE_GRANTS)) {
      if (!table.startsWith("awcms_comments_")) continue;
      expect(
        granted.has(table),
        `${table} is in WORKER_ROLE_GRANTS but sql/066 grants it nothing`
      ).toBe(true);
    }
  });

  test("the worker can never DELETE a comment — retention anonymizes in place", () => {
    // If this ever flips, the append-only moderation history starts pointing at
    // rows that no longer exist.
    expect(WORKER_ROLE_GRANTS.awcms_comments_comments).not.toContain("DELETE");
    expect(WORKER_ROLE_GRANTS.awcms_comments_comments).not.toContain("INSERT");
  });
});
