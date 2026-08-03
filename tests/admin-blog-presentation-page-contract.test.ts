/**
 * `/admin/blog-presentation` gates against the endpoints it drives, and is
 * explicit about what it deliberately does not offer.
 *
 * Fourth sibling of the blog console contract tests. What is specific here:
 *
 * - **four independent permission pairs on one screen.** Holding
 *   `widgets.configure` must not reveal a template control. A combined gate
 *   would look tidier and be wrong for every real operator — the
 *   `/admin/data-lifecycle` lesson;
 * - **the menu PATCH must never carry `items`.** The endpoint replaces the
 *   whole item list, so a form that sends a partial one deletes the rest. The
 *   only safe shape is to omit the key entirely, and that is asserted;
 * - **no "revert to tenant default" for the theme.** `upsertBlogThemeSettings`
 *   only INSERTs or UPDATEs and no delete route exists, so an override cannot
 *   be cleared. A button on a path that cannot succeed is the #351 shape;
 * - **`key` is sent on create and never on update**, because the update inputs
 *   have no `key` field at all.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/blog-presentation.astro";

const ROUTES = [
  "src/pages/api/v1/blog/templates/index.ts",
  "src/pages/api/v1/blog/templates/[id].ts",
  "src/pages/api/v1/blog/menus/index.ts",
  "src/pages/api/v1/blog/menus/[id].ts",
  "src/pages/api/v1/blog/widgets/index.ts",
  "src/pages/api/v1/blog/widgets/[id].ts",
  "src/pages/api/v1/blog/theme/index.ts"
];

/** All eight — four activities, `read` + `configure` each. */
const PRESENTATION_KEYS = [
  "blog_content.menus.configure",
  "blog_content.menus.read",
  "blog_content.templates.configure",
  "blog_content.templates.read",
  "blog_content.theme.configure",
  "blog_content.theme.read",
  "blog_content.widgets.configure",
  "blog_content.widgets.read"
] as const;

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/**
 * Strips comments before asserting on absences. Line comments FIRST — see
 * `tests/admin-blog-taxonomy-page-contract.test.ts` for why the other order
 * silently eats thousands of characters (`/_astro/*.js` inside a `//` line).
 */
function code(source: string): string {
  return source
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** `code()` plus proof it did not eat the region under test. */
function expectCode(source: string, anchor: string): string {
  const stripped = code(source);
  expect(stripped).toContain(anchor);
  return stripped;
}

function pageKeys(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(
    /can\(\s*"([a-z_]+)"\s*,\s*"([a-z_]+)"\s*\)/g
  )) {
    found.add(`blog_content.${match[1]}.${match[2]}`);
  }
  return found;
}

function guardKeys(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)"[\s\S]{0,120}?activityCode:\s*"([a-z_]+)"[\s\S]{0,120}?action:\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return found;
}

describe("/admin/blog-presentation permission gates", () => {
  test("the screen claims exactly the eight presentation permissions", async () => {
    const keys = pageKeys(await read(PAGE));

    expect([...keys].sort()).toEqual([...PRESENTATION_KEYS]);
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

    for (const key of PRESENTATION_KEYS) {
      expect(declared.has(key)).toBe(true);
    }
  });

  test("what the screen claims is what the routes actually enforce", async () => {
    const enforced = new Set<string>();
    for (const route of ROUTES) {
      for (const key of guardKeys(await read(route))) enforced.add(key);
    }

    for (const key of PRESENTATION_KEYS) {
      expect(enforced.has(key)).toBe(true);
    }
  });

  test("the four activities are gated independently, not by one combined flag", async () => {
    const page = expectCode(await read(PAGE), "canConfigureWidgets");

    // Eight distinct consts. A screen that collapsed them into one
    // `canConfigure` would let `widgets.configure` reveal template controls.
    //
    // Word-boundary matched, not `toContain`: the first draft used
    // `toContain` and a mutation renaming `canConfigureWidgets` to
    // `canConfigureWidgetsX` PASSED, because the old name is a prefix of the
    // new one. A test that survives the rename it exists to catch is not a
    // test.
    for (const name of [
      "canReadTemplates",
      "canConfigureTemplates",
      "canReadMenus",
      "canConfigureMenus",
      "canReadWidgets",
      "canConfigureWidgets",
      "canReadTheme",
      "canConfigureTheme"
    ]) {
      expect(page).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  test("the menu payload never carries `items` — the PATCH replaces the whole list", async () => {
    const page = expectCode(await read(PAGE), '"menus"');

    // The single most destructive thing this screen could do: send a partial
    // item list to an endpoint with full-replace semantics.
    expect(page).not.toContain("items:");
  });

  test("`key` is sent on create and never on update", async () => {
    const page = expectCode(await read(PAGE), "isCreate");

    // `UpdateTemplateInput` and the menu PATCH have no `key`. Guarding the
    // assignment on `isCreate` is what keeps an update from asserting one.
    expect(page).toMatch(/if \(isCreate\) body\.key =/);

    // And never unguarded.
    const unguarded = page.match(/(?<!if \(isCreate\) )body\.key =/g);
    expect(unguarded).toBeNull();
  });

  test("no control offers to clear the theme override, because nothing can", async () => {
    const page = expectCode(await read(PAGE), "theme-form");

    // `upsertBlogThemeSettings` only INSERTs/UPDATEs; there is no delete
    // function and no route, so an override is one-way.
    expect(page).not.toMatch(
      /revert|clear.{0,20}override|remove.{0,20}override/i
    );

    // The screen must SAY so rather than leaving the operator to discover it.
    // Whitespace-normalised: prettier reflows markup, so an assertion pinned
    // to exact line breaks fails on formatting rather than on meaning.
    const prose = (await read(PAGE)).replace(/\s+/g, " ");
    expect(prose).toContain("cannot be removed");
  });

  test("no bin view and no Restore — these soft deletes are one-way too", async () => {
    const page = expectCode(await read(PAGE), "presentation-delete-btn");

    expect(page).not.toContain("view=deleted");
    expect(page).not.toMatch(/>\s*Restore\s*</);
    expect(page).not.toMatch(/recoverable|until it is purged|can be restored/i);
  });

  test("every delete sends the `reason` its endpoint requires", async () => {
    const page = expectCode(await read(PAGE), '"DELETE"');

    expect(page).toContain("reason:");

    // Bound to the routes: all three DELETEs validate it, so a screen that
    // stopped sending one would 400 on every click.
    for (const route of ROUTES.filter((path) => path.includes("[id]"))) {
      expect(await read(route)).toContain("validateDeleteReasonInput");
    }
  });

  test("the screen sends no Idempotency-Key, because no endpoint reads one", async () => {
    expect(expectCode(await read(PAGE), "sendJson")).not.toContain(
      "Idempotency-Key"
    );

    for (const route of ROUTES) {
      expect(
        expectCode(await read(route), "authorizeInTransaction").toLowerCase()
      ).not.toContain("idempotency-key");
    }
  });

  test("the screen never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await read(PAGE);

    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain("/api/v1/blog/theme");
  });

  test("the navigation entry exists and is gated on a permission it drives", () => {
    const blog = listModules().find((module) => module.key === "blog_content");
    const entry = (blog?.navigation ?? []).find(
      (item) => item.path === "/admin/blog-presentation"
    );

    expect(entry).toBeDefined();
    // `requiredPermission` is optional on the descriptor type, so narrow it
    // rather than asserting through it: an entry that dropped its gate would
    // otherwise fail as a type error instead of as a finding.
    const required = entry?.requiredPermission;
    expect(required).toBeDefined();
    expect(PRESENTATION_KEYS as readonly string[]).toContain(required!);
  });
});
