import { describe, expect, test } from "bun:test";

import {
  buildDiscoveryCacheControl,
  buildDiscoverySignature,
  buildEtag,
  ifNoneMatchSatisfied,
  isNotModified,
  toHttpDate
} from "../src/modules/seo-distribution/domain/discovery-cache";

const parts = {
  kind: "sitemap-index",
  tenantId: "t1",
  host: "example.com",
  locale: "en",
  contractVersion: "1.1.0",
  configFingerprint: "cfg",
  contentFingerprint: "3|2026-07-01|2026-06-01"
};

describe("discovery-cache signatures", () => {
  test("signature is deterministic and content-derived", () => {
    expect(buildDiscoverySignature(parts)).toBe(buildDiscoverySignature(parts));
  });

  test("a content change moves the signature and the ETag", () => {
    const a = buildDiscoverySignature(parts);
    const b = buildDiscoverySignature({
      ...parts,
      contentFingerprint: "4|2026-07-02|2026-06-02"
    });
    expect(a).not.toBe(b);
    expect(buildEtag(a)).not.toBe(buildEtag(b));
  });

  test("different tenants sharing a null-host sentinel never collide", () => {
    const a = buildDiscoverySignature({
      ...parts,
      host: "no-primary-domain.invalid",
      tenantId: "t1"
    });
    const b = buildDiscoverySignature({
      ...parts,
      host: "no-primary-domain.invalid",
      tenantId: "t2"
    });
    expect(a).not.toBe(b);
  });

  test("buildEtag is a quoted strong validator", () => {
    const etag = buildEtag(buildDiscoverySignature(parts));
    expect(etag.startsWith('"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
  });
});

describe("conditional requests → 304", () => {
  const etag = buildEtag(buildDiscoverySignature(parts));
  const lastModified = toHttpDate(new Date("2026-07-01T00:00:00.000Z"));

  test("If-None-Match with the same ETag → not modified", () => {
    const headers = new Headers({ "if-none-match": etag });
    expect(isNotModified(headers, etag, lastModified)).toBe(true);
  });

  test("If-None-Match: * → not modified", () => {
    const headers = new Headers({ "if-none-match": "*" });
    expect(isNotModified(headers, etag, lastModified)).toBe(true);
  });

  test("If-None-Match with a different ETag → modified (200)", () => {
    const headers = new Headers({ "if-none-match": '"deadbeef"' });
    expect(isNotModified(headers, etag, lastModified)).toBe(false);
  });

  test("ifNoneMatchSatisfied strips the weak-validator prefix", () => {
    expect(ifNoneMatchSatisfied(`W/${etag}`, etag)).toBe(true);
  });

  test("If-Modified-Since at/after Last-Modified → not modified", () => {
    const headers = new Headers({
      "if-modified-since": toHttpDate(new Date("2026-07-02T00:00:00.000Z"))
    });
    expect(isNotModified(headers, etag, lastModified)).toBe(true);
  });

  test("If-Modified-Since before Last-Modified → modified", () => {
    const headers = new Headers({
      "if-modified-since": toHttpDate(new Date("2026-06-01T00:00:00.000Z"))
    });
    expect(isNotModified(headers, etag, lastModified)).toBe(false);
  });

  test("no conditional headers → modified", () => {
    expect(isNotModified(new Headers(), etag, lastModified)).toBe(false);
  });
});

describe("cache-control", () => {
  test("public, bounded, with stale-while-revalidate", () => {
    expect(buildDiscoveryCacheControl(300, 300, 600)).toBe(
      "public, max-age=300, s-maxage=300, stale-while-revalidate=600"
    );
  });
});
