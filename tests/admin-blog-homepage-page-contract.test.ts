/**
 * `/admin/blog-homepage` gates against the endpoints it drives.
 *
 * Sibling of `admin-site-search-page-contract.test.ts`, for the same silent
 * failure: a page that gates on a permission key no migration seeds hides the
 * section from everyone — including the owner — and still looks like a working
 * screen with an empty area. This repo has shipped that bug twice, both times by
 * inventing a plausible action name.
 *
 * It also pins the two properties specific to a POLYMORPHIC form, because both
 * fail silently rather than loudly:
 *
 * - every declared section type has a config group in the markup, so adding a
 *   seventh type to `HOMEPAGE_SECTION_TYPES` cannot ship a form that renders no
 *   fields for it and posts `config: {}`;
 * - the schedule inputs are converted to an absolute instant before they are
 *   sent, because `datetime-local` carries no zone and the endpoint would read
 *   the string in the SERVER's timezone.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { listModules } from "../src/modules";
import { HOMEPAGE_SECTION_TYPES } from "../src/modules/blog-content/domain/homepage-section-policy";
import { NOT_YET_SCREENED } from "../scripts/admin-screen-coverage-ledger";

const PAGE = "src/pages/admin/blog-homepage.astro";
const ROUTES = [
  "src/pages/api/v1/news-portal/homepage-sections/index.ts",
  "src/pages/api/v1/news-portal/homepage-sections/[id].ts"
];

type Triple = `${string}.${string}.${string}`;

function triplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  for (const match of source.matchAll(
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

describe("/admin/blog-homepage permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = triplesFrom(await readFile(PAGE, "utf8"));

    expect(pageKeys).toEqual(
      new Set([
        "blog_content.homepage_sections.read",
        "blog_content.homepage_sections.configure"
      ])
    );

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of triplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Proves the guards really were parsed — an empty `enforced` would make the
    // subset check pass vacuously, the shape of gate this repo has been burned
    // by before.
    expect(enforced.size).toBeGreaterThan(0);
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and both keys are declared by the module descriptor, so a migration seeds them", () => {
    const declared = new Set(
      (
        listModules().find((module) => module.key === "blog_content")
          ?.permissions ?? []
      ).map(
        (permission) =>
          `blog_content.${permission.activityCode}.${permission.action}`
      )
    );

    expect(declared.has("blog_content.homepage_sections.read")).toBe(true);
    expect(declared.has("blog_content.homepage_sections.configure")).toBe(true);
  });

  test("the two keys left the unscreened ledger, which may only shrink", () => {
    expect(NOT_YET_SCREENED).not.toContain(
      "blog_content.homepage_sections.read"
    );
    expect(NOT_YET_SCREENED).not.toContain(
      "blog_content.homepage_sections.configure"
    );
    // Still there — the ad inventory screen is the next PR, and this asserts the
    // shrink was exactly the two keys this screen earned.
    expect(NOT_YET_SCREENED).toContain("blog_content.ad_placements.read");
  });

  test("the sidebar entry points at this page and is gated on read", () => {
    const nav = listModules()
      .find((module) => module.key === "blog_content")
      ?.navigation?.find((entry) => entry.path === "/admin/blog-homepage");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("blog_content.homepage_sections.read");
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS; this pins the gate specifically.
  });
});

describe("/admin/blog-homepage writes only through the guarded endpoints", () => {
  test("the page never mutates directly", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain('"/api/v1/news-portal/homepage-sections"');
  });

  test("no request carries an Idempotency-Key, because no endpoint offers one", async () => {
    // Comment-stripped: this file's own docblock EXPLAINS why no key is sent,
    // and an assertion that reads the explanation rather than the code is the
    // defect this repo has already shipped once.
    const page = stripComments(await readFile(PAGE, "utf8"));
    const routes = await Promise.all(
      ROUTES.map(async (path) => stripComments(await readFile(path, "utf8")))
    );

    // Two-way: the screen must not imply a replay contract, and the endpoints
    // must not start requiring one without the screen learning about it.
    expect(page).not.toContain("Idempotency-Key");
    for (const route of routes) {
      expect(route).not.toContain("IDEMPOTENCY_REQUIRED");
    }
  });

  test("it only ever offers articles a curated slot would really render", async () => {
    const page = await readFile(PAGE, "utf8");

    // `listPublicBlogPosts` carries the published + `visibility = 'public'` +
    // reached-`published_at` predicate. The admin list functions do not, and
    // offering a draft would let an editor curate a slot that renders nothing.
    expect(page).toContain("listPublicBlogPosts");
    expect(page).not.toContain("listBlogPostsForAdmin");
  });
});

describe("the polymorphic form covers every declared section type", () => {
  test("each type resolves to a config group present in the markup", async () => {
    const page = await readFile(PAGE, "utf8");

    const groups = new Set(
      [...page.matchAll(/data-config-for="([a-z_]+)"/g)].map(
        (match) => match[1] as string
      )
    );

    expect(groups.size).toBeGreaterThan(0);

    // `featured_posts` and `editor_picks` share one group — they are the same
    // `{ postIds }` shape — so the mapping is asserted rather than assumed.
    const groupFor = (type: string): string =>
      type === "featured_posts" || type === "editor_picks" ? "curated" : type;

    const missing = HOMEPAGE_SECTION_TYPES.filter(
      (type) => !groups.has(groupFor(type))
    );

    expect(missing).toEqual([]);

    // And nothing the other way: a group for a type that no longer exists would
    // render fields whose values are dropped on submit.
    const reachable = new Set(HOMEPAGE_SECTION_TYPES.map(groupFor));
    expect([...groups].filter((group) => !reachable.has(group))).toEqual([]);
  });

  test("the two shared-shape types map to the same group in the script", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toMatch(
      /sectionType === "featured_posts" \|\| sectionType === "editor_picks"/
    );
  });

  test("a schedule is converted to an absolute instant before it is sent", async () => {
    const page = await readFile(PAGE, "utf8");

    // Without this the endpoint parses a zone-less `2026-08-21T09:00` in the
    // SERVER's timezone, so a section scheduled from Palangka Raya starts at
    // the wrong hour and nothing reports an error.
    expect(page).toContain("toISOString()");
    expect(page).toContain('instantOrNull("section-starts-at")');
    expect(page).toContain('instantOrNull("section-ends-at")');
  });

  test("the type is immutable in edit mode and still reaches the script", async () => {
    const page = await readFile(PAGE, "utf8");

    // A disabled `<select>` is omitted from `FormData` entirely, so edit mode
    // renders the type as text plus a hidden input. Losing it would make
    // `buildConfig` fall through to `{}` and wipe the section's configuration.
    expect(page).toContain('type="hidden"');
    expect(page).toContain('id="section-type"');
    expect(page).toContain("cannot be changed after a section is created");
  });
});
