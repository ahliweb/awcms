/**
 * Advertisement slots on the public pages (Issue #594, FR-ADS-007).
 *
 * The assertion this file exists for is the two-way one over
 * `AD_PLACEMENT_RENDER_SURFACES`. Twelve slots are bookable because the database
 * CHECK accepts twelve, and only the ones a template renders will ever be seen —
 * a slot that is bookable but unrendered is "declared, validated, never read",
 * and its symptom is a booking that succeeds, an audit row that is written, an
 * invoice that goes out, and nothing on the page.
 *
 * So the map is checked against the real route files in BOTH directions, and the
 * admin screen is checked to read the same constant. Everything else here is the
 * placeholder policy and the escaping.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import {
  AD_PLACEMENT_KEYS,
  type AdPlacementKey
} from "../src/modules/blog-content/domain/ad-placement-policy";
import {
  AD_PLACEMENT_RENDER_SURFACES,
  insertMidArticleSlotHtml,
  isAdSlotRenderedHere,
  renderAdSlotHtml
} from "../src/modules/blog-content/domain/ad-slot-rendering";
import { composeAdSlots } from "../src/modules/blog-content/application/ad-slot-composition";

const PLACEHOLDER = "Ad space available — contact us.";
const TENANT = "11111111-1111-4111-8111-111111111111";

describe("AD_PLACEMENT_RENDER_SURFACES is total and true", () => {
  test("every declared placement key has an entry", () => {
    const missing = AD_PLACEMENT_KEYS.filter(
      (key) => !(key in AD_PLACEMENT_RENDER_SURFACES)
    );

    expect(missing).toEqual([]);
    expect(Object.keys(AD_PLACEMENT_RENDER_SURFACES).sort()).toEqual(
      [...AD_PLACEMENT_KEYS].sort()
    );
  });

  test("a slot it claims is rendered really appears in every route it names", async () => {
    const failures: string[] = [];

    for (const key of AD_PLACEMENT_KEYS) {
      for (const routePath of AD_PLACEMENT_RENDER_SURFACES[key]) {
        const source = await readFile(routePath, "utf8");

        if (!source.includes(`"${key}"`)) {
          failures.push(`${routePath} does not render "${key}"`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test("a slot it claims is NOT rendered appears in no public route", async () => {
    // The direction that matters more. Without it, deleting a slot from a
    // template leaves the map claiming coverage that no longer exists, and the
    // admin screen keeps telling the operator the booking will be shown.
    const routes = new Set(
      AD_PLACEMENT_KEYS.flatMap((key) => [...AD_PLACEMENT_RENDER_SURFACES[key]])
    );
    const sources = await Promise.all(
      [...routes].map((routePath) => readFile(routePath, "utf8"))
    );

    // Proves the corpus is not empty — otherwise every `not.toContain` below
    // passes vacuously.
    expect(sources.length).toBeGreaterThan(0);

    const unrendered = AD_PLACEMENT_KEYS.filter(
      (key) => AD_PLACEMENT_RENDER_SURFACES[key].length === 0
    );

    // And that there ARE unrendered slots to check: if this ever reaches zero
    // the assertion below stops testing anything, which is worth noticing.
    expect(unrendered).toEqual([
      "sidebar_top",
      "sidebar_middle",
      "sidebar_bottom"
    ]);

    for (const key of unrendered) {
      for (const source of sources) {
        expect(source).not.toContain(`"${key}"`);
      }
    }
  });

  test("the booking screen reads the same constant rather than a copy of it", async () => {
    const page = await readFile("src/pages/admin/blog-ads.astro", "utf8");

    expect(page).toContain("isAdSlotRenderedHere");
    expect(page).toContain("Not rendered here");
    // A hand-written list of the three sidebar keys on the screen would drift
    // from the map the moment a template grew a sidebar.
    expect(page).not.toContain('"sidebar_top"');
  });

  test("isAdSlotRenderedHere agrees with the map", () => {
    for (const key of AD_PLACEMENT_KEYS) {
      expect(isAdSlotRenderedHere(key)).toBe(
        AD_PLACEMENT_RENDER_SURFACES[key].length > 0
      );
    }
  });
});

describe("renderAdSlotHtml", () => {
  test("renders the ads it is given, tagged with the slot", () => {
    const html = renderAdSlotHtml(
      "header_banner",
      ['<div class="ad"><img src="https://cdn/x.jpg" alt="x"></div>'],
      PLACEHOLDER
    );

    expect(html).toContain('data-ad-slot="header_banner"');
    expect(html).toContain("<img");
    expect(html).not.toContain(PLACEHOLDER);
  });

  test("an unsold slot shows the availability notice, escaped", () => {
    const html = renderAdSlotHtml(
      "sidebar_top",
      [],
      "<script>alert(1)</script>"
    );

    expect(html).toContain("ad-slot--available");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("a null label renders nothing at all", () => {
    // The case that keeps this feature from defacing a site that sells no
    // advertising: no markup, not an empty box.
    expect(renderAdSlotHtml("header_banner", [], null)).toBe("");
  });
});

describe("insertMidArticleSlotHtml", () => {
  const SLOT = '<aside class="ad-slot"></aside>';

  test("lands between two blocks rather than after the last one", () => {
    const content = ["<p>a</p>", "<p>b</p>", "<p>c</p>", "<p>d</p>"].join("\n");
    const result = insertMidArticleSlotHtml(content, SLOT);

    expect(result.split("\n")).toEqual([
      "<p>a</p>",
      "<p>b</p>",
      SLOT,
      "<p>c</p>",
      "<p>d</p>"
    ]);
  });

  test("a one-block article puts it after the block", () => {
    expect(insertMidArticleSlotHtml("<p>only</p>", SLOT)).toBe(
      `<p>only</p>\n${SLOT}`
    );
  });

  test("an empty slot leaves the content byte-identical", () => {
    const content = "<p>a</p>\n<p>b</p>";

    expect(insertMidArticleSlotHtml(content, "")).toBe(content);
  });
});

describe("composeAdSlots", () => {
  function fakeTx(hasInventory: boolean): {
    tx: Bun.SQL;
    queries: string[];
  } {
    const queries: string[] = [];

    const tx = ((strings: TemplateStringsArray) => {
      const sql = strings.join(" ? ");
      queries.push(sql);

      if (sql.includes("SELECT 1 AS present")) {
        return Promise.resolve(hasInventory ? [{ present: 1 }] : []);
      }

      return Promise.resolve([]);
    }) as unknown as Bun.SQL;

    return { tx, queries };
  }

  test("a tenant with no inventory costs ONE query and renders nothing", async () => {
    const { tx, queries } = fakeTx(false);
    const slots = await composeAdSlots(
      tx,
      TENANT,
      ["header_banner", "homepage_middle"],
      { placeholderLabel: PLACEHOLDER }
    );

    expect(queries).toHaveLength(1);
    // Present-but-empty, so a caller can interpolate without branching and the
    // page comes out exactly as it did before this feature existed.
    expect([...slots.keys()].sort()).toEqual([
      "header_banner",
      "homepage_middle"
    ]);
    expect([...slots.values()]).toEqual(["", ""]);
  });

  test("a tenant WITH inventory gets the availability notice in an unsold slot", async () => {
    const { tx, queries } = fakeTx(true);
    const slots = await composeAdSlots(tx, TENANT, ["header_banner"], {
      placeholderLabel: PLACEHOLDER
    });

    // One EXISTS plus one per slot.
    expect(queries).toHaveLength(2);
    expect(slots.get("header_banner")).toContain("ad-slot--available");
    expect(slots.get("header_banner")).toContain(PLACEHOLDER);
  });

  test("asking for no slots asks the database nothing", async () => {
    const { tx, queries } = fakeTx(true);
    const slots = await composeAdSlots(tx, TENANT, [] as AdPlacementKey[], {
      placeholderLabel: PLACEHOLDER
    });

    expect(queries).toEqual([]);
    expect(slots.size).toBe(0);
  });
});
