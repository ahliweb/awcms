/**
 * Origin provenance (Issue #1153, ADR-0155 section 3): two tenant domains and
 * three websites under one tenant, and a forged third-party Origin.
 */
import { describe, expect, test } from "bun:test";

import {
  classifySubmissionOrigin,
  isRegisteredHost,
  submissionCorsHeaders,
  submissionPreflightHeaders
} from "../src/modules/website-engagement/domain/origin-policy";

function req(headers: Record<string, string>): Request {
  return new Request(
    "https://cms.example/api/v1/website-engagement/submissions",
    {
      method: "POST",
      headers
    }
  );
}

// One tenant, two domains, three websites (sources).
const DOMAIN_SHOP = "shop.example.id";
const DOMAIN_BLOG = "blog.example.id";
const SOURCES: Record<string, string[]> = {
  "site-a": [DOMAIN_SHOP],
  "site-b": [DOMAIN_SHOP, DOMAIN_BLOG],
  "site-c": [DOMAIN_BLOG]
};

describe("website_engagement origin policy", () => {
  test("a browser Origin is classified to its normalised host", () => {
    expect(
      classifySubmissionOrigin(req({ origin: "https://Shop.Example.ID" }))
    ).toEqual({
      origin: "https://shop.example.id",
      hostname: "shop.example.id",
      via: "origin"
    });
    expect(
      classifySubmissionOrigin(req({ origin: "http://localhost:4321" }))
        ?.hostname
    ).toBe("localhost");
  });

  test("unusable Origins are refused, and are NOT downgraded to a Referer the attacker could shape", () => {
    for (const origin of [
      "null",
      "",
      "chrome-extension://abcdef",
      "file://",
      "https://shop.example.id/path",
      "https://user:pw@shop.example.id",
      "ftp://shop.example.id",
      "not a url"
    ]) {
      expect(
        classifySubmissionOrigin(
          req({ origin, referer: "https://shop.example.id/contact" })
        )
      ).toBeNull();
    }
  });

  test("only when there is NO Origin header does the Referer host stand in; neither means refused", () => {
    expect(
      classifySubmissionOrigin(
        req({ referer: "https://blog.example.id/kontak?x=1" })
      )
    ).toEqual({
      origin: "https://blog.example.id",
      hostname: "blog.example.id",
      via: "referer"
    });
    expect(classifySubmissionOrigin(req({}))).toBeNull();
    expect(
      classifySubmissionOrigin(req({ referer: "javascript:alert(1)" }))
    ).toBeNull();
    expect(
      classifySubmissionOrigin(req({ referer: "https://u:p@a.example/" }))
    ).toBeNull();
    expect(
      classifySubmissionOrigin(req({ referer: "x".repeat(3000) }))
    ).toBeNull();
  });

  test("three websites, two domains: each source accepts exactly its own hosts", () => {
    const shop = classifySubmissionOrigin(
      req({ origin: `https://${DOMAIN_SHOP}` })
    )!;
    const blog = classifySubmissionOrigin(
      req({ origin: `https://${DOMAIN_BLOG}` })
    )!;

    expect(isRegisteredHost(shop.hostname, SOURCES["site-a"]!)).toBe(true);
    expect(isRegisteredHost(blog.hostname, SOURCES["site-a"]!)).toBe(false);
    expect(isRegisteredHost(shop.hostname, SOURCES["site-b"]!)).toBe(true);
    expect(isRegisteredHost(blog.hostname, SOURCES["site-b"]!)).toBe(true);
    expect(isRegisteredHost(shop.hostname, SOURCES["site-c"]!)).toBe(false);
    expect(isRegisteredHost(blog.hostname, SOURCES["site-c"]!)).toBe(true);
  });

  test("a forged third-party Origin matches nothing, including look-alikes", () => {
    for (const forged of [
      "https://evil.example",
      "https://shop.example.id.evil.example",
      "https://evil-shop.example.id.attacker.test",
      "https://xshop.example.id",
      "https://shop.example.id.",
      "https://shop-example-id"
    ]) {
      const origin = classifySubmissionOrigin(req({ origin: forged }));

      // Either unusable, or usable and unregistered: never accepted.
      expect(
        origin !== null && isRegisteredHost(origin.hostname, SOURCES["site-b"]!)
      ).toBe(false);
    }

    expect(isRegisteredHost("shop.example.id", [])).toBe(false);
    expect(isRegisteredHost("SHOP.example.ID", [DOMAIN_SHOP])).toBe(true);
  });

  test("CORS echoes the verified origin only: never *, never credentialed, Vary on every answer", () => {
    const granted = submissionCorsHeaders("https://shop.example.id");

    expect(granted["access-control-allow-origin"]).toBe(
      "https://shop.example.id"
    );
    expect(granted.vary).toBe("Origin");
    expect(Object.keys(granted)).not.toContain(
      "access-control-allow-credentials"
    );

    const refused = submissionCorsHeaders(null);

    expect(refused["access-control-allow-origin"]).toBeUndefined();
    expect(refused.vary).toBe("Origin");

    const preflight = submissionPreflightHeaders("https://shop.example.id");

    expect(preflight["access-control-allow-methods"]).toBe("POST, OPTIONS");
    // The token travels in the body: no Authorization header is ever negotiated.
    expect(preflight["access-control-allow-headers"]).toBe("content-type");
    expect(preflight["access-control-allow-origin"]).not.toBe("*");
    expect(
      submissionPreflightHeaders(null)["access-control-allow-origin"]
    ).toBeUndefined();
    expect(submissionPreflightHeaders(null).vary).toBe("Origin");
  });
});
