/**
 * Every scrollable table wrapper is a keyboard-reachable, named region (#907).
 *
 * `.data-table-scroll` is `overflow-x: auto`. A scroll container that cannot
 * take focus cannot be scrolled with the keyboard, so a wide table on a narrow
 * viewport hides its right-hand columns from keyboard users (WCAG 2.1.1; axe
 * `scrollable-region-focusable`). The e2e read wave runs on an EMPTY tenant, where
 * the table never overflows, so the violation never showed up in CI — this
 * source-level gate is the one that catches it.
 *
 * The contract for each element carrying the class: `tabindex="0"`,
 * `role="region"` and an accessible name (`aria-label` or `aria-labelledby`).
 * A labelledby target must exist in the same file.
 */
import { readFile } from "node:fs/promises";

import { Glob } from "bun";
import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/lib/source-text";

/** Drop HTML comments, then JS comments through the shared scanner, so a commented-out wrapper cannot satisfy or fail the check. */
function stripAllComments(source: string): string {
  // Scan with indexOf rather than a replace: an unterminated opener swallows the
  // rest of the file, which is what a browser does too.
  let text = "";
  let cursor = 0;

  for (;;) {
    const open = source.indexOf("<!--", cursor);

    if (open === -1) {
      text += source.slice(cursor);
      break;
    }

    text += source.slice(cursor, open);

    const close = source.indexOf("-->", open + 4);

    if (close === -1) break;
    cursor = close + 3;
  }

  return stripComments(text);
}

/** Opening tags whose class list contains the `data-table-scroll` token. */
function scrollWrapperTags(source: string): string[] {
  const tags: string[] = [];

  for (const match of stripAllComments(source).matchAll(
    /<[a-z][a-z0-9]*\b(?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^}]*\})*>/g
  )) {
    const classAttr = /\bclass="([^"]*)"/.exec(match[0]);

    if (classAttr?.[1]?.split(/\s+/).includes("data-table-scroll")) {
      tags.push(match[0]);
    }
  }

  return tags;
}

function scrollWrapperProblems(tag: string, source: string): string[] {
  const problems: string[] = [];

  if (!/\btabindex="0"/.test(tag)) problems.push('missing tabindex="0"');
  if (!/\brole="region"/.test(tag)) problems.push('missing role="region"');

  const labelledBy = /\baria-labelledby="([^"]+)"/.exec(tag);

  if (labelledBy) {
    if (!stripAllComments(source).includes(`id="${labelledBy[1]}"`)) {
      problems.push(`aria-labelledby="${labelledBy[1]}" has no target id`);
    }
  } else if (!/\baria-label=(?:"[^"]+"|\{[^}]+\})/.test(tag)) {
    problems.push("missing aria-label / aria-labelledby");
  }

  return problems;
}

describe("admin scroll regions are focusable, named regions (#907)", () => {
  test("the detector flags the pre-fix markup", () => {
    const old = `<div class="data-table-scroll fade-in-up"><table></table></div>`;
    const [tag] = scrollWrapperTags(old);

    expect(tag).toBeDefined();
    expect(scrollWrapperProblems(tag as string, old)).toEqual([
      'missing tabindex="0"',
      'missing role="region"',
      "missing aria-label / aria-labelledby"
    ]);
  });

  test("the detector accepts both naming forms and ignores comments", () => {
    const ok = `<!-- <div class="data-table-scroll"> -->
      <h2 id="h">x</h2>
      <div class="data-table-scroll" role="region" tabindex="0" aria-labelledby="h"></div>
      <div
        class="data-table-scroll fade-in-up"
        role="region"
        tabindex="0"
        aria-label={t("Rows")}
      ></div>`;
    const tags = scrollWrapperTags(ok);

    expect(tags).toHaveLength(2);
    for (const tag of tags) expect(scrollWrapperProblems(tag, ok)).toEqual([]);
  });

  test("every .data-table-scroll in src/ satisfies the contract", async () => {
    const offenders: string[] = [];
    let seen = 0;

    for await (const path of new Glob("src/**/*.{astro,ts,tsx}").scan(".")) {
      const source = await readFile(path, "utf8");

      for (const tag of scrollWrapperTags(source)) {
        seen += 1;
        for (const problem of scrollWrapperProblems(tag, source)) {
          offenders.push(`${path}: ${problem}`);
        }
      }
    }

    expect(seen).toBeGreaterThan(90);
    expect(offenders).toEqual([]);
  });
});
