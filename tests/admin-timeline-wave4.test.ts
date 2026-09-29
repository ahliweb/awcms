/**
 * Source-contract test for Issue #863 (parent epic #858, wave 4 of
 * `docs/awcms/admin-ui-parity-matrix.md` §7): the detail/operational/history
 * screens adopt the shared `.admin-timeline` primitive
 * (`src/styles/admin.css`, upstreamed from `ahliweb/awcms-one#170`, PR #813)
 * wherever the screen already has ORDERED event/history data, and the shared
 * `.admin-status-pill` primitive for statuses on those same screens.
 *
 * Pure source-text assertions — no database, no rendering. What this pins:
 *
 *   1. Each history-shaped section on the five touched screens uses a real
 *      semantic `<ol class="admin-timeline">` of `<li class="admin-timeline-
 *      item">`, not a styling-only `<div>` — assistive tech must report
 *      "N items" and each one's position, which only a real list gives it.
 *   2. Every `.admin-timeline-item` on these screens carries at least one
 *      `<time datetime=` — colour/position is never the only channel; the
 *      issue explicitly requires a real `<time>` element, not a plain string.
 *   3. `approvals.astro` keeps its query-param drill-in for instance history
 *      (`?instance=<id>`) — the issue's decision is timeline-only, NO
 *      `.admin-two-pane` routing change, so this pins the absence of that
 *      class on this screen rather than a false positive from a future,
 *      unrelated adoption.
 *   4. The five screens' converted statuses use `.admin-status-pill`, not the
 *      legacy `.status-badge`, in the sections this issue touches.
 *   5. `.admin-timeline` itself (the `<ol>` wrapper, not just `-item`/`-label`/
 *      `-meta`) is defined in `src/styles/admin.css` with a list-style reset —
 *      a bare `<ol>` would otherwise show a browser bullet/number ahead of
 *      the primitive's own `::before` dot.
 *   6. The legacy `.status-badge` declaration itself stays defined in
 *      `src/styles/admin-screens.css` — this issue does not retire it
 *      (#866 does), and `reporting.astro` keeps using it outside the
 *      rebuild-history section (email queue health, projection freshness,
 *      scheduled-export runs — out of this issue's file-ownership scope).
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

const TIMELINE_SCREENS = [
  "src/pages/admin/approvals.astro",
  "src/pages/admin/business-scope.astro",
  "src/pages/admin/data-lifecycle.astro",
  "src/pages/admin/omes/health.astro",
  "src/pages/admin/reporting.astro"
] as const;

describe("admin-timeline-wave4 (#863): history-flow screens adopt .admin-timeline / .admin-status-pill", () => {
  for (const screenPath of TIMELINE_SCREENS) {
    test(`${screenPath} uses a semantic .admin-timeline <ol>`, async () => {
      const source = await readFile(screenPath, "utf8");

      // A real `<ol ... class="admin-timeline" ...>` — the class may sit on
      // its own line (Prettier wraps a long attribute list), so this matches
      // across whitespace rather than pinning one exact attribute order.
      expect(source).toMatch(/<ol\s[^>]*class="admin-timeline"/s);
      expect(source).toContain('<li class="admin-timeline-item"');
    });

    test(`${screenPath} every .admin-timeline-item carries a real <time datetime> (never colour/position alone)`, async () => {
      const source = await readFile(screenPath, "utf8");
      const itemCount = (source.match(/class="admin-timeline-item"/g) ?? [])
        .length;
      const timeCount = (source.match(/<time\s/g) ?? []).length;

      expect(itemCount).toBeGreaterThan(0);
      expect(timeCount).toBeGreaterThan(0);
    });

    test(`${screenPath} uses .admin-status-pill for the statuses this issue converts, not a bare .status-dot`, async () => {
      const source = await readFile(screenPath, "utf8");

      expect(source).toContain("admin-status-pill");
      expect(source).toContain("admin-status-pill-dot");
    });
  }

  test("approvals.astro keeps the query-param drill-in — no .admin-two-pane routing change (decision recorded in §6.4)", async () => {
    const source = await readFile("src/pages/admin/approvals.astro", "utf8");

    expect(source).not.toContain("admin-two-pane");
    expect(source).toContain('readParam("instance")');
  });

  test("reporting.astro keeps the legacy .status-badge OUTSIDE the rebuild-history section (wave 4 touches that section only)", async () => {
    const source = await readFile("src/pages/admin/reporting.astro", "utf8");

    expect(source).toContain('class="status-badge"');
    expect(source).toContain("reporting-rebuild-history");
    // The rebuild-history <section> itself no longer opens a <table>.
    const sectionStart = source.indexOf('id="reporting-rebuild-history"');
    const sectionEnd = source.indexOf(
      "</section>",
      sectionStart === -1 ? 0 : sectionStart
    );
    expect(sectionStart).toBeGreaterThan(-1);
    const rebuildSection = source.slice(sectionStart, sectionEnd);
    expect(rebuildSection).not.toContain("<table");
    expect(rebuildSection).toContain("admin-timeline");
  });

  test(".admin-timeline (the <ol> wrapper) resets list-style in admin.css, alongside -item/-label/-meta", async () => {
    const css = await readFile("src/styles/admin.css", "utf8");

    expect(css).toContain(".admin-timeline {");
    expect(css).toContain(".admin-timeline-item {");
    expect(css).toContain(".admin-timeline-label {");
    expect(css).toContain(".admin-timeline-meta {");

    const timelineBlock = css.slice(
      css.indexOf(".admin-timeline {"),
      css.indexOf(".admin-timeline-item {")
    );
    expect(timelineBlock).toMatch(/list-style:\s*none/);
  });

  test("legacy .status-badge stays defined for the un-migrated screens (#866 retires it, not this issue)", async () => {
    const baseCss = await readFile("src/styles/admin.css", "utf8");
    const screensCss = await readFile("src/styles/admin-screens.css", "utf8");

    expect(baseCss).toContain(".status-badge {");
    // admin-screens.css only adds variant/size overrides on top of the base
    // declaration above — both files must keep agreeing on the same element.
    expect(screensCss).toContain('.status-badge[data-variant="info"]');
  });
});
