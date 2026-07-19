/**
 * Unit tests for the OIDC SSRF guard (Issue #185, top security requirement).
 * Pure IP-range classification, URL validation with an injected DNS resolver
 * (no real DNS), and the fetch-level guarantees (oversized response, redirect
 * to an internal address, timeout) against a LOCAL in-process server — never a
 * real internet host. The loopback test server is reached only via the
 * explicit `AUTH_SSO_ALLOW_INSECURE_HOSTS` escape hatch.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  isBlockedAddress,
  isBlockedIpv4,
  isBlockedIpv6,
  ssrfSafeFetch,
  validateOutboundUrl
} from "../src/lib/auth/ssrf-guard";

describe("SSRF — IPv4 range classification", () => {
  test("blocks private / loopback / link-local / metadata / CGNAT", () => {
    for (const ip of [
      "10.0.0.5",
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "255.255.255.255"
    ]) {
      expect(isBlockedIpv4(ip)).toBe(true);
    }
  });
  test("allows a normal public address", () => {
    expect(isBlockedIpv4("8.8.8.8")).toBe(false);
    expect(isBlockedIpv4("93.184.216.34")).toBe(false);
  });
});

describe("SSRF — IPv6 range classification", () => {
  test("blocks loopback / ULA / link-local / mapped-metadata", () => {
    for (const ip of [
      "::1",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "::ffff:169.254.169.254", // IPv4-mapped metadata
      "::ffff:10.0.0.1",
      "64:ff9b::7f00:1" // NAT64 -> 127.0.0.1
    ]) {
      expect(isBlockedIpv6(ip)).toBe(true);
    }
  });
  test("blocks the deprecated IPv4-compatible ::a.b.c.d form (auditor L2)", () => {
    for (const ip of [
      "::169.254.169.254", // metadata
      "::127.0.0.1", // loopback
      "::10.0.0.1" // private
    ]) {
      expect(isBlockedIpv6(ip)).toBe(true);
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  test("allows a public IPv6", () => {
    expect(isBlockedIpv6("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("SSRF — validateOutboundUrl (injected resolver)", () => {
  const publicResolver = async () => ["93.184.216.34"];
  const internalResolver = async () => ["10.0.0.9"];

  test("rejects non-https and embedded credentials", async () => {
    expect(
      (await validateOutboundUrl("http://idp.example", {}, publicResolver)).ok
    ).toBe(false);
    expect(
      (
        await validateOutboundUrl(
          "https://user:pass@idp.example",
          {},
          publicResolver
        )
      ).ok
    ).toBe(false);
  });

  test("rejects a hostname resolving to an internal address", async () => {
    const r = await validateOutboundUrl(
      "https://rebind.example",
      {},
      internalResolver
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("blocked_address");
  });

  test("rejects a direct internal IP literal, allows a public host", async () => {
    const blocked = await validateOutboundUrl(
      "https://169.254.169.254/latest/meta-data",
      {},
      publicResolver
    );
    expect(blocked.ok).toBe(false);
    expect(
      (await validateOutboundUrl("https://idp.example", {}, publicResolver)).ok
    ).toBe(true);
  });

  test("the allow-list escape hatch permits http+loopback (tests only)", async () => {
    const env = { AUTH_SSO_ALLOW_INSECURE_HOSTS: "127.0.0.1:9999" };
    const r = await validateOutboundUrl("http://127.0.0.1:9999/x", env);
    expect(r.ok).toBe(true);
  });
});

describe("SSRF — ssrfSafeFetch fetch-level guarantees", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/big") {
          return new Response("x".repeat(50_000));
        }
        if (url.pathname === "/redirect-internal") {
          // https so the scheme check passes and the IP-range check is what
          // blocks it — proving the redirect target is re-validated.
          return new Response(null, {
            status: 302,
            headers: { location: "https://169.254.169.254/secret" }
          });
        }
        if (url.pathname === "/slow") {
          await Bun.sleep(2000);
          return new Response("late");
        }
        if (url.pathname === "/drip") {
          // Streams a small chunk immediately (under the size cap) then stalls
          // — the body read must be covered by the total timeout budget, not
          // just the initial fetch (auditor L3).
          const stream = new ReadableStream({
            async start(ctrl) {
              ctrl.enqueue(new TextEncoder().encode("x"));
              await Bun.sleep(2000);
              ctrl.enqueue(new TextEncoder().encode("y"));
              ctrl.close();
            }
          });
          return new Response(stream);
        }
        return new Response("ok");
      }
    });
    base = `127.0.0.1:${server.port}`;
    env = {
      ...process.env,
      AUTH_SSO_ALLOW_INSECURE_HOSTS: base
    } as NodeJS.ProcessEnv;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("caps an oversized response", async () => {
    const r = await ssrfSafeFetch(`http://${base}/big`, {
      timeoutMs: 5000,
      maxResponseBytes: 1024,
      env
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("response_too_large");
  });

  test("blocks a redirect to an internal address", async () => {
    const r = await ssrfSafeFetch(`http://${base}/redirect-internal`, {
      timeoutMs: 5000,
      maxResponseBytes: 65_536,
      maxRedirects: 2,
      env
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("blocked_address");
  });

  test("times out a slow endpoint (fails fast, never hangs)", async () => {
    const start = performance.now();
    const r = await ssrfSafeFetch(`http://${base}/slow`, {
      timeoutMs: 200,
      maxResponseBytes: 65_536,
      env
    });
    const elapsed = performance.now() - start;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("request_failed");
    expect(elapsed).toBeLessThan(1500);
  });

  test("the timeout budget covers the body read (slow-drip under the size cap)", async () => {
    const start = performance.now();
    const r = await ssrfSafeFetch(`http://${base}/drip`, {
      timeoutMs: 250,
      maxResponseBytes: 65_536,
      env
    });
    const elapsed = performance.now() - start;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("request_failed");
    // Must abort near the deadline, not wait the full 2s slow-drip.
    expect(elapsed).toBeLessThan(1500);
  });

  test("a non-allow-listed loopback URL is refused before any connection", async () => {
    const r = await ssrfSafeFetch("http://127.0.0.1:1/x", {
      timeoutMs: 200,
      maxResponseBytes: 1024,
      env: { ...process.env, AUTH_SSO_ALLOW_INSECURE_HOSTS: "" }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("scheme_not_allowed");
  });
});
