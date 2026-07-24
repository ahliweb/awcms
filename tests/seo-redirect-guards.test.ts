/**
 * Unit tests for the `seo_distribution` redirect SAFETY GUARDS (ADR-0039) — the
 * pure, I/O-free domain layer that is the entire open-redirect / loop / hijack
 * defense. Every rejection here is a security control, so each is asserted
 * explicitly. Control characters are built with `String.fromCharCode` (never typed
 * as literal bytes) so this source file stays free of embedded control bytes.
 */
import { describe, expect, test } from "bun:test";

import {
  MAX_REDIRECT_PATH_LENGTH,
  normalizeRedirectPath,
  redirectPathKey
} from "../src/modules/seo-distribution/domain/redirect-path";
import {
  assertSafeRedirectTarget,
  classifyRedirectTarget
} from "../src/modules/seo-distribution/domain/redirect-target-classification";
import { validateRedirectTarget } from "../src/modules/seo-distribution/domain/redirect-target";
import {
  combineChainStatus,
  resolveRedirectChain,
  type RedirectHopRule
} from "../src/modules/seo-distribution/domain/redirect-chain";
import { isRedirectEligiblePath } from "../src/modules/seo-distribution/domain/redirect-eligibility";
import { applyRedirectQueryPolicy } from "../src/modules/seo-distribution/domain/redirect-query-policy";

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

const OWN_HOSTS = ["example.com", "www.example.com"];

describe("normalizeRedirectPath", () => {
  test("accepts and canonicalizes a plain path", () => {
    const r = normalizeRedirectPath("/a/b");
    expect(r.ok && r.path).toBe("/a/b");
  });

  test("clamps dot-segment traversal at the root (can never escape origin)", () => {
    const r = normalizeRedirectPath("/a/../../../etc/passwd");
    expect(r.ok && r.path).toBe("/etc/passwd");
  });

  test("collapses duplicate slashes, strips trailing slash, uppercases %xx", () => {
    expect(
      normalizeRedirectPath("/a//b/").ok &&
        (normalizeRedirectPath("/a//b/") as { path: string }).path
    ).toBe("/a/b");
    const enc = normalizeRedirectPath("/a%2fb");
    expect(enc.ok && enc.path).toBe("/a%2Fb");
  });

  test("rejects CRLF / control chars (header-injection defense)", () => {
    expect(normalizeRedirectPath(`/a${CR}${LF}Set-Cookie:x`).ok).toBe(false);
    expect(normalizeRedirectPath(`/a${LF}b`).ok).toBe(false);
    expect(normalizeRedirectPath(`/a${TAB}b`).ok).toBe(false);
    expect(normalizeRedirectPath(`/a${NUL}b`).ok).toBe(false);
    expect(normalizeRedirectPath(`/a${DEL}b`).ok).toBe(false);
  });

  test("rejects a backslash (slash-confusion vector)", () => {
    expect(normalizeRedirectPath("/a\\b").ok).toBe(false);
    expect(normalizeRedirectPath("\\/evil.com").ok).toBe(false);
  });

  test("rejects protocol-relative and non-leading-slash", () => {
    expect(normalizeRedirectPath("//evil.com").ok).toBe(false);
    expect(normalizeRedirectPath("a/b").ok).toBe(false);
    expect(normalizeRedirectPath("https://evil.com").ok).toBe(false);
  });

  test("rejects empty and over-length", () => {
    expect(normalizeRedirectPath("").ok).toBe(false);
    expect(normalizeRedirectPath("   ").ok).toBe(false);
    expect(
      normalizeRedirectPath("/" + "a".repeat(MAX_REDIRECT_PATH_LENGTH)).ok
    ).toBe(false);
  });

  test("rejects non-string", () => {
    expect(normalizeRedirectPath(42).ok).toBe(false);
    expect(normalizeRedirectPath(null).ok).toBe(false);
  });

  test("redirectPathKey strips the query", () => {
    expect(redirectPathKey("/a?x=1")).toBe("/a");
    expect(redirectPathKey("/a")).toBe("/a");
  });
});

describe("classifyRedirectTarget (frozen open-redirect guard)", () => {
  test("same-origin relative path is same_tenant_internal", () => {
    expect(classifyRedirectTarget("/x/y", OWN_HOSTS)).toBe(
      "same_tenant_internal"
    );
  });

  test("absolute URL on an own verified host is same_tenant_internal", () => {
    expect(classifyRedirectTarget("https://example.com/x", OWN_HOSTS)).toBe(
      "same_tenant_internal"
    );
    expect(classifyRedirectTarget("https://WWW.EXAMPLE.COM/x", OWN_HOSTS)).toBe(
      "same_tenant_internal"
    );
  });

  test("absolute URL on another host is cross_host_external", () => {
    expect(classifyRedirectTarget("https://evil.com/x", OWN_HOSTS)).toBe(
      "cross_host_external"
    );
  });

  test("protocol-relative and backslash tricks are invalid", () => {
    expect(classifyRedirectTarget("//evil.com", OWN_HOSTS)).toBe("invalid");
    expect(classifyRedirectTarget("/\\evil.com", OWN_HOSTS)).toBe("invalid");
    expect(classifyRedirectTarget("\\/evil.com", OWN_HOSTS)).toBe("invalid");
  });

  test("tab-in-relative-path bypass (browsers strip TAB → //evil) is invalid", () => {
    expect(classifyRedirectTarget(`/${TAB}/evil.com`, OWN_HOSTS)).toBe(
      "invalid"
    );
    expect(classifyRedirectTarget(`/a${CR}${LF}b`, OWN_HOSTS)).toBe("invalid");
  });

  test("non-http(s) schemes are invalid", () => {
    expect(classifyRedirectTarget("javascript:alert(1)", OWN_HOSTS)).toBe(
      "invalid"
    );
    expect(classifyRedirectTarget("data:text/html,x", OWN_HOSTS)).toBe(
      "invalid"
    );
    expect(classifyRedirectTarget("mailto:x@y.z", OWN_HOSTS)).toBe("invalid");
  });

  test("empty / non-string is invalid", () => {
    expect(classifyRedirectTarget("", OWN_HOSTS)).toBe("invalid");
    expect(classifyRedirectTarget("   ", OWN_HOSTS)).toBe("invalid");
  });

  test("assertSafeRedirectTarget throws unless same_tenant_internal", () => {
    expect(() => assertSafeRedirectTarget("/x", OWN_HOSTS)).not.toThrow();
    expect(() =>
      assertSafeRedirectTarget("https://example.com/x", OWN_HOSTS)
    ).not.toThrow();
    expect(() =>
      assertSafeRedirectTarget("https://evil.com/x", OWN_HOSTS)
    ).toThrow();
    expect(() => assertSafeRedirectTarget("//evil.com", OWN_HOSTS)).toThrow();
  });
});

describe("validateRedirectTarget", () => {
  test("relative same-origin → relative_same_tenant, normalized", () => {
    const r = validateRedirectTarget("/a/../b", OWN_HOSTS);
    expect(r.ok && r.targetType).toBe("relative_same_tenant");
    expect(r.ok && r.target).toBe("/b");
  });

  test("absolute own-host → verified_external, fragment stripped", () => {
    const r = validateRedirectTarget("https://example.com/x#frag", OWN_HOSTS);
    expect(r.ok && r.targetType).toBe("verified_external");
    expect(r.ok && r.target).toBe("https://example.com/x");
  });

  test("cross-host absolute is refused", () => {
    const r = validateRedirectTarget("https://evil.com/x", OWN_HOSTS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.classification).toBe("cross_host_external");
  });

  test("protocol-relative / CRLF / empty refused", () => {
    expect(validateRedirectTarget("//evil.com", OWN_HOSTS).ok).toBe(false);
    expect(validateRedirectTarget(`/a${CR}${LF}b`, OWN_HOSTS).ok).toBe(false);
    expect(validateRedirectTarget("", OWN_HOSTS).ok).toBe(false);
  });
});

describe("resolveRedirectChain (bounded, fail-closed)", () => {
  const rule = (
    target: string,
    targetType: RedirectHopRule["targetType"] = "relative_same_tenant"
  ): RedirectHopRule => ({
    id: target,
    targetType,
    target,
    statusCode: 301,
    preserveQuery: false
  });

  test("no matching rule → none", async () => {
    const outcome = await resolveRedirectChain("/x", () => null);
    expect(outcome.outcome).toBe("none");
  });

  test("single hop → redirect", async () => {
    const map: Record<string, RedirectHopRule> = { "/a": rule("/b") };
    const outcome = await resolveRedirectChain("/a", (k) => map[k] ?? null);
    expect(outcome.outcome).toBe("redirect");
    if (outcome.outcome === "redirect") expect(outcome.finalTarget).toBe("/b");
  });

  test("self-redirect → loop (fail closed)", async () => {
    const map: Record<string, RedirectHopRule> = { "/a": rule("/a") };
    const outcome = await resolveRedirectChain("/a", (k) => map[k] ?? null);
    expect(outcome.outcome).toBe("loop");
  });

  test("two-node cycle → loop (fail closed)", async () => {
    const map: Record<string, RedirectHopRule> = {
      "/a": rule("/b"),
      "/b": rule("/a")
    };
    const outcome = await resolveRedirectChain("/a", (k) => map[k] ?? null);
    expect(outcome.outcome).toBe("loop");
  });

  test("chain longer than the cap → chain_too_long (fail closed)", async () => {
    // /a→/b→/c→/d→/e→/f→/g … always another hop, never terminates.
    const outcome = await resolveRedirectChain("/n0", (k) => {
      const i = Number(k.slice(2));
      return rule(`/n${i + 1}`);
    });
    expect(outcome.outcome).toBe("chain_too_long");
  });

  test("verified_external hop on an OWN host folds back into loop detection", async () => {
    const map: Record<string, RedirectHopRule> = {
      "/a": rule("https://example.com/a", "verified_external")
    };
    const outcome = await resolveRedirectChain("/a", (k) => map[k] ?? null, {
      allowedHosts: OWN_HOSTS
    });
    // The absolute target's /a path re-enters the chain → self-loop, fail closed.
    expect(outcome.outcome).toBe("loop");
  });

  test("verified_external hop on a FOREIGN host is terminal (not folded)", async () => {
    const map: Record<string, RedirectHopRule> = {
      "/a": rule("https://other.example/a", "verified_external")
    };
    const outcome = await resolveRedirectChain("/a", (k) => map[k] ?? null, {
      allowedHosts: OWN_HOSTS
    });
    expect(outcome.outcome).toBe("redirect");
  });

  test("combineChainStatus: permanent only if EVERY hop is permanent", () => {
    expect(combineChainStatus([rule("/b")])).toBe(301);
    const temp: RedirectHopRule = { ...rule("/c"), statusCode: 302 };
    expect(combineChainStatus([rule("/b"), temp])).toBe(302);
    const perm308: RedirectHopRule = { ...rule("/b"), statusCode: 308 };
    expect(combineChainStatus([perm308])).toBe(308);
  });
});

describe("isRedirectEligiblePath (admin-route-hijack + discovery-shadow defense)", () => {
  test("a normal content path is eligible", () => {
    expect(isRedirectEligiblePath("/about")).toBe(true);
    expect(isRedirectEligiblePath("/blog/tenant-a/post")).toBe(true);
    expect(isRedirectEligiblePath("/administration")).toBe(true); // not /admin
  });

  test("admin / auth / api families are excluded", () => {
    for (const p of [
      "/admin",
      "/admin/x",
      "/login",
      "/logout",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/setup",
      "/auth/callback",
      "/api/v1/seo/config",
      "/openapi",
      "/asyncapi"
    ]) {
      expect(isRedirectEligiblePath(p)).toBe(false);
    }
  });

  test("shipped discovery routes are excluded (never shadowed by a redirect)", () => {
    for (const p of [
      "/robots.txt",
      "/sitemap.xml",
      "/sitemap-1.xml",
      "/feed.xml",
      "/atom.xml",
      "/feed.json",
      "/health"
    ]) {
      expect(isRedirectEligiblePath(p)).toBe(false);
    }
  });

  test("static assets, favicon, framework internals excluded", () => {
    for (const p of [
      "/logo.png",
      "/app.css",
      "/bundle.js",
      "/favicon.ico",
      "/_astro/x",
      "/.well-known/x"
    ]) {
      expect(isRedirectEligiblePath(p)).toBe(false);
    }
  });

  test("control chars (raw and percent-encoded) fail safe", () => {
    expect(isRedirectEligiblePath(`/a${LF}b`)).toBe(false);
    expect(isRedirectEligiblePath("/a%0Ab")).toBe(false);
    // encoded reserved family: /%61pi/ → /api/ must be recognized as excluded.
    expect(isRedirectEligiblePath("/%61pi/v1")).toBe(false);
  });

  test("non-string / non-leading-slash fail safe", () => {
    expect(isRedirectEligiblePath("no-slash")).toBe(false);
    expect(isRedirectEligiblePath(undefined as unknown as string)).toBe(false);
  });
});

describe("applyRedirectQueryPolicy", () => {
  const base = {
    target: "/dest",
    targetType: "relative_same_tenant" as const,
    incomingSearch: "?x=1"
  };

  test("drops the incoming query by default (preserveQuery false)", () => {
    expect(applyRedirectQueryPolicy({ ...base, preserveQuery: false })).toBe(
      "/dest"
    );
  });

  test("preserves only for a relative target with no query of its own", () => {
    expect(applyRedirectQueryPolicy({ ...base, preserveQuery: true })).toBe(
      "/dest?x=1"
    );
    expect(
      applyRedirectQueryPolicy({
        ...base,
        target: "/dest?a=b",
        preserveQuery: true
      })
    ).toBe("/dest?a=b");
  });

  test("never appends to a verified_external target", () => {
    expect(
      applyRedirectQueryPolicy({
        target: "https://example.com/x",
        targetType: "verified_external",
        preserveQuery: true,
        incomingSearch: "?x=1"
      })
    ).toBe("https://example.com/x");
  });

  test("no-op when the incoming query is empty", () => {
    expect(
      applyRedirectQueryPolicy({
        ...base,
        preserveQuery: true,
        incomingSearch: ""
      })
    ).toBe("/dest");
  });
});
