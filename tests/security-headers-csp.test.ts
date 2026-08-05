/**
 * Issue #148 — Content-Security-Policy. `buildSecurityHeaders` is a pure
 * function of its options (`src/middleware.ts` is what applies the result to
 * every response), so these are ordinary unit tests: no database, no build,
 * no browser.
 *
 * A browser-level check of the kind awcms-mini needed (headless Chrome, to
 * catch inline scripts Astro's own hashing missed) has no subject here —
 * this base ships no `.astro` component, no inline script/style, and no
 * external origin, so there is no rendered page whose behavior a policy of
 * `'self'` could change. See `src/lib/security/security-headers.ts`'s
 * header for the full argument and for what must be re-verified if this
 * base ever gains real pages.
 */
import { describe, expect, test } from "bun:test";

import { buildSecurityHeaders } from "../src/lib/security/security-headers";
import { THEME_INIT_SCRIPT_HASH } from "../src/lib/security/theme-init-script";

function cspFor(isProduction: boolean, turnstileEnabled = false): string {
  const header = buildSecurityHeaders({ isProduction, turnstileEnabled }).find(
    ([name]) => name === "Content-Security-Policy"
  );

  if (!header) {
    throw new Error("Content-Security-Policy header was not emitted at all.");
  }

  return header[1];
}

function directives(isProduction = false, turnstileEnabled = false): string[] {
  return cspFor(isProduction, turnstileEnabled)
    .split(";")
    .map((directive) => directive.trim());
}

describe("buildSecurityHeaders — Content-Security-Policy (Issue #148)", () => {
  test("emits a Content-Security-Policy header", () => {
    expect(
      buildSecurityHeaders({ isProduction: false }).map(([name]) => name)
    ).toContain("Content-Security-Policy");
  });

  test("carries every directive ported from awcms-mini's own policy, plus the always-on script-src", () => {
    expect(directives()).toEqual([
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}'`
    ]);
  });

  test("is identical in production and non-production — CSP is not a TLS-gated header like HSTS is", () => {
    expect(cspFor(true)).toBe(cspFor(false));
  });

  test("never weakens script/style with 'unsafe-inline' or 'unsafe-eval' — this base has no inline script or style to accommodate", () => {
    const policy = cspFor(true);

    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
  });

  test("with Turnstile disabled (the default / every LAN-offline deployment) no third-party origin is allowlisted", () => {
    const policy = cspFor(true, false);

    expect(policy).not.toContain("challenges.cloudflare.com");
    expect(policy).not.toContain("youtube-nocookie.com");
    expect(policy).not.toMatch(/https?:\/\//);
    // `frame-src` still appears only for Turnstile. `script-src` IS present
    // now (the admin theme-init hash lives there) but names nothing beyond
    // `'self'` and that one self-authored hash — no origin, third-party or
    // otherwise, is reachable through it.
    expect(policy).not.toContain("frame-src");
    expect(policy).toContain(`script-src 'self' '${THEME_INIT_SCRIPT_HASH}'`);
  });

  test("keeps X-Frame-Options: DENY alongside frame-ancestors 'none' as an independent older-browser layer", () => {
    const headers = buildSecurityHeaders({ isProduction: true });

    expect(headers).toContainEqual(["X-Frame-Options", "DENY"]);
    expect(cspFor(true)).toContain("frame-ancestors 'none'");
  });

  test("leaves the pre-existing headers untouched (CSP is additive, Issue #148 is config-only in spirit)", () => {
    const names = buildSecurityHeaders({ isProduction: true }).map(
      ([name]) => name
    );

    expect(names).toContain("X-Content-Type-Options");
    expect(names).toContain("Referrer-Policy");
    expect(names).toContain("Permissions-Policy");
    expect(names).toContain("Strict-Transport-Security");
  });

  test("still gates Strict-Transport-Security on production only", () => {
    const names = buildSecurityHeaders({ isProduction: false }).map(
      ([name]) => name
    );

    expect(names).not.toContain("Strict-Transport-Security");
    expect(names).toContain("Content-Security-Policy");
  });
});

/**
 * Cross-origin isolation (assessment of 4 August 2026 §9.2).
 *
 * These two are OWASP Secure Headers Project "recommended", and this repo is
 * the family member they actually apply to: it has human sessions and 42
 * rendered pages, where `awcms-astro` is a static template whose ADR-0028 §D
 * declines CORP for a reason that does not transfer (it would decide image
 * embedding on behalf of sites that do not exist yet).
 *
 * The assertions below are deliberately NOT "the header is present". They pin
 * the two properties that make them worth having and would be lost first by an
 * innocent-looking edit: the VALUES (a weaker `unsafe-none`/`cross-origin`
 * would still be a header), and that they are NOT gated on production the way
 * HSTS is (an attacker does not wait for TLS, and staging carries the same
 * admin session shape as production).
 */
describe("buildSecurityHeaders — cross-origin isolation (§9.2)", () => {
  const valueOf = (name: string, isProduction: boolean): string | undefined =>
    buildSecurityHeaders({ isProduction }).find(
      ([header]) => header === name
    )?.[1];

  test("sends Cross-Origin-Opener-Policy: same-origin, severing the opener tie to an authenticated admin window", () => {
    expect(valueOf("Cross-Origin-Opener-Policy", true)).toBe("same-origin");
  });

  test("sends Cross-Origin-Resource-Policy: same-origin, closing the no-cors embedding path CORS alone leaves open", () => {
    expect(valueOf("Cross-Origin-Resource-Policy", true)).toBe("same-origin");
  });

  test("both are unconditional — unlike HSTS they are NOT a TLS-gated header", () => {
    expect(valueOf("Cross-Origin-Opener-Policy", false)).toBe("same-origin");
    expect(valueOf("Cross-Origin-Resource-Policy", false)).toBe("same-origin");
  });

  test("adding them did not disturb the CSP single-owner guarantee", () => {
    // The whole point of §9.2 was that these are additive. If a future edit
    // reaches for `unsafe-none` to make some popup flow work, this file should
    // fail before the popup does.
    const enabled = buildSecurityHeaders({
      isProduction: true,
      turnstileEnabled: true
    });
    const disabled = buildSecurityHeaders({ isProduction: true });

    for (const headers of [enabled, disabled]) {
      const csp = headers.find(([name]) => name === "Content-Security-Policy");

      expect(csp?.[1]).toContain("default-src 'self'");
      expect(csp?.[1]).not.toContain("unsafe-inline");
    }

    expect(enabled.map(([name]) => name)).toEqual(
      disabled.map(([name]) => name)
    );
  });
});

describe("buildSecurityHeaders — Turnstile CSP origin (Issue #186)", () => {
  const CF = "https://challenges.cloudflare.com";

  test("opens EXACTLY the one Cloudflare origin in script-src and frame-src when enabled", () => {
    const list = directives(true, true);

    expect(list).toContain(
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}' ${CF}`
    );
    expect(list).toContain(`frame-src ${CF}`);
    // The Turnstile origin is the ONLY third-party origin — narrow, as required.
    const policy = cspFor(true, true);
    const origins = policy.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(new Set(origins)).toEqual(new Set([CF]));
  });

  test("re-states 'self' in script-src so the bundled login client still loads once script-src is present", () => {
    expect(cspFor(true, true)).toContain(
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}' ${CF}`
    );
    // ...and with Turnstile off too, since script-src is unconditional now.
    expect(cspFor(true, false)).toContain("script-src 'self'");
  });

  test("keeps every base directive unchanged when enabled (origin is purely additive)", () => {
    const list = directives(false, true);

    for (const base of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ]) {
      expect(list).toContain(base);
    }
  });

  test("enabled vs disabled differ ONLY by the Turnstile origin — proof it never leaks into the LAN/offline policy", () => {
    const disabled = directives(true, false);
    const enabled = directives(true, true);
    const added = enabled.filter((d) => !disabled.includes(d));

    // `script-src` now exists in BOTH; enabling Turnstile appends its origin to
    // the existing directive rather than introducing the directive. So the
    // delta is the rewritten script-src plus the new frame-src — and the ONLY
    // textual difference between the two script-src values is the appended
    // origin, which is what this test really guards.
    expect(added).toEqual([
      `script-src 'self' '${THEME_INIT_SCRIPT_HASH}' ${CF}`,
      `frame-src ${CF}`
    ]);

    const scriptSrcDisabled = disabled.find((d) => d.startsWith("script-src"));
    const scriptSrcEnabled = enabled.find((d) => d.startsWith("script-src"));
    expect(scriptSrcEnabled).toBe(`${scriptSrcDisabled} ${CF}`);

    // Every non-script-src directive survives enabling untouched.
    expect(
      disabled
        .filter((d) => !d.startsWith("script-src"))
        .every((d) => enabled.includes(d))
    ).toBe(true);
  });
});
