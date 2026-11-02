/**
 * The public submission contract v1: a CLOSED field set, no HTML, no upload, no
 * URL fetch, no inferred identity (Issue #1153, ADR-0155 sections 2, 4, 5).
 */
import { describe, expect, test } from "bun:test";

import {
  MAX_MESSAGE_LENGTH,
  validateSubmissionRequest,
  type SubmissionRequest
} from "../src/modules/website-engagement/domain/submission-request";

const TOKEN = "wes1.x.y.z";

function contact(overrides: Record<string, unknown> = {}) {
  return {
    sourceToken: TOKEN,
    eventId: "evt-12345678",
    kind: "contact",
    contact: {
      name: "Budi Santoso",
      email: "Budi.Santoso@Example.com",
      message: "Saya ingin tahu harga paket."
    },
    consent: { purposes: ["respond_to_inquiry"], copyVersion: "v3" },
    ...overrides
  };
}

function valid(body: unknown): SubmissionRequest {
  const result = validateSubmissionRequest(body);

  if (!result.valid) {
    throw new Error(`expected valid: ${JSON.stringify(result.errors)}`);
  }

  return result.value;
}

function errors(body: unknown): { field: string; message: string }[] {
  const result = validateSubmissionRequest(body);

  if (result.valid) throw new Error("expected invalid");

  return result.errors;
}

describe("website_engagement submission request (contract v1)", () => {
  test("accepts a contact request and normalises the address with the identity module's rule", () => {
    const value = valid(contact());

    expect(value.kind).toBe("contact");
    expect(value.contact?.emailNormalized).toBe("budi.santoso@example.com");
    expect(value.contact?.email).toBe("Budi.Santoso@Example.com");
    expect(value.consent.purposes).toEqual(["respond_to_inquiry"]);
    expect(value.honeypotTripped).toBe(false);
  });

  test("a lead needs an email or a phone, a contact also needs a message", () => {
    expect(
      valid({
        ...contact({ kind: "lead" }),
        contact: { phone: "+62 812-3456-7890" }
      }).contact?.phoneNormalized
    ).toBe("+6281234567890");

    expect(
      errors({ ...contact({ kind: "lead" }), contact: { name: "x" } }).map(
        (e) => e.field
      )
    ).toContain("contact");
    expect(
      errors({
        ...contact(),
        contact: { email: "a@b.co" }
      }).map((e) => e.field)
    ).toContain("contact.message");
  });

  test("an interaction carries a closed type and nothing personal", () => {
    const value = valid({
      sourceToken: TOKEN,
      eventId: "evt-aaaaaaaa",
      kind: "interaction",
      interaction: { type: "cta_click" }
    });

    expect(value.interactionType).toBe("cta_click");
    expect(value.contact).toBeNull();

    expect(
      errors({
        sourceToken: TOKEN,
        eventId: "evt-aaaaaaaa",
        kind: "interaction",
        interaction: { type: "cta_click" },
        contact: { email: "a@b.co" }
      }).map((e) => e.field)
    ).toContain("contact");
    expect(
      errors({
        sourceToken: TOKEN,
        eventId: "evt-aaaaaaaa",
        kind: "interaction",
        interaction: { type: "cta_click" },
        consent: { purposes: ["respond_to_inquiry"], copyVersion: "v1" }
      }).map((e) => e.field)
    ).toContain("consent");
    expect(
      errors({
        sourceToken: TOKEN,
        eventId: "evt-aaaaaaaa",
        kind: "interaction",
        interaction: { type: "typed_a_password" }
      }).map((e) => e.field)
    ).toContain("interaction");
  });

  test("the field set is CLOSED and the offending key is never echoed", () => {
    for (const extra of [
      { isAdmin: true },
      { constructor: "x" },
      { fingerprint: "abc" },
      { ip: "1.2.3.4" },
      { userAgent: "curl" },
      { file: "data:text/html;base64,PHNjcmlwdD4=" }
    ]) {
      const found = errors({ ...contact(), ...extra });

      expect(found).toHaveLength(1);
      expect(found[0]!.field).toBe("body");
      expect(JSON.stringify(found)).not.toContain("isAdmin");
      expect(JSON.stringify(found)).not.toContain("fingerprint");
    }

    // A real JSON.parse'd `__proto__` own key is an unknown key like any other.
    const proto = JSON.parse(
      `{"sourceToken":"${TOKEN}","eventId":"evt-12345678","kind":"lead","__proto__":{"x":1}}`
    );

    expect(validateSubmissionRequest(proto).valid).toBe(false);
    expect(({} as Record<string, unknown>).x).toBeUndefined();

    // Nested objects are closed too.
    expect(
      errors(contact({ contact: { email: "a@b.co", message: "m", role: "x" } }))
        .length
    ).toBeGreaterThan(0);
    expect(
      errors(
        contact({ consent: { purposes: ["respond_to_inquiry"], extra: 1 } })
      ).length
    ).toBeGreaterThan(0);
    expect(
      errors(contact({ attribution: { fingerprint: "x" } })).length
    ).toBeGreaterThan(0);
  });

  test("malicious payload: markup, control characters and bidi overrides are refused as TEXT", () => {
    const hostile = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "</p><b>",
      "<!-- comment",
      "<?xml version='1.0'?>",
      "hello\u0000world",
      "hello\u0007world",
      "evil‮fdp.exe",
      "isolate⁦x"
    ];

    for (const message of hostile) {
      const found = errors(contact({ contact: { email: "a@b.co", message } }));

      expect(found.some((e) => e.field === "contact.message")).toBe(true);
    }

    // Text that merely LOOKS dangerous but is not markup is stored as text.
    const sqli = valid(
      contact({
        contact: {
          email: "a@b.co",
          message: "'; DROP TABLE awcms_tenants; -- and 5 < 10 and 10 > 5"
        }
      })
    );

    expect(sqli.contact?.message).toContain("DROP TABLE");
  });

  test("single-line fields refuse newlines, the message keeps them", () => {
    expect(
      errors(
        contact({ contact: { name: "a\nb", email: "a@b.co", message: "m" } })
      ).some((e) => e.field === "contact.name")
    ).toBe(true);
    expect(
      valid(contact({ contact: { email: "a@b.co", message: "line1\nline2" } }))
        .contact?.message
    ).toBe("line1\nline2");
  });

  test("length bounds hold: an anonymous endpoint is not a storage primitive", () => {
    expect(
      errors(
        contact({
          contact: {
            email: "a@b.co",
            message: "x".repeat(MAX_MESSAGE_LENGTH + 1)
          }
        })
      ).some((e) => e.field === "contact.message")
    ).toBe(true);
    expect(
      errors(
        contact({ contact: { email: `${"a".repeat(250)}@b.co`, message: "m" } })
      ).some((e) => e.field === "contact.email")
    ).toBe(true);
    expect(errors(contact({ sourceToken: undefined })).length).toBeGreaterThan(
      0
    );
  });

  test("eventId, locale, topic and consent labels are pattern-checked", () => {
    for (const bad of [
      "short",
      "has space 12345",
      "x".repeat(65),
      "é".repeat(10)
    ]) {
      expect(
        errors(contact({ eventId: bad })).some((e) => e.field === "eventId")
      ).toBe(true);
    }

    expect(
      errors(contact({ locale: "english" })).some((e) => e.field === "locale")
    ).toBe(true);
    expect(valid(contact({ locale: "id" })).locale).toBe("id");
    expect(valid(contact({ locale: "id-ID" })).locale).toBe("id-ID");
    expect(
      errors(contact({ topic: "Has Space" })).some((e) => e.field === "topic")
    ).toBe(true);
    expect(
      errors(
        contact({
          consent: { purposes: ["respond_to_inquiry"], copyVersion: "v 1!" }
        })
      ).some((e) => e.field === "consent.copyVersion")
    ).toBe(true);
    expect(
      errors(
        contact({
          consent: { purposes: ["sell_your_data"], copyVersion: "v1" }
        })
      ).some((e) => e.field === "consent.purposes")
    ).toBe(true);
  });

  test("marketing consent is its own purpose and is never inferred from the inquiry", () => {
    const inquiryOnly = valid(contact());
    const both = valid(
      contact({
        consent: {
          purposes: [
            "respond_to_inquiry",
            "marketing_follow_up",
            "marketing_follow_up"
          ],
          copyVersion: "v3",
          pagePath: "/kontak"
        }
      })
    );

    expect(inquiryOnly.consent.purposes).not.toContain("marketing_follow_up");
    expect(both.consent.purposes).toEqual([
      "respond_to_inquiry",
      "marketing_follow_up"
    ]);
    expect(both.consent.pagePath).toBe("/kontak");
  });

  test("attribution is a path and a hostname: no query, no URL, no scheme, no fetch", () => {
    const value = valid(
      contact({
        attribution: {
          landingPath: "/produk/paket-a",
          referrerHost: "Google.COM",
          utmSource: "newsletter",
          utmCampaign: "ramadan-2026"
        }
      })
    );

    expect(value.attribution.referrerHost).toBe("google.com");
    expect(value.attribution.landingPath).toBe("/produk/paket-a");

    for (const landingPath of [
      "/a?utm=1",
      "/a#frag",
      "//evil.example/x",
      "https://evil.example/x",
      "javascript:alert(1)",
      "/a b",
      "no-leading-slash",
      "/\\evil"
    ]) {
      expect(
        errors(contact({ attribution: { landingPath } })).some(
          (e) => e.field === "attribution.landingPath"
        )
      ).toBe(true);
    }

    for (const referrerHost of [
      "http://evil.example",
      "evil.example/path",
      "169.254.169.254:80",
      "a b",
      "-bad.example",
      ""
    ]) {
      expect(
        errors(contact({ attribution: { referrerHost } })).some(
          (e) => e.field === "attribution.referrerHost"
        )
      ).toBe(true);
    }
  });

  test("occurredAt is recent: no replay of an old event and no future one", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const recent = validateSubmissionRequest(
      contact({ occurredAt: "2026-11-02T11:59:00Z" }),
      now
    );

    expect(recent.valid).toBe(true);

    for (const occurredAt of [
      "2026-10-01T00:00:00Z",
      "2027-01-01T00:00:00Z",
      "not a date",
      12345
    ]) {
      expect(
        validateSubmissionRequest(contact({ occurredAt }), now).valid
      ).toBe(false);
    }
  });

  test("the honeypot, the fill time and the redundant ids are carried, never trusted", () => {
    expect(
      valid(contact({ honeypot: "http://spam.example" })).honeypotTripped
    ).toBe(true);
    expect(valid(contact({ honeypot: "   " })).honeypotTripped).toBe(false);
    expect(valid(contact({ fillMs: 120 })).fillMs).toBe(120);
    expect(
      errors(contact({ fillMs: -1 })).some((e) => e.field === "fillMs")
    ).toBe(true);

    const claimed = valid(
      contact({
        tenantId: "99999999-9999-4999-8999-999999999999",
        sourceId: "88888888-8888-4888-8888-888888888888"
      })
    );

    expect(claimed.claimedTenantId).toBe(
      "99999999-9999-4999-8999-999999999999"
    );
    expect(claimed.claimedSourceId).toBe(
      "88888888-8888-4888-8888-888888888888"
    );
    expect(
      errors(contact({ tenantId: "not-a-uuid" })).some(
        (e) => e.field === "tenantId"
      )
    ).toBe(true);
  });

  test("a body that is not an object is a shape error, not a throw", () => {
    for (const body of [null, undefined, 1, "x", [], true]) {
      const result = validateSubmissionRequest(body);

      expect(result.valid).toBe(false);
    }
  });
});
