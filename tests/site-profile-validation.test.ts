/**
 * `site_profile` validation (Issue #596, ADR-0102).
 *
 * Pure — no database. The cases that matter are the social links: those URLs
 * are rendered as `<a href>` on EVERY public page, so a `javascript:` value
 * there is stored XSS with a very long reach. They are refused, never
 * sanitized, and these assert the refusal rather than the happy path.
 */
import { describe, expect, test } from "bun:test";

import {
  isSafeSocialUrl,
  SITE_PROFILE_LIMITS,
  validateSiteProfileInput
} from "../src/modules/site-profile/domain/site-profile-validation";

describe("validateSiteProfileInput — the empty case", () => {
  test("an empty body is VALID and yields an all-null profile", () => {
    // A tenant that has filled in nothing is a valid tenant. Requiring a
    // WhatsApp number to save an address would make the screen unusable.
    const result = validateSiteProfileInput({});

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.tagline).toBeNull();
      expect(result.value.editorialAddress).toBeNull();
      expect(result.value.socialLinks).toEqual([]);
    }
  });

  test("an empty STRING clears a field rather than storing ''", () => {
    // A footer rendering a blank line is worse than one that omits the block.
    const result = validateSiteProfileInput({ tagline: "   " });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.tagline).toBeNull();
  });

  test("null is accepted as an explicit clear", () => {
    const result = validateSiteProfileInput({ contactEmail: null });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.contactEmail).toBeNull();
  });
});

describe("validateSiteProfileInput — bounds and types", () => {
  test("text is trimmed", () => {
    const result = validateSiteProfileInput({ tagline: "  Kabar Kalteng  " });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.tagline).toBe("Kabar Kalteng");
  });

  test("over-length text is refused, naming the field", () => {
    const result = validateSiteProfileInput({
      tagline: "x".repeat(SITE_PROFILE_LIMITS.tagline + 1)
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toContain("tagline");
    }
  });

  test("a non-string in a text field is refused, not coerced", () => {
    const result = validateSiteProfileInput({ tagline: 42 });

    expect(result.valid).toBe(false);
  });

  test("a media id must be a UUID", () => {
    expect(validateSiteProfileInput({ logoMediaId: "not-a-uuid" }).valid).toBe(
      false
    );
    expect(
      validateSiteProfileInput({
        logoMediaId: "11111111-1111-4111-8111-111111111111"
      }).valid
    ).toBe(true);
  });
});

describe("isSafeSocialUrl — the reason this module has a security surface", () => {
  test("accepts absolute http(s)", () => {
    expect(isSafeSocialUrl("https://facebook.com/lentera")).toBe(true);
    expect(isSafeSocialUrl("http://example.test/x")).toBe(true);
  });

  test("REFUSES javascript: and data:", () => {
    // Rendered as <a href> on every public page. Sanitizing would be answering
    // the wrong question; the answer is that these are not links.
    expect(isSafeSocialUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeSocialUrl("data:text/html,<script>alert(1)</script>")).toBe(
      false
    );
    expect(isSafeSocialUrl("JavaScript:alert(1)")).toBe(false);
  });

  test("refuses protocol-relative and scheme-less values", () => {
    // Both parse as "something" in a browser and neither states an origin,
    // which is exactly the ambiguity an attacker uses.
    expect(isSafeSocialUrl("//evil.test/x")).toBe(false);
    expect(isSafeSocialUrl("facebook.com/lentera")).toBe(false);
  });

  test("refuses other schemes that would otherwise parse", () => {
    for (const url of ["ftp://h/x", "file:///etc/passwd", "mailto:a@b.test"]) {
      expect(isSafeSocialUrl(url)).toBe(false);
    }
  });
});

describe("validateSiteProfileInput — social links", () => {
  const LINK = { platform: "facebook", url: "https://facebook.com/lentera" };

  test("accepts a well-formed list", () => {
    const result = validateSiteProfileInput({ socialLinks: [LINK] });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.socialLinks).toEqual([LINK]);
  });

  test("an unsafe URL fails the whole save, naming its index", () => {
    const result = validateSiteProfileInput({
      socialLinks: [LINK, { platform: "x", url: "javascript:alert(1)" }]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toContain("socialLinks[1].url");
    }
  });

  test("a missing platform is refused", () => {
    const result = validateSiteProfileInput({
      socialLinks: [{ platform: "  ", url: "https://x.test" }]
    });

    expect(result.valid).toBe(false);
  });

  test("a duplicate platform is refused, case-insensitively", () => {
    // Two "facebook" rows have no sensible render, and silently keeping both
    // would put the choice in the template.
    const result = validateSiteProfileInput({
      socialLinks: [LINK, { ...LINK, platform: "Facebook" }]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.message.includes("more than once"))
      ).toBe(true);
    }
  });

  test("more entries than the cap is refused", () => {
    const many = Array.from(
      { length: SITE_PROFILE_LIMITS.socialLinks + 1 },
      (_, index) => ({ platform: `p${index}`, url: "https://x.test" })
    );

    expect(validateSiteProfileInput({ socialLinks: many }).valid).toBe(false);
  });

  test("a non-array is refused", () => {
    expect(
      validateSiteProfileInput({ socialLinks: { platform: "x" } }).valid
    ).toBe(false);
  });

  test("the platform label is NOT an enumeration", () => {
    // Deliberate: closing the set would mean a migration every time a newsroom
    // joins a new network, and nothing renders differently per value.
    const result = validateSiteProfileInput({
      socialLinks: [
        { platform: "some-network-nobody-has-heard-of", url: "https://x.test" }
      ]
    });

    expect(result.valid).toBe(true);
  });
});

describe("the limits match the migration", () => {
  test("every documented bound is a positive integer", () => {
    // These mirror the CHECK constraints in sql/135. A mismatch would let the
    // form accept what the database then rejects with a raw 500.
    for (const [name, value] of Object.entries(SITE_PROFILE_LIMITS)) {
      expect(Number.isInteger(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });
});
