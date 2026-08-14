/**
 * The single site-origin source, and the gate that keeps it single.
 *
 * The production defect these encode: the Node adapter derives `url.origin` from
 * its own listener, which speaks plain HTTP because Traefik terminates TLS, so
 * `https://awcms.ahlikoding.com/blog/ahliweb/feed.xml` returned
 * `<link>http://awcms.ahlikoding.com/…</link>` for every entry.
 *
 * The load-bearing case is `APP_URL` WITHOUT proxy trust: production sets
 * `APP_URL=https://awcms.ahlikoding.com` and does NOT set `PUBLIC_TRUST_PROXY`
 * (verified on the running container). A fix that only worked when proxy trust
 * was enabled would have shipped and changed nothing, so that combination is
 * tested first and explicitly.
 */
import { describe, expect, test } from "bun:test";
import {
  declaredSiteScheme,
  resolveHostOrigin,
  resolveRequestOrigin,
  resolveSiteScheme
} from "../src/lib/http/site-origin";
import { scanSource } from "../scripts/site-origin-check";

const URL_HTTP = new URL("http://awcms.ahlikoding.com/blog/ahliweb/feed.xml");

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://awcms.ahlikoding.com/", { headers });
}

describe("resolveRequestOrigin", () => {
  test("PRODUCTION SHAPE: APP_URL https, no proxy trust, listener http", () => {
    // This is the exact live configuration. If this test ever goes green for
    // the wrong reason, the feed regresses and nothing else notices.
    expect(
      resolveRequestOrigin(URL_HTTP, request(), {
        APP_URL: "https://awcms.ahlikoding.com"
      } as NodeJS.ProcessEnv)
    ).toBe("https://awcms.ahlikoding.com");
  });

  test("keeps the REQUEST host, not APP_URL's host", () => {
    // Multi-host deployments serve several tenant domains from one app; the
    // host the visitor used is the host their canonical must name. Only the
    // scheme is uniform.
    const url = new URL("http://tenant-two.example/blog/two");
    expect(
      resolveRequestOrigin(url, request(), {
        APP_URL: "https://awcms.ahlikoding.com"
      } as NodeJS.ProcessEnv)
    ).toBe("https://tenant-two.example");
  });

  test("X-Forwarded-Proto wins when the proxy is trusted", () => {
    expect(
      resolveRequestOrigin(
        URL_HTTP,
        request({ "x-forwarded-proto": "https" }),
        {
          PUBLIC_TRUST_PROXY: "true",
          APP_URL: "http://localhost:4321"
        } as NodeJS.ProcessEnv
      )
    ).toBe("https://awcms.ahlikoding.com");
  });

  test("X-Forwarded-Proto is IGNORED when the proxy is not trusted", () => {
    // An untrusted client can set this header to anything. Without the flag it
    // must not be able to rewrite every absolute URL the site emits.
    expect(
      resolveRequestOrigin(
        URL_HTTP,
        request({ "x-forwarded-proto": "https" }),
        {
          APP_URL: "http://localhost:4321"
        } as NodeJS.ProcessEnv
      )
    ).toBe("http://awcms.ahlikoding.com");
  });

  test("X-Forwarded-Host is honoured when trusted", () => {
    expect(
      resolveRequestOrigin(
        URL_HTTP,
        request({
          "x-forwarded-host": "public.example",
          "x-forwarded-proto": "https"
        }),
        { PUBLIC_TRUST_PROXY: "true" } as NodeJS.ProcessEnv
      )
    ).toBe("https://public.example");
  });

  test("a multi-value X-Forwarded-Proto is refused, not guessed", () => {
    // A comma-separated value means a proxy chain that appends rather than
    // overwrites. Picking one is choosing which hop to believe.
    expect(
      resolveRequestOrigin(
        URL_HTTP,
        request({ "x-forwarded-proto": "https,http" }),
        {
          PUBLIC_TRUST_PROXY: "true",
          APP_URL: "https://awcms.ahlikoding.com"
        } as NodeJS.ProcessEnv
      )
    ).toBe("https://awcms.ahlikoding.com"); // falls through to APP_URL
  });

  test("a multi-value X-Forwarded-Host falls back to the request host", () => {
    expect(
      resolveRequestOrigin(
        URL_HTTP,
        request({ "x-forwarded-host": "a.example, b.example" }),
        {
          PUBLIC_TRUST_PROXY: "true",
          APP_URL: "https://x"
        } as NodeJS.ProcessEnv
      )
    ).toBe("https://awcms.ahlikoding.com");
  });

  test("with nothing declared it degrades to today's behaviour", () => {
    // Not a good answer — the current, wrong-in-production one. Kept as the
    // last resort so a missing APP_URL degrades rather than 500s a public page.
    expect(
      resolveRequestOrigin(URL_HTTP, request(), {} as NodeJS.ProcessEnv)
    ).toBe("http://awcms.ahlikoding.com");
  });

  test("an unparseable APP_URL does not throw on the request path", () => {
    expect(
      resolveRequestOrigin(URL_HTTP, request(), {
        APP_URL: "not a url"
      } as NodeJS.ProcessEnv)
    ).toBe("http://awcms.ahlikoding.com");
  });
});

describe("declaredSiteScheme", () => {
  test.each([
    ["https://awcms.ahlikoding.com", "https"],
    ["http://localhost:4321", "http"],
    ["https://host:8443/path?q=1", "https"]
  ] as const)("%s -> %s", (appUrl, expected) => {
    expect(declaredSiteScheme({ APP_URL: appUrl } as NodeJS.ProcessEnv)).toBe(
      expected
    );
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["not a url", "awcms.ahlikoding.com"],
    ["a non-http scheme", "ftp://awcms.ahlikoding.com"]
  ])("%s -> null", (_name, appUrl) => {
    expect(
      declaredSiteScheme({ APP_URL: appUrl } as NodeJS.ProcessEnv)
    ).toBeNull();
  });
});

describe("resolveHostOrigin", () => {
  test("uses the declared scheme with a server-derived host", () => {
    expect(
      resolveHostOrigin("tenant.example", undefined, {
        APP_URL: "https://awcms.ahlikoding.com"
      } as NodeJS.ProcessEnv)
    ).toBe("https://tenant.example");
  });

  test("an http deployment gets http, not a hardcoded https", () => {
    // The offline-LAN case the old `https://${primaryHost}` literal got wrong:
    // sitemaps and feeds pointing at a scheme the deployment does not answer on.
    expect(
      resolveHostOrigin("awcms.lan", undefined, {
        APP_URL: "http://awcms.lan"
      } as NodeJS.ProcessEnv)
    ).toBe("http://awcms.lan");
  });
});

describe("resolveSiteScheme without a request", () => {
  test("jobs and emails still get the declared scheme", () => {
    expect(
      resolveSiteScheme(undefined, {
        APP_URL: "https://awcms.ahlikoding.com"
      } as NodeJS.ProcessEnv)
    ).toBe("https");
  });
});

describe("site-origin:check", () => {
  test("the resolver itself is exempt", () => {
    expect(
      scanSource("src/lib/http/site-origin.ts", "return `${scheme}://${host}`;")
    ).toEqual([]);
  });

  test.each([
    [
      "the feed defect",
      "const channelLink = `${url.origin}/blog/${tenantCode}`;"
    ],
    [
      "the canonical defect",
      "canonicalUrl: `${url.origin}/blog/${tenantCode}`,"
    ],
    ["an Astro component", "const self = `${Astro.url.origin}${path}`;"]
  ])("catches %s", (_name, line) => {
    const found = scanSource("src/pages/blog/x.ts", line);
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("request-origin");
  });

  test.each([
    [
      "the sitemap literal",
      "lines.push(`Sitemap: https://${input.primaryHost}/sitemap.xml`);"
    ],
    ["the absoluteUrl literal", "return `https://${primaryHost}${path}`;"],
    ["a bare host", "const site = `https://${host}`;"]
  ])("catches %s", (_name, line) => {
    const found = scanSource("src/modules/x/y.ts", line);
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("hardcoded-scheme");
  });

  test.each([
    [
      "a vendor endpoint whose host is only partly interpolated",
      "config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`;"
    ],
    [
      "a fixed third-party URL",
      'const base = "https://api.cloudflare.com/client/v4";'
    ],
    [
      "an origin COMPARISON, which never reaches output",
      "if (url.origin !== SYNTHETIC_ORIGIN) return null;"
    ],
    ["a VAPID audience", "const aud = new URL(endpoint).origin;"],
    [
      "a line comment quoting the broken form",
      "// was: `${url.origin}/blog` — see ADR"
    ],
    [
      "a doc-comment line quoting the literal",
      " * `https://${primaryHost}` was the old shape."
    ]
  ])("does not flag %s", (_name, line) => {
    expect(scanSource("src/modules/x/y.ts", line)).toEqual([]);
  });
});
