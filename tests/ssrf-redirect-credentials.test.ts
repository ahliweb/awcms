/**
 * Issue #1242 — `ssrfSafeFetch` must not forward credential headers to a
 * different origin on a redirect.
 *
 * The guard follows redirects by hand (`redirect: "manual"`), so the fetch
 * standard's own "strip Authorization on a cross-origin redirect" never runs.
 * Before the fix, every hop re-sent `options.headers` unchanged: a caller that
 * sent `Authorization: Bearer <token>` to a provider handed that token to
 * whatever host the provider (or a hostile subscription endpoint) redirected to.
 *
 * No real network: `globalThis.fetch` is replaced with a scripted two-origin
 * fixture and every URL is a public IP literal (so the SSRF validator passes
 * without DNS). The one `http:` scheme case goes through the reviewed
 * `AUTH_SSO_ALLOW_INSECURE_HOSTS` escape hatch, the same seam the neighbouring
 * `oidc-ssrf.test.ts` uses.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ssrfSafeFetch } from "../src/lib/auth/ssrf-guard";

type Recorded = {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
};

const realFetch = globalThis.fetch;
let calls: Recorded[] = [];
/** Scripted responses, consumed one per hop, in order. */
let script: Array<{ status: number; location?: string }> = [];

beforeEach(() => {
  calls = [];
  script = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body,
      headers
    });
    const step = script.shift() ?? { status: 200 };
    return new Response(step.status === 200 ? "ok" : null, {
      status: step.status,
      headers: step.location ? { location: step.location } : {}
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The i-th recorded request; throws (a clear failure) when the hop never happened. */
function hop(index: number): Recorded {
  const call = calls[index];

  if (!call) {
    throw new Error(`expected a request for hop ${index}, got ${calls.length}`);
  }

  return call;
}

const ORIGIN_A = "https://8.8.8.8";
const ORIGIN_B = "https://8.8.4.4";

const CREDENTIALS = {
  Authorization: "Bearer secret-token",
  Cookie: "sid=abc",
  "Proxy-Authorization": "Basic cHJveHk="
};
const BENIGN = {
  Accept: "application/json",
  "User-Agent": "awcms-test/1",
  "Content-Type": "application/json"
};

const baseOptions = { timeoutMs: 5_000, maxResponseBytes: 1_024 };

function lowerKeys(names: string[]): string[] {
  return names.map((name) => name.toLowerCase());
}

function expectNoCredentials(headers: Record<string, string>): void {
  for (const name of lowerKeys(Object.keys(CREDENTIALS))) {
    expect(headers[name]).toBeUndefined();
  }
}

function expectBenignKept(headers: Record<string, string>): void {
  expect(headers["accept"]).toBe("application/json");
  expect(headers["user-agent"]).toBe("awcms-test/1");
  expect(headers["content-type"]).toBe("application/json");
}

describe("ssrfSafeFetch — credential headers across a redirect (#1242)", () => {
  test("a single hop (no redirect) still sends every header unchanged", async () => {
    script = [{ status: 200 }];

    const r = await ssrfSafeFetch(`${ORIGIN_A}/x`, {
      ...baseOptions,
      headers: { ...CREDENTIALS, ...BENIGN }
    });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(hop(0).headers["authorization"]).toBe("Bearer secret-token");
    expect(hop(0).headers["cookie"]).toBe("sid=abc");
    expect(hop(0).headers["proxy-authorization"]).toBe("Basic cHJveHk=");
    expectBenignKept(hop(0).headers);
  });

  test("a different HOST drops Authorization, Cookie and Proxy-Authorization; benign headers survive", async () => {
    script = [
      { status: 302, location: `${ORIGIN_B}/landing` },
      { status: 200 }
    ];

    const r = await ssrfSafeFetch(`${ORIGIN_A}/x`, {
      ...baseOptions,
      headers: { ...CREDENTIALS, ...BENIGN }
    });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // Hop 0 (original origin) carries the credentials...
    expect(hop(0).headers["authorization"]).toBe("Bearer secret-token");
    // ...hop 1 (other origin) must not.
    expect(hop(1).url).toBe(`${ORIGIN_B}/landing`);
    expectNoCredentials(hop(1).headers);
    expectBenignKept(hop(1).headers);
  });

  test("a different PORT is a different origin", async () => {
    script = [
      { status: 302, location: `${ORIGIN_A}:8443/landing` },
      { status: 200 }
    ];

    await ssrfSafeFetch(`${ORIGIN_A}/x`, {
      ...baseOptions,
      headers: { ...CREDENTIALS, ...BENIGN }
    });

    expect(hop(1).url).toBe(`${ORIGIN_A}:8443/landing`);
    expectNoCredentials(hop(1).headers);
    expectBenignKept(hop(1).headers);
  });

  test("a different SCHEME (https -> http) is a different origin", async () => {
    script = [
      { status: 302, location: "http://8.8.8.8/landing" },
      { status: 200 }
    ];

    await ssrfSafeFetch(`${ORIGIN_A}/x`, {
      ...baseOptions,
      headers: { ...CREDENTIALS, ...BENIGN },
      // Reviewed test-only escape hatch so the http: hop passes the validator.
      env: { AUTH_SSO_ALLOW_INSECURE_HOSTS: "8.8.8.8" }
    });

    expect(hop(1).url).toBe("http://8.8.8.8/landing");
    expectNoCredentials(hop(1).headers);
    expectBenignKept(hop(1).headers);
  });

  test("a SAME-origin hop (absolute or relative Location, explicit default port) keeps the credentials", async () => {
    script = [
      { status: 302, location: "/two" },
      { status: 307, location: `${ORIGIN_A}:443/three` },
      { status: 200 }
    ];

    await ssrfSafeFetch(`${ORIGIN_A}/one`, {
      ...baseOptions,
      headers: { ...CREDENTIALS, ...BENIGN }
    });

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/one",
      "/two",
      "/three"
    ]);
    for (const call of calls) {
      expect(call.headers["authorization"]).toBe("Bearer secret-token");
      expect(call.headers["cookie"]).toBe("sid=abc");
      expect(call.headers["proxy-authorization"]).toBe("Basic cHJveHk=");
      expectBenignKept(call.headers);
    }
  });

  test("header names are matched case-insensitively, including duplicates that differ only by case", async () => {
    script = [{ status: 302, location: `${ORIGIN_B}/` }, { status: 200 }];

    await ssrfSafeFetch(`${ORIGIN_A}/x`, {
      ...baseOptions,
      headers: {
        authorization: "Bearer lower",
        AUTHORIZATION: "Bearer upper",
        cOoKiE: "sid=abc",
        "PROXY-authorization": "Basic cHJveHk=",
        Accept: "application/json"
      }
    });

    expectNoCredentials(hop(1).headers);
    expect(hop(1).headers["accept"]).toBe("application/json");
  });

  test("caller-declared credential headers are dropped cross-origin and kept same-origin", async () => {
    script = [
      { status: 302, location: "/same" },
      { status: 302, location: `${ORIGIN_B}/other` },
      { status: 200 }
    ];

    await ssrfSafeFetch(`${ORIGIN_A}/x`, {
      ...baseOptions,
      headers: {
        "x-API-key": "k-123",
        "X-Tenant-Token": "t-456",
        Authorization: "Bearer secret-token",
        ...BENIGN
      },
      // Declared with different casing than the header the caller sent.
      credentialHeaders: ["X-Api-Key", " x-tenant-token "]
    });

    expect(calls).toHaveLength(3);
    // same-origin hop keeps them
    expect(hop(1).headers["x-api-key"]).toBe("k-123");
    expect(hop(1).headers["x-tenant-token"]).toBe("t-456");
    // cross-origin hop loses the declared ones AND the default ones
    expect(hop(2).headers["x-api-key"]).toBeUndefined();
    expect(hop(2).headers["x-tenant-token"]).toBeUndefined();
    expect(hop(2).headers["authorization"]).toBeUndefined();
    expectBenignKept(hop(2).headers);
  });

  test("declaring extra credential headers never removes the default list", async () => {
    script = [{ status: 302, location: `${ORIGIN_B}/` }, { status: 200 }];

    await ssrfSafeFetch(`${ORIGIN_A}/x`, {
      ...baseOptions,
      headers: { ...CREDENTIALS, ...BENIGN },
      credentialHeaders: []
    });

    expectNoCredentials(hop(1).headers);
  });

  test("once dropped, credentials stay dropped: a chain that returns to the original origin does not get them back", async () => {
    script = [
      { status: 302, location: `${ORIGIN_B}/hop` },
      { status: 302, location: `${ORIGIN_A}/back` },
      { status: 302, location: "/again" },
      { status: 200 }
    ];

    await ssrfSafeFetch(`${ORIGIN_A}/start`, {
      ...baseOptions,
      headers: { ...CREDENTIALS, ...BENIGN },
      credentialHeaders: ["X-Api-Key"],
      maxRedirects: 5
    });

    expect(calls).toHaveLength(4);
    expect(hop(0).headers["authorization"]).toBe("Bearer secret-token");
    for (const call of calls.slice(1)) {
      // hop 2 and 3 are back on ORIGIN_A, and still carry nothing.
      expectNoCredentials(call.headers);
      expect(call.headers["x-api-key"]).toBeUndefined();
      expectBenignKept(call.headers);
    }
    expect(hop(2).url).toBe(`${ORIGIN_A}/back`);
    expect(hop(3).url).toBe(`${ORIGIN_A}/again`);
  });

  test("the original header map passed by the caller is not mutated", async () => {
    script = [{ status: 302, location: `${ORIGIN_B}/` }, { status: 200 }];
    const headers = { ...CREDENTIALS, ...BENIGN };
    const snapshot = { ...headers };

    await ssrfSafeFetch(`${ORIGIN_A}/x`, { ...baseOptions, headers });

    expect(headers).toEqual(snapshot);
  });

  test("a private-address redirect is still refused (the credential change did not loosen validation)", async () => {
    script = [{ status: 302, location: "https://10.0.0.5/" }];

    const r = await ssrfSafeFetch(`${ORIGIN_A}/x`, {
      ...baseOptions,
      headers: CREDENTIALS
    });

    expect(r).toEqual({ ok: false, reason: "blocked_address" });
    expect(calls).toHaveLength(1);
  });
});

describe("ssrfSafeFetch — redirect method/body rewriting is unchanged (#1242)", () => {
  for (const status of [301, 302, 303]) {
    test(`${status} turns a POST into a body-less GET and keeps non-credential headers on a same-origin hop`, async () => {
      script = [{ status, location: "/next" }, { status: 200 }];

      await ssrfSafeFetch(`${ORIGIN_A}/x`, {
        ...baseOptions,
        method: "POST",
        body: '{"a":1}',
        headers: { ...CREDENTIALS, ...BENIGN }
      });

      expect(hop(0).method).toBe("POST");
      expect(hop(0).body).toBe('{"a":1}');
      expect(hop(1).method).toBe("GET");
      expect(hop(1).body).toBeUndefined();
      expect(hop(1).headers["authorization"]).toBe("Bearer secret-token");
      expectBenignKept(hop(1).headers);
    });

    test(`${status} cross-origin: GET, no body, no credentials, benign headers kept`, async () => {
      script = [{ status, location: `${ORIGIN_B}/next` }, { status: 200 }];

      await ssrfSafeFetch(`${ORIGIN_A}/x`, {
        ...baseOptions,
        method: "POST",
        body: '{"a":1}',
        headers: { ...CREDENTIALS, ...BENIGN }
      });

      expect(hop(1).method).toBe("GET");
      expect(hop(1).body).toBeUndefined();
      expectNoCredentials(hop(1).headers);
      expectBenignKept(hop(1).headers);
    });
  }
});
