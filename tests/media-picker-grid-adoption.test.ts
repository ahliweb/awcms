/**
 * Source-contract test for Issue #872 (parent epic #858, follow-up to
 * wave 5 / Issue #864): the shared media picker
 * (`src/lib/ui/media-picker-client.ts`) and its consumer screens adopt the
 * `.admin-media-grid`/`.admin-media-grid-tile` primitive
 * (`src/styles/admin.css`) for the thumbnail grid — the one real consumer
 * doc 14's `MediaGrid` row pointed at once `/admin/media` itself decided
 * NOT to grow thumbnails (Issue #864's own security decision).
 *
 * Pure source-text assertions — no database, no rendering, no DOM. What this
 * pins:
 *
 *   1. `blog.astro` (x2 pickers), `blog-ads.astro` and `site-profile.astro`
 *      (x2 pickers) each render `.media-picker-panel` WITH `admin-media-grid`
 *      in the same class attribute — the shared grid primitive, not a
 *      bespoke one.
 *   2. `blog-homepage.astro` — named in the issue as a fourth consumer to
 *      verify by grep — has no `.media-choice`/`.media-picker-panel` markup
 *      at all (confirmed by grep before this change): it mentions
 *      `wireMediaPickers` only in a doc comment explaining why this screen
 *      does NOT use it (ordered id-list fields instead). Nothing to migrate
 *      there, and this pins that finding so a future edit does not silently
 *      assume otherwise.
 *   3. `wireMediaPickers` builds each thumbnail as a real
 *      `.admin-media-grid-tile`, exposes the selected state via
 *      `aria-pressed` (never colour/outline alone — WCAG 1.4.1), and gives
 *      the button its accessible name from a visible caption text node
 *      rather than alt text (alt stays `""`, decorative, since the caption
 *      already names the choice).
 *   4. `.admin-media-grid`/`.admin-media-grid-tile` themselves are still
 *      defined in `src/styles/admin.css` (the primitive this issue consumes,
 *      not something this issue redefines).
 *   5. The picker's own bespoke grid CSS (`display: grid` /
 *      `grid-template-columns` on `.media-picker-panel`, and the box/colour
 *      styling `.media-option` used to duplicate) is gone from
 *      `src/styles/admin-screens.css` now that nothing uses it — only the
 *      panel's bordered/scrollable chrome and the caption overlay remain
 *      there, layered on top of the shared primitive.
 *   6. The picker's public contract is unchanged: `fetchPickableMedia`,
 *      `describePickableMedia` and `PICKER_LIST_URL` are still exported
 *      (pinned more thoroughly by `tests/media-picker-client.test.ts`).
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

const PICKER_SCREENS = [
  "src/pages/admin/blog.astro",
  "src/pages/admin/blog-ads.astro",
  "src/pages/admin/site-profile.astro"
] as const;

describe("media-picker-grid-adoption (#872): shared picker adopts .admin-media-grid", () => {
  for (const screenPath of PICKER_SCREENS) {
    test(`${screenPath}: every .media-picker-panel also carries admin-media-grid`, async () => {
      const source = await readFile(screenPath, "utf8");

      const panelCount = (
        source.match(/class="media-picker-panel admin-media-grid"/g) ?? []
      ).length;
      const bareCount = (source.match(/class="media-picker-panel"/g) ?? [])
        .length;

      expect(panelCount).toBeGreaterThan(0);
      expect(bareCount).toBe(0);
    });
  }

  test("blog-homepage.astro has no media-picker markup to migrate (verified by grep, not assumed)", async () => {
    const source = await readFile(
      "src/pages/admin/blog-homepage.astro",
      "utf8"
    );

    expect(source).not.toContain("media-choice");
    expect(source).not.toContain("media-picker-panel");
    // It still documents why it deliberately does not use the picker.
    expect(source).toContain("wireMediaPickers");
  });

  test("wireMediaPickers renders .admin-media-grid-tile options with aria-pressed, not colour alone", async () => {
    const source = await readFile("src/lib/ui/media-picker-client.ts", "utf8");

    expect(source).toContain('"media-option admin-media-grid-tile"');
    expect(source).toContain("aria-pressed");
    expect(source).toContain("dataset.selected");
    // Accessible name is the visible caption, alt stays decorative.
    expect(source).toContain("media-option-caption");
    expect(source).toContain('thumb.alt = "";');
  });

  test("the public contract is unchanged — same three exports the callers/tests rely on", async () => {
    const source = await readFile("src/lib/ui/media-picker-client.ts", "utf8");

    expect(source).toContain("export async function fetchPickableMedia(");
    expect(source).toContain("export function describePickableMedia(");
    expect(source).toContain("export const PICKER_LIST_URL =");
    expect(source).toContain("export function wireMediaPickers(");
  });

  test(".admin-media-grid / .admin-media-grid-tile are defined in admin.css (the primitive this issue consumes)", async () => {
    const css = await readFile("src/styles/admin.css", "utf8");

    expect(css).toContain(".admin-media-grid {");
    expect(css).toContain(".admin-media-grid-tile {");
    expect(css).toContain('.admin-media-grid-tile[data-selected="true"]');
  });

  test("admin-screens.css no longer duplicates the grid layout on .media-picker-panel/.media-option", async () => {
    const css = await readFile("src/styles/admin-screens.css", "utf8");

    const panelBlock = css.slice(
      css.indexOf(".media-picker-panel {"),
      css.indexOf(".media-picker-panel {") +
        css.slice(css.indexOf(".media-picker-panel {")).indexOf("\n}\n")
    );
    expect(panelBlock).not.toContain("display: grid");
    expect(panelBlock).not.toContain("grid-template-columns");

    const optionBlock = css.slice(
      css.indexOf(".media-option {"),
      css.indexOf(".media-option {") +
        css.slice(css.indexOf(".media-option {")).indexOf("\n}\n")
    );
    expect(optionBlock).not.toContain("aspect-ratio");
    expect(optionBlock).not.toContain("border-radius");

    // The caption overlay is the one new declaration this issue adds here.
    expect(css).toContain(".media-option-caption {");
  });
});
