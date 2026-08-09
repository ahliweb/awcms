/**
 * `/admin/blog-taxonomy` gates against the endpoints it drives, and is explicit
 * about what it deliberately does not offer.
 *
 * Third sibling of `tests/admin-blog-page-contract.test.ts` (posts) and
 * `tests/admin-blog-pages-page-contract.test.ts` (pages). What is specific
 * here:
 *
 * - **one permission gates three writes.** `taxonomies.configure` covers
 *   create, update and delete, because `sql/036` seeds no per-verb rows. A
 *   screen that invented `taxonomies.create` would gate on authority no
 *   `authorizeInTransaction` call would ever honour — the latent-authz trap
 *   this repo has shipped twice;
 * - **delete is one-way BY DESIGN**, unlike posts and pages. There is no
 *   restore route and no `taxonomies.restore` to build one against, so there
 *   must be no bin view and no Restore control — and the confirmation must say
 *   so. Copy promising recoverability is precisely what made #351 hard to see;
 * - **no `Idempotency-Key` at all.** None of the three term endpoints reads it.
 *   The split is per-endpoint, and a screen that sends one everywhere is
 *   asserting a replay contract that does not exist.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/blog-taxonomy.astro";
const LIST_ROUTE = "src/pages/api/v1/blog/terms/index.ts";
const ITEM_ROUTE = "src/pages/api/v1/blog/terms/[id].ts";
const ROUTES = [LIST_ROUTE, ITEM_ROUTE];

/** Both, and only both — the whole `taxonomies` activity. */
const TAXONOMY_KEYS = [
  "blog_content.taxonomies.configure",
  "blog_content.taxonomies.read"
] as const;

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/**
 * Strips comments before asserting on absences.
 *
 * Not a nicety — the first draft of this file failed three of its own tests,
 * all because the screen's prose EXPLAINS the very things the tests demand be
 * absent ("no `Idempotency-Key`", "copy that promised recoverable"). A test
 * that reads documentation as if it were code punishes a file for being
 * well-commented and would pass the moment someone deleted the explanation.
 *
 * ## Line comments go FIRST, and the order is the whole bug
 *
 * The second draft stripped block comments first and silently ate 9,000
 * characters — every admin screen carries the line
 * `// … forces an external /_astro/*.js`, whose `/*` opens a block comment that
 * then runs to the next `*​/` hundreds of lines below. The delete handler and
 * the PATCH call both vanished, so two assertions failed and a third would have
 * passed VACUOUSLY had it been phrased as an absence.
 *
 * That is the failure mode this repo has now hit in three separate scanners:
 * over-stripping makes "not present" true for the wrong reason. Hence
 * `expectCode` below — every caller proves the anchor it cares about survived.
 *
 * `[^:]` guards `https://`.
 */
function code(source: string): string {
  return source
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * `code()` plus proof it did not eat the region under test. An absence
 * assertion over an over-stripped file is not a weak test, it is a false one.
 */
function expectCode(source: string, anchor: string): string {
  const stripped = code(source);
  expect(stripped).toContain(anchor);
  return stripped;
}

/**
 * Permission triples a screen gates on, in BOTH spellings.
 *
 * Issue #450 is why the second exists: a screen routed through
 * `loadAdminScreen` states its guards as `AccessRequest` object literals — the
 * same shape the routes use — instead of `permissionKey(...)`. Reading only the
 * old spelling would have made this test demand the screen keep deciding access
 * from the raw grant set, which is the defect. A contract test must pin the
 * PROPERTY (this screen gates exactly these two), never the syntax.
 */
function pageKeys(source: string): Set<string> {
  const found = guardKeys(source);
  for (const match of source.matchAll(
    /permissionKey\(\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return found;
}

/** Guard triples an API route constructs. */
function guardKeys(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)"[\s\S]{0,120}?activityCode:\s*"([a-z_]+)"[\s\S]{0,120}?action:\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return found;
}

describe("/admin/blog-taxonomy permission gates", () => {
  test("the screen claims exactly the two taxonomy permissions", async () => {
    const keys = pageKeys(await read(PAGE));

    // Enumerated, so a permission quietly appearing on this screen — instead
    // of on the sibling that should own it — fails here loudly.
    expect([...keys].sort()).toEqual([...TAXONOMY_KEYS]);
  });

  test("and every one is declared by the descriptor, so a migration seeds it", async () => {
    const declared = new Set(
      listModules().flatMap((module) =>
        (module.permissions ?? []).map(
          (permission) =>
            `${module.key}.${permission.activityCode}.${permission.action}`
        )
      )
    );

    for (const key of TAXONOMY_KEYS) {
      expect(declared.has(key)).toBe(true);
    }

    // The latent-authz trap, stated as an assertion: a per-verb permission
    // does NOT exist, so a screen must never gate on one.
    for (const invented of [
      "blog_content.taxonomies.create",
      "blog_content.taxonomies.update",
      "blog_content.taxonomies.delete",
      "blog_content.taxonomies.restore",
      "blog_content.taxonomies.purge"
    ]) {
      expect(declared.has(invented)).toBe(false);
      expect(pageKeys(await read(PAGE)).has(invented)).toBe(false);
    }
  });

  test("what the screen claims is what the routes actually enforce", async () => {
    const enforced = new Set<string>();
    for (const route of ROUTES) {
      for (const key of guardKeys(await read(route))) enforced.add(key);
    }

    for (const key of pageKeys(await read(PAGE))) {
      expect(enforced.has(key)).toBe(true);
    }
  });

  test("no bin view and no Restore control — delete is one-way here", async () => {
    const page = expectCode(await read(PAGE), "term-delete-btn");

    // Posts and pages both have `?view=deleted`. This screen must not, because
    // there is nothing to bring a row back with.
    expect(page).not.toContain("view=deleted");
    expect(page).not.toMatch(/term-restore-btn/);
    expect(page).not.toMatch(/>\s*Restore\s*</);
  });

  test("the delete confirmation states the finality instead of promising recovery", async () => {
    const page = expectCode(await read(PAGE), "window.confirm");

    expect(page).toContain("window.confirm");
    expect(page).toContain("cannot be undone");
    // The #351 failure mode in one assertion: copy that tells the operator the
    // row is coming back, on a screen where it cannot.
    expect(page).not.toMatch(/recoverable|until it is purged|can be restored/i);
  });

  test("the screen sends no Idempotency-Key, because no term endpoint reads one", async () => {
    expect(expectCode(await read(PAGE), "sendJson")).not.toContain(
      "Idempotency-Key"
    );

    // Bound to the endpoints rather than trusted: if a term route later starts
    // requiring the header, this fails and forces the screen to follow.
    for (const route of ROUTES) {
      expect(
        expectCode(await read(route), "authorizeInTransaction").toLowerCase()
      ).not.toContain("idempotency-key");
    }
  });

  test("re-parenting is offered on create and withheld on update", async () => {
    const page = await read(PAGE);

    // Create may set a parent: a term with no children cannot close a cycle.
    expect(page).toContain('id="create-parent"');

    // Update may not: neither route detects cycles, so pointing a parent at
    // its own descendant is accepted and every reader then walks forever.
    const editForm = page.slice(
      page.indexOf('id="term-edit-form"'),
      page.indexOf('id="term-create-form"')
    );
    expect(editForm.length).toBeGreaterThan(0);
    expect(editForm).not.toContain('name="parentId"');
    expect(editForm).not.toContain('name="taxonomyType"');
  });

  test("the PATCH body carries no taxonomyType or parentId", async () => {
    const page = await read(PAGE);

    // The form not offering them is only half of it — the client must not
    // assert them either, or a partial update silently rewrites the hierarchy.
    //
    // Anchored on the bare method literal, not `sendJson("PATCH"`: prettier
    // wraps a three-argument call across lines, so the joined spelling exists
    // only in an unformatted file.
    // Bounded to the CALL, not to the next `sendJson`: the create handler
    // further down legitimately sends both fields, so a slice that runs to
    // `"POST"` swallows it and the assertion fails on the wrong code.
    const body = expectCode(page, '"PATCH"');
    const start = body.indexOf('"PATCH"');
    const end = body.indexOf("\n    );", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const patch = body.slice(start, end);
    expect(patch).toContain("name:");
    expect(patch).not.toContain("taxonomyType");
    expect(patch).not.toContain("parentId");
  });

  test("the screen never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await read(PAGE);

    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain('"/api/v1/blog/terms"');
    expect(page).toContain("/api/v1/blog/terms/${termId}`");
    expect(page).toContain("/api/v1/blog/terms/${idField.value}`");
  });

  test("the navigation entry exists and is gated on read", () => {
    const blog = listModules().find((module) => module.key === "blog_content");
    const entry = (blog?.navigation ?? []).find(
      (item) => item.path === "/admin/blog-taxonomy"
    );

    expect(entry).toBeDefined();
    expect(entry?.requiredPermission).toBe("blog_content.taxonomies.read");
  });
});
