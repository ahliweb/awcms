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

function cspFor(isProduction: boolean): string {
  const header = buildSecurityHeaders({ isProduction }).find(
    ([name]) => name === "Content-Security-Policy"
  );

  if (!header) {
    throw new Error("Content-Security-Policy header was not emitted at all.");
  }

  return header[1];
}

function directives(isProduction = false): string[] {
  return cspFor(isProduction)
    .split(";")
    .map((directive) => directive.trim());
}

describe("buildSecurityHeaders — Content-Security-Policy (Issue #148)", () => {
  test("emits a Content-Security-Policy header", () => {
    expect(
      buildSecurityHeaders({ isProduction: false }).map(([name]) => name)
    ).toContain("Content-Security-Policy");
  });

  test("carries every directive ported from awcms-mini's own policy", () => {
    expect(directives()).toEqual([
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
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

  test("drops mini's Turnstile/YouTube origins — no third-party origin is allowlisted anywhere", () => {
    const policy = cspFor(true);

    expect(policy).not.toContain("challenges.cloudflare.com");
    expect(policy).not.toContain("youtube-nocookie.com");
    expect(policy).not.toMatch(/https?:\/\//);
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
