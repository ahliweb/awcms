/**
 * Source contract for single flight (Issue #1224).
 *
 * The helpers in `src/lib/ui/admin-form-client.ts` own the in-flight guard, but
 * only for what is bound THROUGH them. A page script that attaches its own
 * `submit` listener, or its own mutating `click` handler, is outside the guard
 * and ships exactly the bug #1224 closed. This test fails when that happens
 * unless the binding is in the explicit allow-list
 * (`ALLOWED_DIRECT_BINDINGS` in `scripts/lib/single-flight-audit.ts`), which
 * carries the reason.
 *
 * It also holds the audit table honest: the table in
 * `docs/awcms/ui-single-flight-audit.md` (+ `.id.md`) is generated from the same
 * scan, so a form that is added or rebound without regenerating it fails here.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ALLOWED_DIRECT_BINDINGS,
  checkDocs
} from "../scripts/lib/single-flight-audit";
import {
  HELPER_NAMES,
  scanEntryPoints,
  type EntryPoint
} from "../scripts/lib/single-flight-scan";

const scan = scanEntryPoints();
const isHelper = (entry: EntryPoint) =>
  (HELPER_NAMES as readonly string[]).includes(entry.kind);

describe("source contract: nothing binds outside the shared helpers", () => {
  test("the scan sees the tree (a scan that finds nothing proves nothing)", () => {
    expect(scan.filesScanned.length).toBeGreaterThan(100);
    expect(scan.entries.filter(isHelper).length).toBeGreaterThan(150);
  });

  test("no page script attaches its own `submit` listener", () => {
    const direct = scan.entries
      .filter((entry) => entry.kind === "direct-submit")
      .map((entry) => `${entry.file}:${entry.line}`);

    expect(direct).toEqual([]);
  });

  test("a direct click/keydown/change that reaches a mutating request is on the allow-list", () => {
    const direct = scan.entries.filter((entry) => !isHelper(entry));
    const byFile = new Map<string, number>();

    for (const entry of direct) {
      byFile.set(entry.file, (byFile.get(entry.file) ?? 0) + 1);
    }

    const unlisted = [...byFile.keys()].filter(
      (file) => !ALLOWED_DIRECT_BINDINGS.some((item) => item.file === file)
    );

    expect(unlisted).toEqual([]);
  });

  test("the allow-list is exact: every entry still matches, at its stated count", () => {
    const actual = ALLOWED_DIRECT_BINDINGS.map((item) => ({
      file: item.file,
      count: scan.entries.filter(
        (entry) => !isHelper(entry) && entry.file === item.file
      ).length
    }));

    expect(actual).toEqual(
      ALLOWED_DIRECT_BINDINGS.map((item) => ({
        file: item.file,
        count: item.count
      }))
    );
    for (const item of ALLOWED_DIRECT_BINDINGS) {
      expect(item.reason.length).toBeGreaterThan(20);
    }
  });

  test("the five public auth forms go through onSubmit", () => {
    const bound = new Set(
      scan.entries
        .filter((entry) => entry.kind === "onSubmit")
        .map((entry) => `${entry.file}|${entry.target}`)
    );

    for (const key of [
      "src/pages/login.astro|login-form",
      "src/pages/register.astro|register-form",
      "src/pages/forgot-password.astro|forgot-form",
      "src/pages/reset-password.astro|reset-form",
      "src/pages/accept-invitation.astro|invitation-form"
    ]) {
      expect(bound.has(key)).toBe(true);
    }
  });

  test("the language switcher goes through the helper", () => {
    expect(
      scan.entries.some(
        (entry) =>
          entry.file === "src/lib/ui/language-switcher-client.ts" &&
          entry.kind === "onSubmitAll"
      )
    ).toBe(true);
  });
});

describe("source contract: the audit docs are current", () => {
  test("both language tables match a fresh scan", () => {
    expect(checkDocs()).toEqual([]);
  });
});

describe("the scanner itself", () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "single-flight-"));
    roots.push(root);

    for (const [name, text] of Object.entries(files)) {
      const target = path.join(root, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
    }

    return root;
  }

  const kinds = (root: string) =>
    scanEntryPoints({ root, roots: ["src/pages"] }).entries.map(
      (entry) => `${entry.kind}:${entry.target}`
    );

  test("flags a hand-bound submit listener and a mutating click, ignores a UI-only click", () => {
    const root = fixture({
      "src/pages/a.astro": `---\nconst x = 1;\n---\n<form id="f"></form>\n<script>
        import { sendJson } from "../lib/ui/admin-form-client";
        document.getElementById("f")?.addEventListener("submit", async (e) => {
          e.preventDefault();
          await sendJson("POST", "/api/v1/x", {});
        });
        document.getElementById("b")?.addEventListener("click", () => {
          void sendJson("DELETE", "/api/v1/x");
        });
        document.getElementById("t")?.addEventListener("click", () => {
          panel.hidden = !panel.hidden;
        });
      </script>`
    });

    expect(kinds(root)).toEqual(["direct-submit:submit", "direct-event:click"]);
  });

  test("a bare GET fetch is not a mutation; a POST fetch is", () => {
    const root = fixture({
      "src/pages/a.astro": `<script>
        document.addEventListener("click", async () => {
          await fetch("/api/v1/list");
        });
        document.addEventListener("change", async () => {
          await fetch("/api/v1/x", { method: "POST" });
        });
      </script>`
    });

    // `document.addEventListener` is matched like any other receiver.
    expect(kinds(root)).toEqual(["direct-event:change"]);
  });

  test("a comment that mentions a binding is not a binding", () => {
    const root = fixture({
      "src/pages/a.astro": `<script>
        // onSubmit("f", async () => { await sendJson("POST", "/x") });
        /* form.addEventListener("submit", () => sendJson("POST", "/x")) */
        const note = 'addEventListener("submit"';
      </script>`
    });

    expect(kinds(root)).toEqual([]);
  });

  test("a `<script>` mentioned in the frontmatter, and a self-closing one, do not swallow the real script", () => {
    const root = fixture({
      "src/pages/a.astro": `---\n// renders a <script src> tag below\n---\n<script is:inline src="https://example.com/x.js" async defer />\n<p>don't</p>\n<script>
        import { onSubmit, sendJson } from "../lib/ui/admin-form-client";
        onSubmit("f", async () => { await sendJson("POST", "/api/v1/x", {}); });
      </script>`
    });

    expect(kinds(root)).toEqual(["onSubmit:f"]);
  });

  test("`mutateAndReload(null, …)` is not a lock", () => {
    const root = fixture({
      "src/pages/a.astro": `<script>
        import { mutateAndReload, onSubmit, sendJson } from "../lib/ui/admin-form-client";
        onSubmit("a", async ({ submit }) => {
          await mutateAndReload(submit, box, () => sendJson("POST", "/x"), "f");
        });
        onSubmit("b", async () => {
          await mutateAndReload(null, box, () => sendJson("POST", "/x"), "f");
        });
      </script>`
    });

    const entries = scanEntryPoints({ root, roots: ["src/pages"] }).entries;

    expect(entries.map((entry) => entry.guard)).toEqual(["lock", "none-seen"]);
  });
});
