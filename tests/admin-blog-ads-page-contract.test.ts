/**
 * `/admin/blog-ads` gates against the endpoints it drives.
 *
 * Sibling of `admin-blog-homepage-page-contract.test.ts`, for the same silent
 * failure a page inventing a plausible action name produces: the section hides
 * from everyone including the owner, and the screen still looks like it works.
 *
 * The properties specific to THIS screen are the ones a reviewer cannot check by
 * reading the markup:
 *
 * - every declared slot, rotation mode and target type is offered, in both
 *   directions, so adding a thirteenth `placementKey` cannot ship a form that
 *   silently cannot book it;
 * - a `global` placement sends `targetId: null` rather than `""`, because the
 *   pairing rule is a DATABASE CHECK and an empty string violates it;
 * - the creative goes through the ONE shared media picker rather than a second
 *   one grown here.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { listModules } from "../src/modules";
import {
  AD_PLACEMENT_KEYS,
  AD_ROTATION_MODES,
  AD_TARGET_TYPES
} from "../src/modules/blog-content/domain/ad-placement-policy";
import { NOT_YET_SCREENED } from "../scripts/admin-screen-coverage-ledger";

const PAGE = "src/pages/admin/blog-ads.astro";
const ROUTES = [
  "src/pages/api/v1/news-portal/ad-placements/index.ts",
  "src/pages/api/v1/news-portal/ad-placements/[id].ts"
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

describe("/admin/blog-ads permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = triplesFrom(await readFile(PAGE, "utf8"));

    expect(pageKeys).toEqual(
      new Set([
        "blog_content.ad_placements.read",
        "blog_content.ad_placements.configure"
      ])
    );

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of triplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Proves the guards really were parsed — an empty `enforced` would make the
    // subset check pass vacuously.
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

    expect(declared.has("blog_content.ad_placements.read")).toBe(true);
    expect(declared.has("blog_content.ad_placements.configure")).toBe(true);
  });

  test("both keys left the unscreened ledger, which may only shrink", () => {
    expect(NOT_YET_SCREENED).not.toContain("blog_content.ad_placements.read");
    expect(NOT_YET_SCREENED).not.toContain(
      "blog_content.ad_placements.configure"
    );
  });

  test("the sidebar entry points at this page and is gated on read", () => {
    const nav = listModules()
      .find((module) => module.key === "blog_content")
      ?.navigation?.find((entry) => entry.path === "/admin/blog-ads");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("blog_content.ad_placements.read");
  });
});

describe("/admin/blog-ads writes only through the guarded endpoints", () => {
  test("the page never mutates directly", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
    expect(page).toContain('"/api/v1/news-portal/ad-placements"');
  });

  test("no request carries an Idempotency-Key, because no endpoint offers one", async () => {
    // Comment-stripped: the docblock EXPLAINS why no key is sent, and an
    // assertion that reads the explanation rather than the code is a defect this
    // repo has already shipped once.
    const page = stripComments(await readFile(PAGE, "utf8"));
    const routes = await Promise.all(
      ROUTES.map(async (path) => stripComments(await readFile(path, "utf8")))
    );

    expect(page).not.toContain("Idempotency-Key");
    for (const route of routes) {
      expect(route).not.toContain("IDEMPOTENCY_REQUIRED");
    }
  });
});

describe("the form offers exactly the vocabulary the domain declares", () => {
  test("every list is ITERATED from its constant, never copied into the markup", async () => {
    const page = await readFile(PAGE, "utf8");

    // Deliberately not "does the source contain `header_banner`" — it does not,
    // and it should not. A screen that spelled the twelve keys out would pass
    // that assertion and still fail to offer the thirteenth. Iterating the
    // exported constant is the property that makes a new key appear by itself,
    // so that is what is pinned.
    expect(page).toContain("AD_PLACEMENT_KEYS.map(");
    expect(page).toContain("AD_ROTATION_MODES.map(");
    expect(page).toContain("AD_TARGET_TYPES.map(");
    expect(page).toContain("AD_PLACEMENT_PRESETS[key]");

    // And the constants really are non-empty, so the loops above are not
    // iterating nothing — the vacuous-pass shape this repo has been burned by.
    expect(AD_PLACEMENT_KEYS.length).toBeGreaterThan(0);
    expect(AD_ROTATION_MODES.length).toBeGreaterThan(0);
    expect(AD_TARGET_TYPES.length).toBeGreaterThan(0);
  });

  test("a global placement sends a null target id, never an empty string", async () => {
    const page = stripComments(await readFile(PAGE, "utf8"));

    // `awcms_news_portal_ad_placements_target_pairing_check` requires
    // `target_id IS NULL` for `global`. An empty string is not null, so sending
    // one turns a correct booking into a constraint violation the operator
    // never chose and cannot act on.
    expect(page).toMatch(
      /targetId:\s*targetType === "global" \? null : inputValue\("ad-target-id"\)/
    );
  });

  test("the slot is fixed after booking", async () => {
    const page = await readFile(PAGE, "utf8");

    // `placementKey` is absent from `validateUpdateAdPlacementInput`'s writable
    // set in practice — moving a booked creative between slots is a new booking,
    // not an edit, because the recommended size and item cap both change with it.
    expect(page).toContain("disabled={editing !== null}");
  });

  test("the creative goes through the ONE shared media picker", async () => {
    const page = await readFile(PAGE, "utf8");

    // Issue #595 is explicit: "satu pemilih, bukan dua". A second picker grown
    // here would be the one nobody looks at when the first one changes.
    expect(page).toContain("wireMediaPickers");
    expect(page).toContain('data-target="ad-media-object-id"');
    expect(page).not.toContain("fetchPickableMedia");
  });

  test("schedules are converted to an absolute instant before they are sent", async () => {
    const page = await readFile(PAGE, "utf8");

    expect(page).toContain('localDateTimeToInstant("ad-starts-at")');
    expect(page).toContain('localDateTimeToInstant("ad-ends-at")');
  });

  test("every slot is listed even when nothing is booked into it", async () => {
    const page = await readFile(PAGE, "utf8");

    // FR-ADS-007 — an empty slot renders an availability notice. A table built
    // from the ROWS instead of from the SLOTS would make an unsold slot
    // indistinguishable from a slot that does not exist.
    expect(page).toContain("data-slot-empty");
    expect(page).toContain("AD_PLACEMENT_KEYS.map((key)");
  });
});
