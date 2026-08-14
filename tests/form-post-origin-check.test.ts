/**
 * Native form POSTs are unusable in this deployment, and nothing else says so.
 *
 * Astro's `checkOrigin` (`astro/dist/core/app/origin-check.js`) refuses any
 * request whose content-type is form-like unless
 * `request.headers.get("origin") === url.origin`. This deployment terminates TLS
 * at Traefik while the app listens on plain HTTP, so `url.origin` is `http://…`
 * and the browser's `Origin` is `https://…`. Those strings never match, so every
 * native `<form method="post">` is answered
 * `403 Cross-site POST form submissions are forbidden`.
 *
 * It shipped to production in v9.1.0 because the failure needs a TLS-terminating
 * proxy to appear: dev, `bun run build`, and the Playwright smoke test all speak
 * plain HTTP to the app, where the two origins DO match. No gate could see it,
 * and the feature it broke — the only route to Indonesian — looked fine locally.
 *
 * So the rule is asserted here instead: a form that POSTs must be intercepted by
 * script and re-sent as JSON, which `checkOrigin` exempts because a cross-site
 * `application/json` POST is already stopped by CORS preflight.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const SRC_ROOT = join(REPO_ROOT, "src");

/**
 * Comments are stripped BEFORE matching. This file's own subject matter is
 * `method="post"` and `application/x-www-form-urlencoded`, and the component it
 * guards explains the trap in prose — an assertion that reads comments would be
 * answered by the explanation rather than by the code.
 *
 * Block comments are removed FIRST, and the braces a JSX comment leaves behind
 * are collapsed afterwards. Doing it the other way round — matching `{/* … *\/}`
 * as one unit — is wrong in a way that is easy to ship: `\{\s*\/\*` also matches
 * `interface Props {` followed by its JSDoc, and the pattern then runs on
 * looking for a `*\/` that happens to be followed by `}`. The first one it finds
 * is the JSX comment far below in the template, so everything between them —
 * the entire markup, `<form>` included — disappears. The scanner then reports
 * nothing and reads as a pass. That is the same lazy-quantifier failure CodeQL
 * caught in `i18n-screen-coverage-check.ts`, in a different costume.
 */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\}/g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const POSTING_FORM = /<form\b[^>]*\bmethod\s*=\s*["']post["']/i;

describe("no native form POST survives Astro's origin check", () => {
  const posting: string[] = [];

  for (const file of walk(SRC_ROOT)) {
    const body = stripComments(readFileSync(file, "utf8"));
    if (POSTING_FORM.test(body)) posting.push(relative(REPO_ROOT, file));
  }

  /**
   * Not a style rule — a bound. Every posting form is a place this trap can
   * reappear, and the interception that saves it is checked below by name. A new
   * entry here is a new thing to verify, not a formatting question.
   */
  test("the set of posting forms is still the one known form", () => {
    expect(posting).toEqual(["src/components/LanguageSwitcher.astro"]);
  });

  test("its native submit is cancelled, in the module that carries it", () => {
    const client = stripComments(
      readFileSync(
        join(SRC_ROOT, "lib", "ui", "language-switcher-client.ts"),
        "utf8"
      )
    );

    expect(client).toContain("preventDefault");
  });

  /**
   * The component must own NO `<script>` of its own.
   *
   * A private one-caller module is folded into the script that imports it, which
   * leaves that script with no cross-chunk import — and Astro inlines exactly
   * those, into a page whose CSP is `script-src 'self' 'sha256-…'` with a single
   * hash for the theme-init script. So the switcher's behaviour is loaded from
   * `AdminLayout`'s script, which is external because it also imports the shared
   * `admin-form-client` chunk. Giving this component a `<script>` again would
   * quietly reproduce the inlining.
   */
  test("the component ships no script of its own", () => {
    const component = readFileSync(
      join(SRC_ROOT, "components", "LanguageSwitcher.astro"),
      "utf8"
    );

    // Case-insensitive, and tolerant of attributes: `<SCRIPT>` and
    // `<script type="module">` are both scripts, and a guard that only knows
    // one spelling is a guard the next edit walks straight past. CodeQL
    // `js/bad-tag-filter` flagged the narrower version of this line.
    expect(component).not.toMatch(/^<script[\s/>]/im);
  });

  test("AdminLayout loads the switcher's behaviour", () => {
    const layout = stripComments(
      readFileSync(join(SRC_ROOT, "layouts", "AdminLayout.astro"), "utf8")
    );

    expect(layout).toContain('import "../lib/ui/language-switcher-client"');
    // Its externality depends on this shared chunk staying in the same script.
    expect(layout).toContain('from "../lib/ui/admin-form-client"');
  });
});

describe("the language switcher sends JSON", () => {
  const client = stripComments(
    readFileSync(
      join(SRC_ROOT, "lib", "ui", "language-switcher-client.ts"),
      "utf8"
    )
  );
  const component = stripComments(
    readFileSync(join(SRC_ROOT, "components", "LanguageSwitcher.astro"), "utf8")
  );

  test("it posts application/json, which checkOrigin exempts", () => {
    expect(client).toContain('"Content-Type": "application/json"');
  });

  test("it sends credentials, or the persisting endpoint answers 401", () => {
    expect(client).toContain('credentials: "same-origin"');
  });

  /**
   * The fallback button is `hidden` in the MARKUP. Hiding it from script instead
   * would show a broken control to precisely the readers who cannot use it.
   */
  test("the no-script submit button ships hidden", () => {
    expect(component).toMatch(
      /<button[^>]*class="locale-switcher-submit"[^>]*hidden/
    );
  });
});
