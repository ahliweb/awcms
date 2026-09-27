/**
 * ahliweb/awcms#831 — a long, unbreakable string in the admin main column
 * must never widen the page or squeeze `.admin-sidebar`.
 *
 * ## The bug
 *
 * `/admin/omes/orkestrasi-langsung` renders Hermes-supplied free text
 * (`goal`/`summary`) in `.cell-muted` spans OUTSIDE a `<table>` — the
 * Hermes orchestration tree/activity list is a `display:flex; flex-wrap:
 * wrap` list (`.omes-orchestration-tree-node`,
 * `.omes-orchestration-activity-list li` in `omes-control-center.css`), not
 * a table. Every OTHER screen that uses `.cell-muted` puts it inside a
 * `<table>` wrapped by `.data-table-scroll` (`overflow-x: auto`), which
 * contains a long value by scrolling the table sideways. `.cell-muted` had
 * no such protection of its own — only `.data-table td .cell-muted`
 * (admin-screens.css) got table-scoped styling, and `.cell-code` (the
 * sibling class for ids) already had a bare, universal `word-break:
 * break-all` in admin.css. A single long, space-free `.cell-muted` value
 * (e.g. a Hermes `goal`/`summary` with no natural break point) had nothing
 * stopping it from overflowing `.admin-main` and widening
 * `document.documentElement` past the viewport.
 *
 * `.admin-sidebar` (`flex-shrink: 0`) and `.admin-main` (`min-width: 0`)
 * correctly keep their OWN flex-track widths fixed even while this happens
 * — verified directly below — but the PAGE becomes wider than the
 * viewport, which is a real, user-visible defect independent of any
 * screenshot tooling: a document wider than its viewport can be dragged
 * sideways, and a full-page screenshot captures that wider (not 1440px)
 * canvas, making the fixed-width sidebar and its labels occupy a
 * shrunken sliver of the image — which is what actually produced the
 * "sidebar rendered ~143px wide, labels clipped" appearance reported on
 * ahliweb/awcms#831, even though `.admin-sidebar`'s own box never moved.
 *
 * The fix: a bare, universal `.cell-muted { overflow-wrap: anywhere; }` in
 * admin.css (mirroring `.cell-code`'s `break-all`, but `anywhere` rather
 * than `break-all` since this class holds prose, not identifiers) — so it
 * protects `.cell-muted` wherever it is used, table or not.
 *
 * ## Why this test doesn't seed real Hermes orchestration data
 *
 * Reproducing the exact page needs a signed Ed25519 worker envelope
 * (`verifyWorkerEnvelope`, see `worker/hermes-orchestration-tree.ts`) to
 * ingest a tree — heavy machinery for what is, underneath, a GENERIC
 * `.cell-muted` CSS contract, not something specific to Hermes payload
 * shape. This test instead injects a synthetic `.cell-muted` element
 * carrying a long unbreakable token directly into `.admin-page-body` on an
 * ordinary already-rendered admin screen, the same way any future screen
 * reusing `.cell-muted` outside a table would. That is a faithful
 * reproduction of the actual CSS defect (a `.cell-muted` span with no
 * natural break point, outside `.data-table-scroll`) without coupling this
 * regression test to the orchestration domain's ingestion contract.
 *
 * ## The assertion
 *
 * DOM measurements, not a screenshot diff (see `responsive-360.e2e.ts` for
 * the same reasoning): `document.documentElement.scrollWidth` must not
 * exceed the viewport, and `.admin-sidebar`'s `getBoundingClientRect().width`
 * must be unchanged before/after the long content is injected. Both are
 * objectively true or false, and — critically for this specific bug — a
 * screenshot-based assertion would inherit the very capture-tool ambiguity
 * (see the doc comment above) this test exists to route around.
 */
import { test, expect } from "./support/e2e-read-wave";

const VIEWPORT_WIDTHS = [1440, 1280, 1024] as const;
const OVERFLOW_TOLERANCE_PX = 1;

// No natural break point at all: no space, hyphen, or punctuation — the
// worst case for `overflow-wrap`, and exactly the shape a pasted token,
// long URL, or long identifier folded into free text takes in practice.
const UNBREAKABLE_TOKEN = "x".repeat(400);

test.describe("admin sidebar keeps its width when main content is unbreakable", () => {
  for (const width of VIEWPORT_WIDTHS) {
    test(`at ${width}px, a long unbreakable .cell-muted value does not widen the page or shrink .admin-sidebar`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin");

      const before = await page.evaluate(() => {
        const sidebar = document.querySelector(".admin-sidebar");
        return {
          sidebarWidth: sidebar?.getBoundingClientRect().width ?? null,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth
        };
      });

      expect(
        before.sidebarWidth,
        ".admin-sidebar was not found on /admin"
      ).not.toBeNull();

      // NOT asserted here: that `/admin` has zero horizontal overflow before
      // injection. At 1024px specifically it USED TO not — a pre-existing,
      // unrelated topbar `.admin-account-link` overflow, nothing to do with
      // `.cell-muted` or `.admin-sidebar`, fixed by ahliweb/awcms#843 (see
      // `responsive-360.e2e.ts`, which now sweeps 1024px too, and the
      // `.admin-user-menu`/`.admin-palette-open` rules in admin.css). Left as
      // a delta assertion (the repro element's effect, not the page's
      // absolute cleanliness) rather than switched to an absolute one: this
      // file's job is `.cell-muted` containment, and coupling it to the
      // topbar's OWN cleanliness would make it fail on a future, unrelated
      // topbar regression that `responsive-360.e2e.ts` already owns.

      // Reproduce the defect shape from ahliweb/awcms#831: a `.cell-muted`
      // span holding a long, space-free value, placed directly in
      // `.admin-page-body` — OUTSIDE any `.data-table-scroll` wrapper,
      // exactly like `.omes-orchestration-tree-node`'s free-text cells.
      const after = await page.evaluate((token) => {
        const body = document.querySelector(".admin-page-body");
        if (!body) return null;
        const span = document.createElement("span");
        span.className = "cell-muted";
        span.id = "e2e-831-repro-cell-muted";
        span.textContent = token;
        body.prepend(span);

        const sidebar = document.querySelector(".admin-sidebar");
        return {
          sidebarWidth: sidebar?.getBoundingClientRect().width ?? null,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth
        };
      }, UNBREAKABLE_TOKEN);

      expect(after, ".admin-page-body was not found on /admin").not.toBeNull();

      expect(
        after!.scrollWidth,
        `a long unbreakable .cell-muted value widened the page at ${width}px — ` +
          `document.documentElement.scrollWidth went from ${before.scrollWidth}px to ` +
          `${after!.scrollWidth}px after injecting it. The .cell-muted CSS contract ` +
          "(admin.css) is not containing it."
      ).toBeLessThanOrEqual(before.scrollWidth + OVERFLOW_TOLERANCE_PX);

      expect(
        after!.sidebarWidth,
        `.admin-sidebar's width changed from ${before.sidebarWidth}px to ${after!.sidebarWidth}px ` +
          "when long main-column content was added — the sidebar's flex track must stay fixed " +
          "(ahliweb/awcms#831)."
      ).toBe(before.sidebarWidth);
    });
  }
});
