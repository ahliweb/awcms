/**
 * No `window.confirm(`/`window.prompt(` in admin client code (Issue #854
 * part 1). Both are unstyled OS chrome — never theme-aware, so dark mode is
 * broken for them specifically — block the main thread, and their wording and
 * button order vary by browser. `ConfirmDialog`/`ReasonPanel`
 * (`src/components/`, `src/lib/ui/confirm-dialog-client.ts` +
 * `reason-panel-client.ts`) replace them; see ADR-0125.
 *
 * `window.confirm(` was swept everywhere it appeared under `src/pages/admin/`
 * and `src/lib/ui/` — no allow-list needed for that one.
 *
 * `window.prompt(` was converted only where an opener maps to exactly one
 * endpoint call with exactly one free-text, genuinely-required field and a
 * plain reload (or an existing form's own submit) on success — the shape
 * `ReasonPanel` commits to. ADR-0125 §"What was converted, and what was not"
 * catalogues every site left as `window.prompt()` and why (an optional
 * field, a value/identifier/decision prompt rather than a reason, a second
 * fixed body field alongside the reason, a non-reload success path, or a
 * multi-action dispatcher over a dynamic per-row id) — the allow-list below
 * is that same list, so a NEW `window.prompt()` site is caught here rather
 * than silently joining an undocumented exception.
 *
 * Pure: source text only, so this needs no DOM and no server.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The ONE `stripComments` (finding D2, 17 August 2026 audit round) — see
// `tests/source-text-stripping.test.ts` for why a per-file copy is a
// regression: a naive block-comment regex eats code whenever `/*` appears
// inside a string literal (a route glob is enough).
import { stripComments } from "../scripts/lib/source-text";

const ROOTS = ["src/pages/admin", "src/lib/ui"];

function collectSourceFiles(directory: string, into: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      collectSourceFiles(path, into);
      continue;
    }

    if (path.endsWith(".astro") || path.endsWith(".ts")) into.push(path);
  }

  return into;
}

const CONFIRM_CALL = /\bwindow\.confirm\s*\(/;
const PROMPT_CALL = /\bwindow\.prompt\s*\(/;

/**
 * Every `window.prompt()` site ADR-0125 records as evaluated-and-left, keyed
 * by file so a prompt call added to a NEW file (or a new one added to an
 * already-listed file) still fails this test. Extend this list only alongside
 * an ADR-0125-style justification — it is a record, not a rubber stamp.
 */
const PROMPT_ALLOWLIST = new Set([
  "src/pages/admin/roles.astro",
  "src/pages/admin/user-groups.astro",
  "src/pages/admin/sync.astro",
  "src/pages/admin/business-scope.astro",
  "src/pages/admin/comments.astro",
  "src/pages/admin/approvals.astro",
  "src/pages/admin/seo.astro",
  "src/pages/admin/abac-policies.astro",
  "src/pages/admin/subject-requests.astro",
  "src/pages/admin/blog.astro",
  "src/lib/ui/admin-account-client.ts"
]);

describe("no raw window.confirm()/window.prompt() in admin client code", () => {
  const files = ROOTS.flatMap((root) => collectSourceFiles(root));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    test(`${file}: window.confirm() is never called directly`, () => {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(CONFIRM_CALL.test(source)).toBe(false);
    });
  }

  for (const file of files) {
    test(`${file}: window.prompt() only appears on the ADR-0125 allow-list`, () => {
      const source = stripComments(readFileSync(file, "utf8"));
      const usesPrompt = PROMPT_CALL.test(source);

      if (!usesPrompt) {
        expect(usesPrompt).toBe(false);
        return;
      }

      expect(PROMPT_ALLOWLIST.has(file)).toBe(true);
    });
  }

  test("every allow-listed file still exists and still uses window.prompt()", () => {
    // Catches the allow-list going stale the OTHER direction: an entry left
    // behind after its last `window.prompt()` was converted or the file was
    // removed, which would silently stop testing anything.
    for (const file of PROMPT_ALLOWLIST) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(PROMPT_CALL.test(source)).toBe(true);
    }
  });
});
