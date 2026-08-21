/**
 * Issue #637 — the public visit-ingest beacon could not be called from a
 * different origin by ANY of the three available paths, and none of the
 * failures showed up in this repo's logs.
 *
 * Two layers are covered here:
 *
 *   1. the pure origin policy (`domain/beacon-cors.ts`) — what counts as an
 *      origin at all, and what the grant/refusal headers are;
 *   2. the ACTUAL route handlers, driven with a fake Astro context, on every
 *      path that reaches a decision WITHOUT touching the database.
 *
 * The database-backed half — an `Origin` that really is a row in
 * `awcms_tenant_domains` — is proven against real Postgres in
 * `tests/integration/analytics-beacon-cors.integration.test.ts`. The split is
 * deliberate: the allow-list is the one part a mock could get wrong in the
 * direction that matters (granting), so it is never mocked.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { APIRoute } from "astro";

import { OPTIONS as collectOPTIONS } from "../src/pages/api/v1/analytics/collect";
import {
  BEACON_PREFLIGHT_MAX_AGE_SECONDS,
  beaconCorsDeniedHeaders,
  beaconCorsResponseHeaders,
  beaconPreflightHeaders,
  isCrossOriginBeacon,
  parseBeaconOrigin,
  resolveVisitorCookieSameSite
} from "../src/modules/visitor-analytics/domain/beacon-cors";
import { resetRateLimitForTests } from "../src/lib/security/rate-limit";

const ENDPOINT = "https://cms.example/api/v1/analytics/collect";

describe("parseBeaconOrigin", () => {
  test("accepts a plain https origin and lowercases the hostname", () => {
    expect(parseBeaconOrigin("https://News.Example")).toEqual({
      origin: "https://news.example",
      hostname: "news.example"
    });
  });

  test("keeps a non-default port in the echoed origin", () => {
    // The echoed value must match the browser's `Origin` byte for byte or the
    // grant does not apply; the hostname is the lookup key and carries no port.
    expect(parseBeaconOrigin("http://localhost:4321")).toEqual({
      origin: "http://localhost:4321",
      hostname: "localhost"
    });
  });

  test("rejects the literal `null` origin", () => {
    // A sandboxed iframe, a `file://` document and some redirect chains all
    // send this. Echoing it back would grant a document with NO origin the same
    // access a verified tenant domain has.
    expect(parseBeaconOrigin("null")).toBeNull();
  });

  test("rejects a missing or blank header", () => {
    expect(parseBeaconOrigin(null)).toBeNull();
    expect(parseBeaconOrigin(undefined)).toBeNull();
    expect(parseBeaconOrigin("   ")).toBeNull();
  });

  test("rejects non-http(s) schemes", () => {
    for (const value of [
      "chrome-extension://abcdefghijklmnop",
      "moz-extension://abcdefghijklmnop",
      "file://",
      "data:text/html,x",
      "javascript:alert(1)"
    ]) {
      expect(parseBeaconOrigin(value)).toBeNull();
    }
  });

  test("rejects anything that does not serialize back to itself", () => {
    // A real `Origin` header is exactly `scheme://host[:port]`. Rather than
    // strip a path/query/fragment/userinfo off, the parser demands equality —
    // one comparison that also rejects the shapes nobody has thought of yet.
    for (const value of [
      "https://news.example/",
      "https://news.example/path",
      "https://news.example?a=1",
      "https://news.example#frag",
      "https://user:pass@news.example",
      "https://news.example:443/x",
      "not a url"
    ]) {
      expect(parseBeaconOrigin(value)).toBeNull();
    }
  });

  test("rejects a URL with no hostname", () => {
    expect(parseBeaconOrigin("http://")).toBeNull();
  });
});

describe("isCrossOriginBeacon", () => {
  test("a same-origin request is not cross-origin", () => {
    expect(
      isCrossOriginBeacon(parseBeaconOrigin("https://cms.example"), ENDPOINT)
    ).toBe(false);
  });

  test("a different scheme, host or port is cross-origin", () => {
    for (const origin of [
      "http://cms.example",
      "https://news.example",
      "https://cms.example:8443"
    ]) {
      expect(isCrossOriginBeacon(parseBeaconOrigin(origin), ENDPOINT)).toBe(
        true
      );
    }
  });

  test("no origin at all is not cross-origin", () => {
    // Server-to-server callers and same-origin navigations send no `Origin`.
    // They take the unchanged path: no allow-list lookup, no CORS headers.
    expect(isCrossOriginBeacon(null, ENDPOINT)).toBe(false);
  });

  test("an unparseable request URL is treated as cross-origin", () => {
    // "Cannot be shown same-origin" must lead INTO the allow-list check, not
    // around it.
    expect(
      isCrossOriginBeacon(parseBeaconOrigin("https://news.example"), "::::")
    ).toBe(true);
  });
});

describe("CORS header sets", () => {
  test("a grant echoes the origin verbatim and allows credentials", () => {
    expect(beaconCorsResponseHeaders("https://news.example")).toEqual({
      "access-control-allow-origin": "https://news.example",
      "access-control-allow-credentials": "true",
      vary: "Origin"
    });
  });

  test("a preflight adds exactly the three preflight answers", () => {
    const headers = beaconPreflightHeaders("https://news.example");

    expect(headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    // `content-type` alone. This is the whole point: `application/json` keeps
    // the request out of Astro's form-like branch. Widening this list turns the
    // beacon into a general-purpose cross-origin API.
    expect(headers["access-control-allow-headers"]).toBe("content-type");
    expect(headers["access-control-max-age"]).toBe(
      String(BEACON_PREFLIGHT_MAX_AGE_SECONDS)
    );
  });

  test("a refusal still carries Vary and never a grant", () => {
    const headers = beaconCorsDeniedHeaders();

    expect(headers.vary).toBe("Origin");
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("no header set can ever produce a wildcard origin", () => {
    // `*` would let any page on the internet write to the beacon with a public
    // tenant code, and is not even legal alongside allow-credentials.
    const everything = {
      ...beaconPreflightHeaders("https://news.example"),
      ...beaconCorsResponseHeaders("https://news.example"),
      ...beaconCorsDeniedHeaders()
    };

    expect(Object.values(everything)).not.toContain("*");
  });
});

describe("resolveVisitorCookieSameSite", () => {
  test("same-origin keeps Lax", () => {
    expect(
      resolveVisitorCookieSameSite({ crossOrigin: false, secure: true })
    ).toBe("lax");
  });

  test("cross-origin over https uses None so the key survives", () => {
    expect(
      resolveVisitorCookieSameSite({ crossOrigin: true, secure: true })
    ).toBe("none");
  });

  test("cross-origin without Secure falls back to Lax", () => {
    // Browsers refuse `SameSite=None` without `Secure`. Emitting it anyway
    // would set a cookie the browser drops — a beacon that looks like it works.
    expect(
      resolveVisitorCookieSameSite({ crossOrigin: true, secure: false })
    ).toBe("lax");
  });
});

/** Minimal AstroCookies stub — the preflight never touches it. */
function fakeCookies() {
  const store = new Map<string, string>();
  return {
    get: (name: string) =>
      store.has(name) ? { value: store.get(name)! } : undefined,
    set: (name: string, value: string) => store.set(name, value),
    delete: (name: string) => store.delete(name),
    has: (name: string) => store.has(name)
  };
}

async function preflight(origin: string | null): Promise<Response> {
  const request = new Request(ENDPOINT, {
    method: "OPTIONS",
    headers: origin === null ? {} : { origin }
  });

  return (await (collectOPTIONS as APIRoute)({
    request,
    cookies: fakeCookies(),
    clientAddress: "203.0.113.9",
    locals: { correlationId: "test-corr" }
  } as never)) as Response;
}

describe("OPTIONS /api/v1/analytics/collect", () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  afterEach(() => {
    resetRateLimitForTests();
  });

  test("a request with no Origin gets 204, Vary, and no grant", async () => {
    const response = await preflight(null);

    expect(response.status).toBe(204);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a same-origin preflight gets no grant", async () => {
    const response = await preflight("https://cms.example");

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an opaque `null` Origin gets no grant", async () => {
    const response = await preflight("null");

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an extension-scheme Origin gets no grant", async () => {
    const response = await preflight("chrome-extension://abcdefghijklmnop");

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
