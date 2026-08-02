/**
 * `/admin/blog` gates against the endpoints it drives, and is explicit about
 * the permissions it deliberately does NOT drive.
 *
 * Sibling of the four other admin page contracts. What is specific here is
 * scale: `blog_content` declares 43 permissions across 15 activity codes, so
 * for the first time "the page drives all of them" is the WRONG assertion. The
 * useful one is that every gate is real, and that the absences are the ones
 * intended.
 *
 * Three module-specific traps:
 *
 * - **`submit-review` is gated on `posts.update`.** It reads like it wants a
 *   `posts.submit` or `posts.review`; neither is seeded anywhere, so inventing
 *   one would hide the button from every editor including the owner. The route
 *   builds its guard in two pieces (an `ACTIVITY` const plus a literal
 *   `action`), so a regex over guard triples cannot see it — this test asserts
 *   it directly rather than letting it pass as unenforced.
 * - **`posts.export` is declared and seeded, and has NO route at all.** A
 *   screen cannot drive a permission with no surface; a control gated on it
 *   would issue a request that 404s.
 * - **`POST /api/v1/blog/posts` requires no `Idempotency-Key` by documented
 *   design**, while six sibling mutations do. Sending one to create would
 *   imply a replay contract the endpoint declined on purpose.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/blog.astro";
const POSTS_ROUTE = "src/pages/api/v1/blog/posts/index.ts";
const POST_ITEM_ROUTE = "src/pages/api/v1/blog/posts/[id].ts";
const SUBMIT_ROUTE = "src/pages/api/v1/blog/posts/[id]/submit-review.ts";
const REVISION_RESTORE_ROUTE =
  "src/pages/api/v1/blog/posts/[id]/revisions/[revisionId]/restore.ts";

/** Every route this page calls. */
const ROUTES = [
  POSTS_ROUTE,
  POST_ITEM_ROUTE,
  SUBMIT_ROUTE,
  "src/pages/api/v1/blog/posts/[id]/publish.ts",
  "src/pages/api/v1/blog/posts/[id]/schedule.ts",
  "src/pages/api/v1/blog/posts/[id]/archive.ts",
  "src/pages/api/v1/blog/posts/[id]/restore.ts",
  "src/pages/api/v1/blog/posts/[id]/purge.ts",
  "src/pages/api/v1/blog/posts/[id]/revisions/index.ts",
  REVISION_RESTORE_ROUTE
];

/** The six that answer `IDEMPOTENCY_REQUIRED` without the header. */
const IDEMPOTENT_ROUTES = [
  "src/pages/api/v1/blog/posts/[id]/publish.ts",
  "src/pages/api/v1/blog/posts/[id]/schedule.ts",
  "src/pages/api/v1/blog/posts/[id]/archive.ts",
  "src/pages/api/v1/blog/posts/[id]/restore.ts",
  "src/pages/api/v1/blog/posts/[id]/purge.ts",
  REVISION_RESTORE_ROUTE
];

const PAGE_KEYS = [
  "blog_content.posts.archive",
  "blog_content.posts.create",
  "blog_content.posts.delete",
  "blog_content.posts.publish",
  "blog_content.posts.purge",
  "blog_content.posts.read",
  "blog_content.posts.restore",
  "blog_content.posts.schedule",
  "blog_content.posts.update",
  "blog_content.revisions.read",
  "blog_content.revisions.restore"
] as const;

type Triple = `${string}.${string}.${string}`;

function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "blog_content")
      ?.permissions?.map(
        (permission) =>
          `blog_content.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/blog permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect(pageKeys.size).toBe(PAGE_KEYS.length);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty `enforced` would make the subset
    // check pass vacuously, the shape of gate this repo has been burned by.
    expect(enforced.size).toBeGreaterThan(0);

    // `posts.update` is enforced in two pieces (an `ACTIVITY` const plus a
    // literal `action`), which the triple regex cannot see. Assert it directly
    // rather than letting it fall through as unenforced.
    const submit = await readFile(SUBMIT_ROUTE, "utf8");
    expect(submit).toContain('moduleKey: "blog_content"');
    expect(submit).toContain('activityCode: "posts"');
    expect(submit).toContain('action: "update"');
    enforced.add("blog_content.posts.update");

    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.size).toBe(43);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page claims exactly the post-lifecycle eleven", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    // Enumerated, so a permission quietly appearing on this page — instead of
    // on the sibling screen that should own it — fails here loudly.
    expect([...pageKeys].sort()).toEqual([...PAGE_KEYS]);
  });

  test("submit-review is gated on posts.update — there is no posts.submit", () => {
    const declared = declaredTriples();

    expect(declared.has("blog_content.posts.update" as Triple)).toBe(true);
    expect(declared.has("blog_content.posts.submit" as Triple)).toBe(false);
    expect(declared.has("blog_content.posts.review" as Triple)).toBe(false);
  });

  test("posts.export is declared, seeded, and has no route — so no control gates on it", async () => {
    const declared = declaredTriples();
    const page = await readFile(PAGE, "utf8");

    // Declared and seeded...
    expect(declared.has("blog_content.posts.export" as Triple)).toBe(true);
    expect(
      await readFile("sql/036_awcms_blog_content_permissions.sql", "utf8")
    ).toContain("'export'");

    // ...and enforced by nothing. Proven by scanning EVERY blog route, not by
    // trusting the list above, so a future export endpoint makes this test
    // fail and forces the screen question to be answered rather than missed.
    const enforced = new Set<Triple>();
    for await (const file of new Bun.Glob("src/pages/api/v1/blog/**/*.ts").scan(
      {
        cwd: process.cwd()
      }
    )) {
      for (const triple of guardTriplesFrom(await readFile(file, "utf8"))) {
        enforced.add(triple);
      }
    }
    expect(enforced.size).toBeGreaterThan(5);
    expect(enforced.has("blog_content.posts.export" as Triple)).toBe(false);

    // So the page must not gate anything on it.
    expect(
      pageTriplesFrom(page).has("blog_content.posts.export" as Triple)
    ).toBe(false);
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows and idempotency records cannot be bypassed.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain('"/api/v1/blog/posts"');
    expect(page).toContain("/api/v1/blog/posts/${id}/publish`");
    expect(page).toContain("/api/v1/blog/posts/${id}/schedule`");
    expect(page).toContain("/api/v1/blog/posts/${id}/archive`");
    expect(page).toContain("/api/v1/blog/posts/${id}/restore`");
    expect(page).toContain("/api/v1/blog/posts/${id}/purge`");
    expect(page).toContain("/api/v1/blog/posts/${id}/submit-review`");
    expect(page).toContain("/api/v1/blog/posts/${postId}`");
    expect(page).toContain(
      "/api/v1/blog/posts/${postId}/revisions/${revisionId}/restore`"
    );
  });

  test("create sends no Idempotency-Key, because that endpoint requires none", async () => {
    const page = await readFile(PAGE, "utf8");

    // Scoped to the create request, so adding a header there turns this red
    // while the six legitimate ones stay untouched.
    const createCall = page.slice(page.indexOf('"/api/v1/blog/posts"'));
    expect(createCall.slice(0, createCall.indexOf(");"))).not.toContain(
      "Idempotency-Key"
    );

    // And the endpoint really does decline one — the page's choice is only
    // correct while that stays true.
    expect(await readFile(POSTS_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
    expect(await readFile(POST_ITEM_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
    expect(await readFile(SUBMIT_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
  });

  test("the six lifecycle mutations that require a key are sent one", async () => {
    const page = await readFile(PAGE, "utf8");

    for (const route of IDEMPOTENT_ROUTES) {
      expect(await readFile(route, "utf8")).toContain("IDEMPOTENCY_REQUIRED");
    }

    // The page routes them through one helper plus the revision-restore call,
    // so the header is spelled once and applied by default — `idempotent:
    // false` is the explicit opt-out for submit-review.
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');
    expect(page).toContain("idempotent: false");
  });

  test("form bounds come from the constants the validator enforces", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("MAX_TITLE_LENGTH");
    expect(page).toContain("MAX_EXCERPT_LENGTH");
    // A hand-typed `maxlength` drifts into a browser accepting what the server
    // rejects with a 400 the author cannot act on.
    expect(page).not.toMatch(/maxlength=\{?"?\d/);

    const validation = await readFile(
      "src/modules/blog-content/domain/content-validation.ts",
      "utf8"
    );
    expect(validation).toContain("export const MAX_TITLE_LENGTH");
    expect(validation).toContain("export const MAX_EXCERPT_LENGTH");
  });

  test("Restore is gated on the bin view, not on archived status", async () => {
    const page = await readFile(PAGE, "utf8");

    // The original defect: `{canRestore && post.status === "archived" && (`.
    // Archived is not soft-deleted, and `POST .../restore` requires
    // `canRestorePost` (`deleted_at IS NOT NULL`), so the control was rendered
    // exactly where it must 404.
    expect(page).not.toMatch(
      /canRestore\s*&&\s*post\.status\s*===\s*"archived"/
    );
    expect(page).toMatch(/canRestore\s*&&\s*showsBin/);

    // And the endpoint really does demand a soft-deleted row, which is the
    // only reason the line above is the correct one.
    const restore = await readFile(
      "src/pages/api/v1/blog/posts/[id]/restore.ts",
      "utf8"
    );
    expect(restore).toContain("canRestorePost");
    expect(restore).toContain("includeDeleted: true");
  });

  test("the bin is reachable, so a restorable post can actually be on screen", async () => {
    const page = await readFile(PAGE, "utf8");
    const directory = await readFile(
      "src/modules/blog-content/application/blog-post-directory.ts",
      "utf8"
    );

    // A `deletedOnly` filter nothing passes would leave the bin unreachable
    // and Restore undrivable for a second time, one layer down.
    expect(directory).toContain("deletedOnly?: boolean");
    expect(directory).toMatch(/CASE WHEN \$\{deletedOnly\}/);
    expect(page).toContain("deletedOnly: showsBin || undefined");
    expect(page).toContain('readParam("view") === "deleted"');
  });

  test("a soft-deleted post is offered no lifecycle transition", async () => {
    const page = await readFile(PAGE, "utf8");

    // `transitionBlogPostStatus` matches `deleted_at IS NULL`, so publish,
    // schedule, archive and submit-for-review all 404 on a binned post.
    // Matched with `\s*` because prettier wraps these JSX conditions across
    // lines — an exact-string assertion here reads as a behaviour change the
    // next time a condition grows a clause.
    for (const control of [
      "canUpdate",
      "canPublish",
      "canSchedule",
      "canArchive",
      // Delete too — it is already deleted.
      "canDelete"
    ]) {
      expect(page).toMatch(
        new RegExp(String.raw`\{${control}\s*&&\s*!showsBin\s*&&`)
      );
    }

    // Purge is the deliberate exception: `canPurgePost` accepts either state.
    expect(page).toMatch(
      /canPurge\s*&&\s*\(showsBin\s*\|\|\s*post\.status\s*===\s*"archived"\)/
    );
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "blog_content")
      ?.navigation?.find((entry) => entry.path === "/admin/blog");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("blog_content.posts.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);

    // TWO entries for fifteen activity codes: the post lifecycle and the page
    // lifecycle (ADR-0057). Taxonomy, presentation, settings and homepage
    // composition still bring their own entries when their pages land. An
    // entry appearing here without a page is what
    // `admin-navigation-registry.test.ts` catches.
    const navigation = listModules().find(
      (module) => module.key === "blog_content"
    )?.navigation;

    expect(navigation).toHaveLength(2);
    expect(navigation?.map((entry) => entry.path).sort()).toEqual([
      "/admin/blog",
      "/admin/blog-pages"
    ]);

    // Gated on their OWN permissions: an operator granted one and not the
    // other must see exactly the screen they can use.
    const pagesEntry = navigation?.find(
      (entry) => entry.path === "/admin/blog-pages"
    );
    expect(pagesEntry?.requiredPermission).toBe("blog_content.pages.read");
  });
});
