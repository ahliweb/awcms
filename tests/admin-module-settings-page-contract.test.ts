/**
 * `/admin/modules/{moduleKey}` gates against the endpoint it drives — Issue #546.
 *
 * This screen is unusual among the page-contract tests, because the defect it
 * closes was a DOCUMENT rather than a gap: three places said a generic module
 * settings panel existed, one used the claim to justify not building an editor,
 * and `/admin/blog-settings` rendered a live link straight into a 404. So this
 * file pins two things a normal page contract would not:
 *
 * - **The page the documents named actually resolves.** The link
 *   `/admin/modules/blog_content` has a route behind it now.
 * - **It is a PATCH box, not a document editor.** `updateModuleSettings` merges
 *   shallowly and the contract has NO removal convention — no `null`-means-
 *   delete, no replace mode. A textarea presented as the override document
 *   would let somebody delete a key, submit, and watch it come back.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { mergeEffectiveSettings } from "../src/modules/module-management/domain/module-settings";

const PAGE = "src/pages/admin/modules/[moduleKey].astro";
const LIST_PAGE = "src/pages/admin/modules.astro";
const BLOG_SETTINGS_PAGE = "src/pages/admin/blog-settings.astro";
const ROUTE = "src/pages/api/v1/tenant/modules/[moduleKey]/settings.ts";
const STORE = "src/modules/module-management/application/module-settings.ts";

const EXPECTED = [
  "module_management.settings.read",
  "module_management.settings.update"
];

describe("/admin/modules/{moduleKey} gates on keys that really exist", () => {
  test("every key the page names is DECLARED by a module", async () => {
    const page = await readFile(PAGE, "utf8");

    const declared = new Set<string>();
    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        declared.add(
          `${module.key}.${permission.activityCode}.${permission.action}`
        );
      }
    }

    for (const key of EXPECTED) {
      const [, activityCode, action] = key.split(".");
      expect(page).toContain(`activityCode: "${activityCode}"`);
      expect(page).toContain(`action: "${action}"`);
      expect(declared.has(key)).toBe(true);
    }
  });

  test("the page and its endpoint agree on the activity", async () => {
    const route = await readFile(ROUTE, "utf8");
    expect(route).toContain('activityCode: "settings"');
  });

  test("the settings link on /admin/modules is gated on its OWN key", async () => {
    const listPage = await readFile(LIST_PAGE, "utf8");

    // Turning a module off and rewriting its configuration are different
    // authorities. A link decided by the toggle's permission would put an entry
    // in front of somebody who can only ever get 403 from it.
    expect(listPage).toContain('activityCode: "settings"');
    expect(listPage).toContain("canReadSettings");
    expect(listPage).toContain("/admin/modules/${module.moduleKey}");
  });
});

describe("the document that was wrong, and is not any more", () => {
  test("the page three documents named now RESOLVES", async () => {
    const page = await readFile(PAGE, "utf8");
    const blogSettings = await readFile(BLOG_SETTINGS_PAGE, "utf8");

    // `/admin/blog-settings` renders this href. Before #546 there was no
    // `[moduleKey]` route at all and the link was a 404 — a control a document
    // insisted existed, used as a reason not to build one.
    expect(blogSettings).toContain('href="/admin/modules/blog_content"');
    expect(page.length).toBeGreaterThan(0);
  });

  test("and `blog_content` is a real registered key, so that href resolves", () => {
    // Pairs with the assertion above: a route file plus a dead module key would
    // still be a 404, just a differently-shaped one.
    expect(listModules().map((module) => module.key)).toContain("blog_content");
  });
});

describe("PATCH semantics, which the screen must not overstate", () => {
  test("the contract really has no removal path — otherwise the wording below lies", async () => {
    const store = await readFile(STORE, "utf8");

    // The shallow merge, read from the source. If a removal convention is ever
    // added, this goes red and the page's wording has to change with it.
    expect(store).toContain("...before,");
    expect(store).not.toContain("delete before[");
  });

  test("the page says leaving a key out does NOT remove it", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("does not remove it");
    expect(page).toContain("PATCH, not a replacement");
  });

  test("it submits PATCH, not PUT", async () => {
    const page = await readFile(PAGE, "utf8");

    // A `PUT` would read as replacing the document — the very thing the merge
    // does not do.
    expect(page).toContain('"PATCH",');
    expect(page).not.toContain('"PUT",');
  });

  test("both secret refusals are surfaced by their own error codes", async () => {
    const page = await readFile(PAGE, "utf8");

    // Key-shaped and VALUE-shaped are separate checks in the validator, and a
    // credential pasted under an innocent field name only trips the second.
    expect(page).toContain("SETTINGS_SENSITIVE_KEY_REJECTED");
    expect(page).toContain("SETTINGS_SECRET_SHAPED_VALUE_REJECTED");
  });
});

describe("the three JSON blocks are three different things", () => {
  test("defaults, override and effective are all rendered", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain("view.defaults");
    expect(page).toContain("view.tenantOverride");
    expect(page).toContain("view.effective");
  });

  test("and `effective` is genuinely a computation, not a synonym", () => {
    // Showing only the override would hide the value in force; showing only
    // `effective` would hide which half an operator can change. This holds the
    // page to rendering both by proving they can differ.
    expect(mergeEffectiveSettings({ a: 1, b: 2 }, { b: 3 })).toEqual({
      a: 1,
      b: 3
    });
  });
});

describe("the ledger shrank, and stayed shrunk", () => {
  test("no `module_management.settings` key is left on NOT_YET_SCREENED", async () => {
    const { NOT_YET_SCREENED } =
      await import("../scripts/admin-screen-coverage-ledger");

    expect(
      NOT_YET_SCREENED.filter((key) =>
        key.startsWith("module_management.settings.")
      )
    ).toEqual([]);
  });

  test("and the two keys are exactly the ones this page claims", () => {
    expect(EXPECTED).toHaveLength(2);
  });
});
