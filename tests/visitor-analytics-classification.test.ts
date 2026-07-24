/**
 * Unit tests for the pure classification/sanitization helpers of
 * `visitor_analytics`: user-agent parsing + bot detection, human
 * classification, path sanitization (the leak-prevention boundary), referrer
 * extraction, and request-area classification.
 */
import { describe, expect, test } from "bun:test";

import {
  isBotUserAgent,
  parseUserAgent
} from "../src/modules/visitor-analytics/domain/user-agent";
import {
  classifyHumanStatus,
  classifySessionHumanity
} from "../src/modules/visitor-analytics/domain/human-classifier";
import {
  isTrackablePath,
  sanitizePath
} from "../src/modules/visitor-analytics/domain/path-sanitizer";
import { extractReferrerDomain } from "../src/modules/visitor-analytics/domain/referrer";
import { determineArea } from "../src/modules/visitor-analytics/domain/request-area";

describe("user-agent parsing + bot detection", () => {
  test("detects a common desktop browser + OS", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const parsed = parseUserAgent(ua);
    expect(parsed.browserName).toBe("Chrome");
    expect(parsed.browserVersionMajor).toBe("120");
    expect(parsed.osName).toBe("Windows");
    expect(parsed.deviceType).toBe("desktop");
    expect(parsed.isBot).toBe(false);
  });

  test("detects a mobile device", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    const parsed = parseUserAgent(ua);
    expect(parsed.osName).toBe("iOS");
    expect(parsed.deviceType).toBe("mobile");
  });

  test("flags known crawlers as bots with a reason", () => {
    const bot = isBotUserAgent(
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
    );
    expect(bot.isBot).toBe(true);
    expect(bot.botReason).toBe("Googlebot");
    expect(parseUserAgent("curl/8.0.1").deviceType).toBe("bot");
  });

  test("empty/unknown UA resolves to deviceType 'unknown', never blindly human", () => {
    expect(parseUserAgent(null).deviceType).toBe("unknown");
    expect(parseUserAgent("").deviceType).toBe("unknown");
    expect(parseUserAgent("something-weird").deviceType).toBe("unknown");
  });
});

describe("human/bot classification", () => {
  test("a clear bot is 'bot' regardless of authentication", () => {
    const parsed = parseUserAgent("Googlebot/2.1");
    expect(
      classifyHumanStatus({ isAuthenticated: true, parsedUserAgent: parsed })
    ).toBe("bot");
  });

  test("an authenticated non-bot session is 'human' even with an odd UA", () => {
    const parsed = parseUserAgent("weird-ua");
    expect(
      classifyHumanStatus({ isAuthenticated: true, parsedUserAgent: parsed })
    ).toBe("human");
  });

  test("an anonymous unknown-device UA is 'unknown', not 'human'", () => {
    const parsed = parseUserAgent("weird-ua");
    expect(
      classifyHumanStatus({ isAuthenticated: false, parsedUserAgent: parsed })
    ).toBe("unknown");
  });

  test("session humanity: bot => is_human false with reason", () => {
    const parsed = parseUserAgent("AhrefsBot/7.0");
    const humanity = classifySessionHumanity({
      isAuthenticated: false,
      parsedUserAgent: parsed
    });
    expect(humanity.isHuman).toBe(false);
    expect(humanity.botReason).toBe("AhrefsBot");
  });
});

describe("path sanitization (leak-prevention boundary)", () => {
  test("strips sensitive query params, keeps safe ones", () => {
    const out = sanitizePath("/reset?token=SECRET123&lang=id&code=abc");
    expect(out).toContain("/reset");
    expect(out).toContain("lang=id");
    expect(out).not.toContain("SECRET123");
    expect(out).not.toContain("code=abc");
  });

  test("fails SAFE: an unparseable path degrades to its path portion, never echoes the raw query", () => {
    const out = sanitizePath("/x?token=abc%ZZ%");
    expect(out).not.toContain("token=abc");
  });

  test("isTrackablePath excludes assets, framework paths, health, and specs", () => {
    expect(isTrackablePath("/_astro/app.js")).toBe(false);
    expect(isTrackablePath("/logo.png")).toBe(false);
    expect(isTrackablePath("/favicon.ico")).toBe(false);
    expect(isTrackablePath("/api/v1/health")).toBe(false);
    expect(isTrackablePath("/openapi/spec.yaml")).toBe(false);
    expect(isTrackablePath("/blog/acme/my-post")).toBe(true);
    expect(isTrackablePath("/")).toBe(true);
  });
});

describe("referrer extraction", () => {
  test("returns bare hostname only, lowercased", () => {
    expect(extractReferrerDomain("https://News.Example.com/path?x=1")).toBe(
      "news.example.com"
    );
  });

  test("null for non-http(s) schemes and garbage", () => {
    expect(extractReferrerDomain("javascript:alert(1)")).toBeNull();
    expect(extractReferrerDomain("not a url")).toBeNull();
    expect(extractReferrerDomain(null)).toBeNull();
  });
});

describe("request-area classification", () => {
  test("maps paths to the constrained area set", () => {
    expect(determineArea("/admin/analytics")).toBe("admin");
    expect(determineArea("/api/v1/setup/status")).toBe("setup");
    expect(determineArea("/api/v1/auth/login")).toBe("auth");
    expect(determineArea("/api/v1/analytics/collect")).toBe("api");
    expect(determineArea("/blog/acme")).toBe("public");
  });
});
