/**
 * A `<tr hidden>` inside a stacked admin table is NOT hidden on a phone.
 *
 * `admin.css` turns every row of a `.data-table--stack` into a card below
 * `--bp-md`:
 *
 *     @media (max-width: 767.98px) {
 *       .data-table--stack tr { display: block; }
 *     }
 *
 * That selector has specificity (0,1,1). The user-agent rule that makes the
 * `hidden` attribute work — `[hidden] { display: none }` — has (0,1,0). The
 * author rule wins, so `hidden` silently stops hiding, and it stops on exactly
 * the layout nobody checks first.
 *
 * The failure is not cosmetic in the way it sounds: a collapsed detail row that
 * cannot collapse renders its content for EVERY row of the table at once, and
 * the control that is supposed to open it does nothing visible. The session
 * panel on `/admin/users` (Gelombang 2 PR 2.2 of #423) shipped with exactly
 * this, and it is the kind of defect a desktop review cannot see.
 *
 * So: any admin screen that both uses the stacked table and hides a row with
 * the `hidden` attribute must carry its own `[hidden] { display: none }` rule
 * for that row. Pure: source text only.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCREEN_ROOT = "src/pages/admin";

function collectScreens(directory: string, into: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      collectScreens(path, into);
      continue;
    }

    if (path.endsWith(".astro")) into.push(path);
  }

  return into;
}

/** `<tr ... hidden>` — the attribute on a row, in either attribute order. */
const HIDDEN_ROW = /<tr\b[^>]*\bhidden\b/;

/**
 * Block comments go before matching, and the first draft of this test proved
 * why: the CSS comment explaining the override quotes `[hidden] { display: none
 * }` verbatim, so the guard matched its own explanation and a mutation that
 * DELETED the rule still passed. Same shape `access-chokepoint-check.ts`
 * records — it is always the fix that plants the false positive, because a fix
 * explains what it removed.
 */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("stacked tables cannot rely on the user agent to hide a row", () => {
  const screens = collectScreens(SCREEN_ROOT).map((file) => ({
    file,
    source: stripBlockComments(readFileSync(file, "utf8"))
  }));

  test("there are admin screens to check at all", () => {
    // A collector that silently found nothing would make every assertion below
    // vacuously true.
    expect(screens.length).toBeGreaterThan(20);
  });

  test("every screen with a stacked table AND a hidden row overrides `[hidden]` itself", () => {
    const offenders = screens
      .filter(
        ({ source }) =>
          source.includes("data-table--stack") && HIDDEN_ROW.test(source)
      )
      .filter(
        ({ source }) => !/\[hidden\][^{]*\{[^}]*display:\s*none/.test(source)
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  test("the rule this test is about really is in admin.css, in a media query", () => {
    // If the base stylesheet ever stops turning rows into blocks, this whole
    // test becomes noise — and it should be deleted rather than left to pass
    // for a reason that no longer exists.
    const base = readFileSync("src/styles/admin.css", "utf8");

    expect(base).toContain(".data-table--stack tr");
    expect(base).toContain("@media (max-width: 767.98px)");
  });
});
