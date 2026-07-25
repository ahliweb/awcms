/**
 * The theme-init script is the ONE inline script in this repo, and CSP admits
 * it by SHA-256 rather than by `'unsafe-inline'` (see
 * `src/lib/security/theme-init-script.ts` and `security-headers.ts`). That
 * makes the body and its hash a pair that MUST move together.
 *
 * Why this test earns its place: if they drift, nothing throws, no request
 * fails, and no log line appears. The browser simply refuses to execute the
 * script, the admin shell paints in the wrong theme for a frame, and the only
 * evidence is a console CSP violation on someone else's machine. `curl` cannot
 * see it — it never executes JS. So the drift is caught here, at the only
 * point where both values are visible at once.
 */
import { describe, expect, test } from "bun:test";

import {
  THEME_INIT_SCRIPT_BODY,
  THEME_INIT_SCRIPT_HASH,
  THEME_STORAGE_KEY
} from "../src/lib/security/theme-init-script";
import { buildSecurityHeaders } from "../src/lib/security/security-headers";

function sha256Base64(input: string): string {
  return new Bun.CryptoHasher("sha256").update(input).digest("base64");
}

describe("theme-init script — CSP hash integrity", () => {
  test("THEME_INIT_SCRIPT_HASH is the real SHA-256 of THEME_INIT_SCRIPT_BODY", () => {
    expect(THEME_INIT_SCRIPT_HASH).toBe(
      `sha256-${sha256Base64(THEME_INIT_SCRIPT_BODY)}`
    );
  });

  test("the hash is in CSP's `sha256-<base64>` shape, not a bare digest", () => {
    expect(THEME_INIT_SCRIPT_HASH).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
  });

  test("the emitted script-src actually carries that hash, quoted as CSP requires", () => {
    const csp = buildSecurityHeaders({ isProduction: true }).find(
      ([name]) => name === "Content-Security-Policy"
    )?.[1];

    expect(csp).toContain(`'${THEME_INIT_SCRIPT_HASH}'`);
  });

  test("a mutated body no longer matches the registered hash — proves this test can fail", () => {
    const mutated = THEME_INIT_SCRIPT_BODY.replace('"dark"', '"dark-mutated"');

    expect(mutated).not.toBe(THEME_INIT_SCRIPT_BODY);
    expect(`sha256-${sha256Base64(mutated)}`).not.toBe(THEME_INIT_SCRIPT_HASH);
  });
});

describe("theme-init script — body invariants the single static hash depends on", () => {
  test("reads its default from the HTML attribute, never from an interpolated server value", () => {
    // `define:vars`-style interpolation would make the rendered bytes vary per
    // request, so one static hash could only ever match one variant. The
    // attribute read is what keeps the bytes constant for every tenant.
    expect(THEME_INIT_SCRIPT_BODY).toContain("data-tenant-default-theme");
    expect(THEME_INIT_SCRIPT_BODY).not.toContain("${");
  });

  test("uses this repo's storage key, not awcms-micro's", () => {
    expect(THEME_STORAGE_KEY).toBe("awcms_theme");
    expect(THEME_INIT_SCRIPT_BODY).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(THEME_INIT_SCRIPT_BODY).not.toContain("awcms_micro_theme");
  });

  test("sets data-theme to a resolved concrete theme, never the literal 'system'", () => {
    // The attribute drives `:root[data-theme="dark"]` in tokens.css, which only
    // knows concrete themes — writing "system" there would silently theme
    // nothing.
    expect(THEME_INIT_SCRIPT_BODY).toContain(
      'document.documentElement.setAttribute("data-theme", resolved)'
    );
    expect(THEME_INIT_SCRIPT_BODY).toContain("prefers-color-scheme: dark");
  });
});
