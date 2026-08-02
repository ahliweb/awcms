/**
 * `/admin/blog-pages` gates against the endpoints it drives, and is explicit
 * about what it deliberately does not offer.
 *
 * Sibling of `tests/admin-blog-page-contract.test.ts`. What is specific here:
 *
 * - **it drives ALL eight `pages.*` permissions**, unlike the post console
 *   which claims eleven of forty-three. Four of those eight had no surface at
 *   all until ADR-0057, so "the screen drives every one" is the assertion that
 *   proves the ADR landed whole;
 * - **Restore is gated on the bin view, not on archived status.** That is the
 *   defect #351 fixed one screen over, and the reason this file asserts the
 *   correct shape from the first commit rather than after someone hits a 404;
 * - **the lifecycle is narrower than posts'** — no `schedule`, no
 *   `submit-review`. The screen must not offer either, because no permission
 *   and no route exists for them on pages.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/blog-pages.astro";
const PAGES_ROUTE = "src/pages/api/v1/blog/pages/index.ts";
const PAGE_ITEM_ROUTE = "src/pages/api/v1/blog/pages/[id].ts";

const LIFECYCLE_ROUTES = [
  "src/pages/api/v1/blog/pages/[id]/publish.ts",
  "src/pages/api/v1/blog/pages/[id]/archive.ts",
  "src/pages/api/v1/blog/pages/[id]/restore.ts",
  "src/pages/api/v1/blog/pages/[id]/purge.ts"
];

const ROUTES = [PAGES_ROUTE, PAGE_ITEM_ROUTE, ...LIFECYCLE_ROUTES];

/** All eight — this screen leaves none of its activity's permissions undriven. */
const PAGE_KEYS = [
  "blog_content.pages.archive",
  "blog_content.pages.create",
  "blog_content.pages.delete",
  "blog_content.pages.publish",
  "blog_content.pages.purge",
  "blog_content.pages.read",
  "blog_content.pages.restore",
  "blog_content.pages.update"
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

describe("/admin/blog-pages permission gates", () => {
  test("the page claims exactly the eight pages.* permissions", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    // Enumerated, so a permission from a sibling activity quietly appearing
    // here — instead of on the screen that should own it — fails loudly.
    expect([...pageKeys].sort()).toEqual([...PAGE_KEYS]);
  });

  test("every key it gates on is one its endpoints actually enforce", async () => {
    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty set would make the subset check
    // pass vacuously, the shape of gate this repo has been burned by.
    expect(enforced.size).toBeGreaterThan(0);

    // `pages.update` is enforced through an activity const plus a literal
    // action, which the triple regex cannot see. Assert it directly rather
    // than letting it fall through as unenforced.
    const item = await readFile(PAGE_ITEM_ROUTE, "utf8");
    expect(item).toContain('moduleKey: "blog_content"');
    expect(item).toContain('activityCode: "pages"');
    expect(item).toContain('action: "update"');
    enforced.add("blog_content.pages.update");

    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and every one is declared by the descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("no pages.* permission is left undriven — ADR-0057 landed whole", () => {
    const declaredPages = [...declaredTriples()].filter((key) =>
      key.startsWith("blog_content.pages.")
    );

    // Eight declared, eight on the screen. If a ninth is ever seeded, this
    // fails and forces the screen question to be answered rather than missed —
    // which is exactly how the four this ADR closed went unnoticed for months.
    expect(declaredPages.sort()).toEqual([...PAGE_KEYS]);
  });

  test("Restore is gated on the bin view, not on archived status", async () => {
    const page = await readFile(PAGE, "utf8");

    // The defect #351 fixed on the post console: archived is a different axis
    // from soft-deleted, and `POST .../restore` requires `canRestorePage`
    // (`deleted_at IS NOT NULL`), so that shape renders the control exactly
    // where it must 404.
    expect(page).not.toMatch(
      /canRestore\s*&&\s*entry\.status\s*===\s*"archived"/
    );
    expect(page).toMatch(/canRestore\s*&&\s*showsBin/);

    const restore = await readFile(
      "src/pages/api/v1/blog/pages/[id]/restore.ts",
      "utf8"
    );
    expect(restore).toContain("canRestorePage");
    expect(restore).toContain("includeDeleted: true");
  });

  test("the bin is reachable, so a restorable page can actually be on screen", async () => {
    const page = await readFile(PAGE, "utf8");
    const directory = await readFile(
      "src/modules/blog-content/application/blog-page-directory.ts",
      "utf8"
    );

    expect(directory).toContain("deletedOnly?: boolean");
    expect(directory).toMatch(/CASE WHEN \$\{deletedOnly\}/);
    expect(page).toContain("deletedOnly: showsBin || undefined");
    expect(page).toContain('readParam("view") === "deleted"');
  });

  test("a soft-deleted page is offered no lifecycle transition", async () => {
    const page = await readFile(PAGE, "utf8");

    // `transitionBlogPageStatus` matches `deleted_at IS NULL`, so publish and
    // archive both 404 on a binned page. Delete too — it is already deleted.
    // Matched with `\s*` because prettier wraps these JSX conditions.
    for (const control of ["canPublish", "canArchive", "canDelete"]) {
      expect(page).toMatch(
        new RegExp(String.raw`\{${control}\s*&&\s*!showsBin\s*&&`)
      );
    }

    // Purge is the deliberate exception: `canPurgePage` accepts either state.
    expect(page).toMatch(
      /canPurge\s*&&\s*\(showsBin\s*\|\|\s*entry\.status\s*===\s*"archived"\)/
    );
  });

  test("the page lifecycle is narrower than posts' — no schedule, no review", async () => {
    const page = await readFile(PAGE, "utf8");
    const declared = declaredTriples();

    // Neither permission is seeded, so a control for either would be gated on
    // something no role can hold — the latent-authz trap this repo has shipped
    // more than once.
    expect(declared.has("blog_content.pages.schedule" as Triple)).toBe(false);
    expect(declared.has("blog_content.pages.review" as Triple)).toBe(false);

    expect(page).not.toContain("/schedule");
    expect(page).not.toContain("submit-review");

    // The status filter offers the three reachable states, not all five.
    expect(page).toContain("BLOG_PAGE_STATUSES");
    expect(page).not.toContain("BLOG_CONTENT_STATUSES.map");
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows and idempotency records cannot be bypassed.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain('"/api/v1/blog/pages"');
    expect(page).toContain("/api/v1/blog/pages/${id}/publish`");
    expect(page).toContain("/api/v1/blog/pages/${id}/archive`");
    expect(page).toContain("/api/v1/blog/pages/${id}/restore`");
    expect(page).toContain("/api/v1/blog/pages/${id}/purge`");
    expect(page).toContain("/api/v1/blog/pages/${pageId}`");
  });

  test("the four lifecycle mutations send a key; create, update and delete do not", async () => {
    const page = await readFile(PAGE, "utf8");

    for (const route of LIFECYCLE_ROUTES) {
      expect(await readFile(route, "utf8")).toContain("IDEMPOTENCY_REQUIRED");
    }

    // And the three that take none really do decline one — the screen's choice
    // is only correct while that stays true.
    expect(await readFile(PAGES_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
    expect(await readFile(PAGE_ITEM_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );

    // One helper spells the header once for the four; the create and edit
    // submits are separate handlers that never call it. Sliced per request so
    // adding a header to either turns this red while the four stay untouched.
    expect(page).toContain('"Idempotency-Key": crypto.randomUUID()');

    const createCall = page.slice(page.indexOf('"/api/v1/blog/pages"'));
    expect(createCall.slice(0, createCall.indexOf(");"))).not.toContain(
      "Idempotency-Key"
    );

    const patchCall = page.slice(page.indexOf('sendJson("PATCH"'));
    expect(patchCall.slice(0, patchCall.indexOf("});"))).not.toContain(
      "Idempotency-Key"
    );
  });

  test("form bounds come from the constants the validator enforces", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("MAX_TITLE_LENGTH");
    expect(page).toContain("MAX_EXCERPT_LENGTH");
    // A hand-typed `maxlength` drifts into a browser accepting what the server
    // rejects with a 400 the author cannot act on.
    expect(page).not.toMatch(/maxlength=\{?"?\d/);
  });

  test("re-parenting is deliberately absent — no control can build a cycle", async () => {
    const page = await readFile(PAGE, "utf8");

    // `parentPageId` is DISPLAYED (the tree is worth seeing) but never sent:
    // the API performs no cycle detection, so a `<select>` of every page would
    // let an operator make a page its own ancestor.
    expect(page).toContain("entry.parentPageId");
    expect(page).not.toMatch(/name="parentPageId"/);
    expect(page).not.toMatch(/parentPageId:\s*[A-Za-z]/);
  });
});
