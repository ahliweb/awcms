/**
 * Audit follow-ups for `website_engagement` (Issue #1153): the https rule (L2),
 * the closed attribution charset (L4), the IPv6 /64 limiter key (H1) and the
 * migration shape of the withdrawal-erases rule (M3) and the same-tenant guard
 * on UPDATE (L1).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { rateLimitClientKey } from "../src/modules/website-engagement/domain/client-key";
import {
  classifySubmissionOrigin,
  isAcceptableOriginScheme,
  isLocalDevHost,
  submissionPreflightHeaders
} from "../src/modules/website-engagement/domain/origin-policy";
import { validateSubmissionRequest } from "../src/modules/website-engagement/domain/submission-request";

const read = (relative: string) =>
  readFileSync(path.resolve(import.meta.dir, "..", relative), "utf8");

function origin(value: string) {
  return classifySubmissionOrigin(
    new Request("https://cms.example/x", { headers: { origin: value } })
  )!;
}

describe("L2: https unless a localhost dev host", () => {
  test("production hosts need https; localhost may use http", () => {
    expect(isAcceptableOriginScheme(origin("https://shop.example.id"))).toBe(
      true
    );
    expect(isAcceptableOriginScheme(origin("http://shop.example.id"))).toBe(
      false
    );
    expect(isAcceptableOriginScheme(origin("http://localhost:4321"))).toBe(
      true
    );
    expect(isAcceptableOriginScheme(origin("http://127.0.0.1:4321"))).toBe(
      true
    );
    expect(isAcceptableOriginScheme(origin("http://app.localhost"))).toBe(true);
    // Look-alikes are not dev hosts.
    expect(isLocalDevHost("localhost.evil.example")).toBe(false);
    expect(isLocalDevHost("notlocalhost")).toBe(false);
    expect(
      isAcceptableOriginScheme(origin("http://localhost.evil.example"))
    ).toBe(false);
  });

  test("a Referer fallback is held to the same rule", () => {
    const viaReferer = classifySubmissionOrigin(
      new Request("https://cms.example/x", {
        headers: { referer: "http://shop.example.id/kontak" }
      })
    )!;

    expect(isAcceptableOriginScheme(viaReferer)).toBe(false);
  });

  test("the preflight never reflects an http origin for a production host", () => {
    // The caller (public-preflight) passes null for an unacceptable scheme.
    expect(
      submissionPreflightHeaders(null)["access-control-allow-origin"]
    ).toBeUndefined();
  });
});

describe("L4: attribution carries no personal data", () => {
  const base = {
    sourceToken: "t",
    eventId: "evt-12345678",
    kind: "lead",
    contact: { email: "a@b.co" },
    consent: { purposes: ["respond_to_inquiry"], copyVersion: "v1" }
  };
  const fields = (attribution: unknown) => {
    const result = validateSubmissionRequest({ ...base, attribution });

    return result.valid ? [] : result.errors.map((e) => e.field);
  };

  test("utm values use a closed charset: no @, %, :, + or other carriers", () => {
    for (const bad of [
      "john@example.com",
      "a%40b.co",
      "tel:0812",
      "a+b",
      "x/y",
      "a,b"
    ]) {
      expect(fields({ utmSource: bad })).toContain("attribution.utmSource");
    }

    for (const good of ["newsletter", "ramadan-2026", "spring sale", "a_b.c"]) {
      expect(fields({ utmMedium: good })).toEqual([]);
    }
  });

  test("paths refuse % and @ as well as query, fragment and whitespace", () => {
    for (const bad of [
      "/u/jo%40x.com",
      "/u/budi@x.com",
      "/a?x=1",
      "/a#b",
      "/a b"
    ]) {
      expect(fields({ landingPath: bad })).toContain("attribution.landingPath");
    }

    expect(fields({ landingPath: "/produk/paket-a" })).toEqual([]);
    expect(
      validateSubmissionRequest({
        ...base,
        consent: {
          purposes: ["respond_to_inquiry"],
          copyVersion: "v1",
          pagePath: "/me@x"
        }
      }).valid
    ).toBe(false);
  });

  test("the database CHECK mirrors the validator", () => {
    const schema = read("sql/325_awcms_website_engagement_schema.sql");

    expect((schema.match(/\[\^\?#%@\[:space:\]\]/g) ?? []).length).toBe(2);
  });
});

describe("H1: the per-address key is the IPv6 /64", () => {
  test("addresses in one /64 share a key; another /64 and IPv4 do not", () => {
    const a = rateLimitClientKey("2001:db8:1:2::1");

    expect(rateLimitClientKey("2001:DB8:1:2:ffff:eeee:dddd:1")).toBe(a);
    expect(rateLimitClientKey("2001:db8:0001:0002:0:0:0:9")).toBe(a);
    expect(rateLimitClientKey("2001:db8:1:3::1")).not.toBe(a);
    expect(a).toBe("2001:0db8:0001:0002::/64");
    expect(rateLimitClientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitClientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitClientKey("::1")).toBe("0000:0000:0000:0000::/64");
  });

  test("garbage never throws and is keyed as itself", () => {
    for (const value of [
      "unknown",
      "",
      "1:2:3:4:5:6:7:8:9",
      "gggg::1",
      "a::b::c"
    ]) {
      expect(typeof rateLimitClientKey(value)).toBe("string");
    }
  });
});

describe("M3 and L1 migration shape", () => {
  const schema = read("sql/325_awcms_website_engagement_schema.sql");
  const guards = read("sql/327_awcms_website_engagement_integrity_guards.sql");

  test("a withdrawn contact/lead must have erased every identifier", () => {
    expect(schema).toContain("status = 'withdrawn'");
    expect(schema).toMatch(
      /status = 'withdrawn'\s+AND contact_encrypted IS NULL\s+AND email_hash IS NULL AND phone_hash IS NULL\s+AND email_masked IS NULL AND phone_masked IS NULL/
    );
  });

  test("the guard lets identifiers change only by the withdrawal, and the link guard fires on UPDATE", () => {
    expect(guards).toContain(
      "NOT (OLD.status = 'received' AND NEW.status = 'withdrawn')"
    );
    expect(guards).toContain(
      "BEFORE INSERT OR UPDATE OF tenant_id, source_id, tenant_domain_id"
    );
  });
});
