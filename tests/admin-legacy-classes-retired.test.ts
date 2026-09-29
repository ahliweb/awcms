/**
 * Repo-wide regression gate for Issue #866 (parent epic #858, wave 7 of
 * `docs/awcms/admin-ui-parity-matrix.md` §7): the legacy `.stat-card`/
 * `.stat-grid`/`.stat-label`/`.stat-value`/`.stat-hint`/`.stat-head`/
 * `.stat-delta` family and the legacy `.status-badge`/`.status-dot` pair are
 * RETIRED — every consumer waves 2-7 found now renders `.admin-stat-card`/
 * `.admin-status-pill` instead, and the legacy rule blocks were deleted from
 * `src/styles/admin.css`/`src/styles/admin-screens.css` (and the `.stat-card`
 * half of the dual selector lists in `src/styles/omes-control-center.css`).
 *
 * Waves 2/3/4/6 (`admin-stat-card-wave2.test.ts`, `admin-status-pill-wave3
 * .test.ts`, `admin-timeline-wave4.test.ts`) each pin the individual screens
 * and CSS blocks they touched. This test is the BACKSTOP: it walks every
 * `.astro`/`.ts`/`.tsx`/`.css` file under `src/` and fails the build the
 * moment any of these class tokens reappears as an actual consumer (a class
 * attribute, a `classList`/`querySelector` string literal, or a CSS
 * selector) — not merely as prose in a comment, which is where the
 * project-history references to these retired names legitimately live (e.g.
 * "ported from the legacy `.stat-grid`" provenance notes in admin.css, or
 * the README narrating what Issue #866 changed).
 *
 * Comments are stripped before matching for exactly that reason: a `/* ...
 * *\/` block, a `// ...` line, a JSX `{/* ... *\/}`, or an HTML `<!-- ... -->`
 * span is never treated as a live consumer.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/lib/source-text";

const LEGACY_TOKENS = [
  "stat-card",
  "stat-grid",
  "stat-label",
  "stat-value",
  "stat-hint",
  "stat-head",
  "stat-delta",
  "status-badge",
  "status-dot"
] as const;

const SCAN_EXTENSIONS = [".astro", ".ts", ".tsx", ".css"];
const SCAN_ROOT = "src";

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

function legacyTokenPattern(token: string): RegExp {
  // Whole hyphen-delimited token — excludes `admin-stat-card`/
  // `admin-status-pill` (preceding `-`) and `omes-stat-breakdown-*`/
  // `admin-stat-card-value--mono` (following `-`).
  return new RegExp(`(?<![\\w-])${token}(?![\\w-])`);
}

describe("admin-legacy-classes-retired (#866, wave 7): repo-wide backstop", () => {
  test("no .astro/.ts/.tsx/.css file under src/ references a retired stat-card/status-badge class token outside a comment", async () => {
    const files = await collectFiles(SCAN_ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const raw = await readFile(file, "utf8");
      const stripped = stripComments(raw);

      for (const token of LEGACY_TOKENS) {
        if (legacyTokenPattern(token).test(stripped)) {
          offenders.push(`${file}: .${token}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the legacy rule blocks are gone from admin.css and admin-screens.css", async () => {
    const adminCss = await readFile("src/styles/admin.css", "utf8");
    const adminScreensCss = await readFile(
      "src/styles/admin-screens.css",
      "utf8"
    );

    for (const selector of [
      ".stat-card {",
      ".stat-grid {",
      ".status-badge {",
      ".status-badge .status-dot {"
    ]) {
      expect(adminCss).not.toContain(selector);
      expect(adminScreensCss).not.toContain(selector);
    }
  });

  test("omes-control-center.css no longer carries the .stat-card half of its dual selector lists", async () => {
    const css = await readFile("src/styles/omes-control-center.css", "utf8");
    const stripped = stripComments(css);

    expect(stripped).not.toMatch(/\.stat-card\b/);
    expect(stripped).not.toMatch(/\.status-badge\b/);
    // The replacement primitive must still be present — this is a retire of
    // the dual selector list, not a silent deletion of the KPI styling
    // itself. `.admin-status-pill` itself is defined in admin.css, not
    // here — this file only ever reused it, never redeclared it.
    expect(stripped).toContain(".admin-stat-card");
  });
});
