/**
 * Source-contract test for Issue #860 (parent epic #858, wave 2 of
 * `docs/awcms/admin-ui-parity-matrix.md` §7): the dashboard/reporting/
 * analytics screens migrate their KPI tiles from the legacy, per-repo
 * `.stat-card`/`.stat-grid` family (`src/styles/admin-screens.css`) onto the
 * shared `.admin-stat-card` primitive (`src/styles/admin.css`, upstreamed
 * from `ahliweb/awcms-one#170`, PR #813).
 *
 * Pure source-text assertions — no database, no rendering. What this pins:
 *
 *   1. Each of the four migrated screens contains at least one
 *      `.admin-stat-card` site (the migration actually happened, not just
 *      "the file still parses").
 *   2. None of the four contains the legacy `stat-card`/`stat-grid`/
 *      `stat-label`/`stat-value`/`stat-hint` class tokens anymore — a partial
 *      migration that leaves both systems mixed on one screen is exactly the
 *      "two competing central definitions" duplication the parity matrix
 *      audit (§4) flags, and this issue's job is to remove it for these four
 *      files specifically.
 *   3. The legacy `.stat-card`/`.stat-grid`/`.stat-head`/`.stat-delta`
 *      declarations were retired from `src/styles/admin-screens.css` once
 *      Issue #866 (wave 7) migrated the last consumers — this test now pins
 *      their ABSENCE rather than their presence (see
 *      tests/admin-legacy-classes-retired.test.ts for the repo-wide gate).
 *   4. `.admin-stat-card`'s new optional modifiers (icon-head row and signed
 *      delta, ported from the legacy `.stat-head`/`.stat-delta` pair per the
 *      matrix's wave 2 decision) are defined in `src/styles/admin.css`, and
 *      the delta modifier's positive/negative tones each carry a non-colour
 *      glyph — colour is never the only channel carrying the sign.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

const MIGRATED_SCREENS = [
  "src/pages/admin/index.astro",
  "src/pages/admin/analytics.astro",
  "src/pages/admin/reporting.astro",
  "src/pages/admin/omes/index.astro"
] as const;

// Legacy class tokens exactly as `class="..."` would spell them — matched as
// a whole class-attribute value so `omes-stat-breakdown*` (a distinct,
// unrelated component on the OMES overview screen) never false-positives.
const LEGACY_STAT_CARD_CLASSES = [
  "stat-card",
  "stat-grid",
  "stat-label",
  "stat-value",
  "stat-hint"
] as const;

function legacyClassPattern(token: string): RegExp {
  // Matches `class="stat-card"`, `class="stat-card foo"`,
  // `class="foo stat-card"` and `class="stat-value stat-value--mono"` —
  // i.e. the token as one whole space-separated word inside a class
  // attribute — without matching `omes-stat-breakdown-value` (no leading/
  // trailing quote or space boundary around the substring there) or
  // `admin-stat-card-value` (the new primitive; a leading `-` after the
  // matched token is excluded by the boundary below).
  return new RegExp(`class="([^"]*\\s)?${token}(\\s[^"]*)?"`);
}

describe("admin-stat-card-wave2 (#860): dashboard/reporting/analytics migration", () => {
  for (const screenPath of MIGRATED_SCREENS) {
    test(`${screenPath} uses .admin-stat-card`, async () => {
      const source = await readFile(screenPath, "utf8");

      expect(source).toContain('class="admin-stat-card"');
    });

    for (const legacyToken of LEGACY_STAT_CARD_CLASSES) {
      test(`${screenPath} no longer uses the legacy .${legacyToken}`, async () => {
        const source = await readFile(screenPath, "utf8");

        expect(source).not.toMatch(legacyClassPattern(legacyToken));
      });
    }
  }

  test("legacy .stat-card/.stat-grid/.stat-head/.stat-delta are retired from admin-screens.css (#866, wave 7)", async () => {
    const css = await readFile("src/styles/admin-screens.css", "utf8");

    expect(css).not.toContain(".stat-card {");
    expect(css).not.toContain(".stat-grid {");
    expect(css).not.toContain(".stat-card .stat-head {");
    expect(css).not.toContain(".stat-card .stat-delta {");
  });

  test(".admin-stat-card gains an optional icon-head row and a signed-delta modifier in admin.css", async () => {
    const css = await readFile("src/styles/admin.css", "utf8");

    expect(css).toContain(".admin-stat-card-head {");
    expect(css).toContain(".admin-stat-card-delta {");
    expect(css).toContain('.admin-stat-card-delta[data-tone="positive"]');
    expect(css).toContain('.admin-stat-card-delta[data-tone="negative"]');
  });

  test("the delta modifier's own doc comment requires a non-colour channel from its consumer, not colour alone", async () => {
    const css = await readFile("src/styles/admin.css", "utf8");
    const deltaBlock = css.slice(
      css.indexOf("Signed delta"),
      css.indexOf('.admin-stat-card-delta[data-tone="negative"] {') + 200
    );

    // `.admin-stat-card-delta` itself carries only colour (`color:` per
    // tone). WCAG 1.4.1 is satisfied by the CONSUMER writing the sign
    // character into the value text — the doc comment right above the class
    // must say so explicitly, so a future editor cannot silently drop that
    // requirement and ship colour-only deltas.
    expect(deltaBlock).toMatch(/never carried by colour alone/i);
    expect(deltaBlock).toMatch(/leading .*\+.*-.*character/i);
    expect(deltaBlock).toMatch(/visually-hidden/i);
  });
});
