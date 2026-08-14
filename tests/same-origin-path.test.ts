/**
 * `isSameOriginPath` — the narrow same-origin path guard (ADR-0095).
 *
 * The bypasses below are not hypothetical. `//evil.com`, `/\evil.com` and
 * `"/\t/evil.com"` are the three that `seo_distribution`'s frozen classifier
 * documents as VERIFIED bypasses of a naive `startsWith("/")` check, and they are
 * asserted here so this smaller guard cannot regress into the same hole.
 *
 * Pure: no database, no network, no filesystem.
 */
import { describe, expect, test } from "bun:test";

import {
  isSameOriginPath,
  sameOriginPathOr
} from "../src/lib/security/same-origin-path";

describe("isSameOriginPath accepts", () => {
  test("ordinary path-absolute references", () => {
    expect(isSameOriginPath("/admin")).toBe(true);
    expect(isSameOriginPath("/admin/blog")).toBe(true);
    expect(isSameOriginPath("/")).toBe(true);
  });

  test("query strings and fragments", () => {
    expect(isSameOriginPath("/admin/users?page=2")).toBe(true);
    expect(isSameOriginPath("/admin/users?q=a&cursor=abc%3D")).toBe(true);
    expect(isSameOriginPath("/admin/blog#section")).toBe(true);
  });

  test("percent-encoded segments", () => {
    // Safe because a percent sequence cannot introduce an authority component,
    // which is the only thing that could change the origin.
    expect(isSameOriginPath("/admin/media/a%20b")).toBe(true);
  });
});

describe("isSameOriginPath rejects", () => {
  test("protocol-relative references", () => {
    expect(isSameOriginPath("//evil.com")).toBe(false);
    expect(isSameOriginPath("//evil.com/path")).toBe(false);
  });

  test("backslash-normalised variants", () => {
    // Browsers normalise `\` to `/`, so this is `//evil.com` on arrival.
    expect(isSameOriginPath("/\\evil.com")).toBe(false);
    expect(isSameOriginPath("\\/evil.com")).toBe(false);
    expect(isSameOriginPath("/admin\\..\\evil")).toBe(false);
  });

  test("embedded control characters", () => {
    // The WHATWG URL parser strips TAB/LF/CR before parsing, so "/\t/evil.com"
    // collapses to "//evil.com" — the verified bypass.
    expect(isSameOriginPath("/\t/evil.com")).toBe(false);
    expect(isSameOriginPath("/\n/evil.com")).toBe(false);
    expect(isSameOriginPath("/\r/evil.com")).toBe(false);
    expect(isSameOriginPath("/admin\u0000")).toBe(false);
    expect(isSameOriginPath("/admin\u007f")).toBe(false);
  });

  test("absolute URLs, on any scheme", () => {
    expect(isSameOriginPath("https://evil.com/x")).toBe(false);
    expect(isSameOriginPath("http://evil.com")).toBe(false);
    expect(isSameOriginPath("javascript:alert(1)")).toBe(false);
    expect(isSameOriginPath("data:text/html,<script>")).toBe(false);
    expect(isSameOriginPath("mailto:a@b.c")).toBe(false);
  });

  test("references that are not path-absolute", () => {
    expect(isSameOriginPath("admin")).toBe(false);
    expect(isSameOriginPath("../admin")).toBe(false);
    expect(isSameOriginPath("")).toBe(false);
  });

  test("non-strings and oversized input", () => {
    expect(isSameOriginPath(null)).toBe(false);
    expect(isSameOriginPath(undefined)).toBe(false);
    expect(isSameOriginPath(42)).toBe(false);
    expect(isSameOriginPath({})).toBe(false);
    // Bounded: this runs on attacker-supplied form input on an unauthenticated
    // route.
    expect(isSameOriginPath(`/${"a".repeat(3000)}`)).toBe(false);
  });

  test("whitespace that could be trimmed into something else downstream", () => {
    expect(isSameOriginPath(" /admin")).toBe(false);
    expect(isSameOriginPath("/admin ")).toBe(false);
  });
});

describe("sameOriginPathOr", () => {
  test("passes a safe path through", () => {
    expect(sameOriginPathOr("/admin/blog", "/admin")).toBe("/admin/blog");
  });

  test("falls back rather than throwing, because the action already succeeded", () => {
    expect(sameOriginPathOr("//evil.com", "/admin")).toBe("/admin");
    expect(sameOriginPathOr(null, "/admin")).toBe("/admin");
  });
});
