/**
 * Redirect precedence — a tenant's exact rule beats the retired-`/news` family
 * rewrite (Issue #599).
 *
 * The rule under test used to exist only as the order of two `await`s inside a
 * `try` block in `redirect-resolution-service.ts`. That shape cannot be reached
 * without a database, so nothing tested it — and it was backwards for as long
 * as it existed, defeating every redirect Issue #599 was about while the table
 * full of rules looked perfectly correct.
 *
 * These tests are on the pure decision. The wiring that feeds it is asserted
 * separately at the bottom, because a correct decision function called in the
 * wrong place is the same outage.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { chooseRedirectOutcome } from "../src/modules/seo-distribution/domain/redirect-precedence";
import type { RedirectOutcome } from "../src/modules/seo-distribution/domain/redirect-precedence";
import { parseRetiredNewsPath } from "../src/modules/seo-distribution/domain/retired-news-redirect";
import { isRedirectEligiblePath } from "../src/modules/seo-distribution/domain/redirect-eligibility";

const ROOT = path.resolve(import.meta.dir, "..");

const tenantRule: RedirectOutcome = {
  kind: "redirect",
  status: 301,
  location: "https://seputarborneo.test/id/blog/seputarborneo/banjir-kobar"
};

const retiredRewrite: RedirectOutcome = {
  kind: "redirect",
  status: 301,
  location:
    "https://seputarborneo.test/blog/seputarborneo/48213_banjir-kobar.html"
};

const passthrough: RedirectOutcome = {
  kind: "passthrough",
  capture: { tenantId: "t", normalizedPath: "/news/48213_banjir-kobar.html" }
};

describe("chooseRedirectOutcome", () => {
  test("the tenant's exact rule wins over the retired-/news rewrite", () => {
    // THE regression. Reversing this sends 23,906 indexed URLs to a path no
    // post answers, and the redirect table still reads as if it were working.
    expect(chooseRedirectOutcome(tenantRule, retiredRewrite)).toBe(tenantRule);
  });

  test("the retired rewrite still answers when no tenant rule matched", () => {
    // The retired family must keep working for the URLs it was built for —
    // this repo's own removed `/news/**` routes, which are in sitemaps and
    // feeds it published. The fix is a precedence change, not a removal.
    expect(chooseRedirectOutcome(passthrough, retiredRewrite)).toBe(
      retiredRewrite
    );
  });

  test("passthrough survives when neither strategy redirects", () => {
    // And it must be strategy 2's OWN passthrough: that value carries the
    // 404-capture context. Returning a fresh one would retire not-found
    // telemetry for the entire `/news` family, which shows up later as an
    // empty dashboard nobody can put a date on.
    const chosen = chooseRedirectOutcome(passthrough, null);
    expect(chosen).toBe(passthrough);
    expect(chosen.kind === "passthrough" && chosen.capture).toBeTruthy();
  });

  test("a retired passthrough never displaces strategy 2's capture", () => {
    const retiredPassthrough: RedirectOutcome = {
      kind: "passthrough",
      capture: null
    };
    expect(chooseRedirectOutcome(passthrough, retiredPassthrough)).toBe(
      passthrough
    );
  });

  test("skip from strategy 2 is not upgraded by a retired passthrough", () => {
    const skip: RedirectOutcome = { kind: "skip" };
    expect(chooseRedirectOutcome(skip, { kind: "skip" })).toBe(skip);
  });

  test("outside /news/** the precedence is unobservable", () => {
    // `retired` is null for every path that is not in the retired family, so
    // the function is the identity on strategy 2 there. This is what makes the
    // change safe to reason about: it cannot alter any other path.
    expect(chooseRedirectOutcome(passthrough, null)).toBe(passthrough);
    expect(chooseRedirectOutcome(tenantRule, null)).toBe(tenantRule);
  });
});

describe("the #599 URL shape is exactly the collision", () => {
  const legacyUrl = "/news/48213_banjir-kobar.html";

  test("a legacy URL is BOTH tenant-rule-eligible and claimed by the retired family", () => {
    // Either one alone would have been harmless. `isRedirectEligiblePath`
    // accepting it is why `blog:legacy:redirects:import` writes a rule;
    // `parseRetiredNewsPath` claiming it is why that rule was never read.
    expect(isRedirectEligiblePath(legacyUrl)).toBe(true);
    expect(parseRetiredNewsPath(legacyUrl)).toBe("/48213_banjir-kobar.html");
  });

  test("`/newsletter` is still not in the retired family", () => {
    // Guarding the segment-boundary match that keeps a capability name from
    // being swallowed by a five-letter prefix.
    expect(parseRetiredNewsPath("/newsletter")).toBeNull();
  });
});

describe("the service actually uses the decision", () => {
  const source = readFileSync(
    path.join(
      ROOT,
      "src/modules/seo-distribution/application/redirect-resolution-service.ts"
    ),
    "utf8"
  );

  /** Source with comments stripped — a rule quoted in prose is not a call. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("resolvePublicRedirect calls chooseRedirectOutcome", () => {
    expect(code).toContain("chooseRedirectOutcome(hostBased, retired)");
  });

  test("the host-based strategy is awaited FIRST", () => {
    // The decision function is order-independent, but the short-circuit above
    // it is not: asking the retired handler first would re-open a transaction
    // per eligible request and, worse, restore the old reading for anyone
    // skimming.
    const hostBasedAt = code.indexOf("await resolveHostBasedRedirect");
    const retiredAt = code.indexOf("await resolveRetiredNewsRedirect");
    expect(hostBasedAt).toBeGreaterThan(-1);
    expect(retiredAt).toBeGreaterThan(-1);
    expect(hostBasedAt).toBeLessThan(retiredAt);
  });

  test("no early `return retired` reintroduces the old precedence", () => {
    // The exact shape of the defect: `if (retired && retired.kind ===
    // "redirect") return retired;` sitting ABOVE the host-based call.
    const early = code.slice(0, code.indexOf("await resolveHostBasedRedirect"));
    expect(early).not.toContain("return retired");
  });
});
