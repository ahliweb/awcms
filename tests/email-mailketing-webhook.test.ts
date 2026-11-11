/**
 * Mailketing webhook: the pure parts (Issue #1161, ADR-0151 section 5).
 * The database and route behaviour is in
 * `tests/integration/email-webhook.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { requiresAuthenticatedCallerBeforeBody } from "../src/lib/security/api-body-auth-boundary";
import {
  callbackHashesEqual,
  classifyBounceReason,
  formatCallbackToken,
  generateCallbackSecret,
  hashCallbackSecret,
  MAX_EVENTS_PER_REQUEST,
  parseCallbackToken,
  parseMailketingEvent,
  parseMailketingWebhookBody,
  parseReportedAt,
  providerEventDedupeKey,
  summarizeClickedLink
} from "../src/modules/email/domain/mailketing-webhook";
import {
  bounceMeetsSuppressionThreshold,
  projectProviderReportedStatus,
  resolveSoftBounceThreshold,
  suppressionBlocksPurpose
} from "../src/modules/email/domain/suppression-policy";
import {
  isEmailWebhookEnabled,
  resolveEmailWebhookRatePerMinute
} from "../src/modules/email/domain/email-webhook-config";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";

describe("callback token", () => {
  test("round-trips and refuses everything else", () => {
    const secret = generateCallbackSecret();
    const token = formatCallbackToken(TENANT, SUB, secret);

    expect(parseCallbackToken(token)).toEqual({
      tenantId: TENANT,
      subscriptionId: SUB,
      secret
    });

    for (const bad of [
      "",
      null,
      42,
      `mkw2.${TENANT}.${SUB}.${secret}`,
      `mkw1.${TENANT}.${SUB}`,
      `mkw1.${TENANT}.${SUB}.${secret}.x`,
      `mkw1.not-a-uuid.${SUB}.${secret}`,
      `mkw1.${TENANT}.${SUB}.${secret.slice(1)}`,
      `mkw1.${TENANT}.${SUB}.${"a".repeat(200)}`
    ]) {
      expect(parseCallbackToken(bad)).toBeNull();
    }
  });

  test("the stored hash is bound to tenant and subscription and compared in full", () => {
    const secret = generateCallbackSecret();
    const stored = hashCallbackSecret(TENANT, SUB, secret);

    expect(stored).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stored).not.toContain(secret);
    expect(
      callbackHashesEqual(stored, hashCallbackSecret(TENANT, SUB, secret))
    ).toBe(true);
    expect(
      callbackHashesEqual(
        stored,
        hashCallbackSecret("33333333-3333-4333-8333-333333333333", SUB, secret)
      )
    ).toBe(false);
    expect(callbackHashesEqual(stored, "sha256:short")).toBe(false);
  });
});

describe("payload parsing (vendor-documented shapes)", () => {
  test("bounce keeps a class and a code, never the reason text", () => {
    const parsed = parseMailketingEvent({
      type: "bounce",
      email: " Reader@Example.com ",
      reason: "550 5.1.1 <reader@example.com>: user unknown",
      date: "2026-11-10 10:00:00",
      message_id: "abc-123"
    });

    expect(parsed).toEqual({
      ok: true,
      event: {
        type: "bounce",
        providerMessageId: "abc-123",
        recipient: "Reader@Example.com",
        bounceClass: "hard",
        statusCode: "5.1.1",
        reportedAtRaw: "2026-11-10 10:00:00"
      }
    });
    expect(JSON.stringify(parsed)).not.toContain("user unknown");
  });

  test("classification: enhanced code, then reply code, then phrases, else unknown", () => {
    expect(classifyBounceReason("452 4.2.2 mailbox full").bounceClass).toBe(
      "soft"
    );
    expect(classifyBounceReason("550 rejected").bounceClass).toBe("hard");
    expect(classifyBounceReason("421 try later").bounceClass).toBe("soft");
    expect(classifyBounceReason("No such user here").bounceClass).toBe("hard");
    expect(classifyBounceReason("something odd").bounceClass).toBe("unknown");
    expect(classifyBounceReason(undefined).bounceClass).toBe("unknown");
  });

  test("delivered uses jobid/rcpt; open needs a message id; click has none", () => {
    expect(
      parseMailketingEvent({
        type: "delivered",
        rcpt: "a@b.example",
        jobid: 991,
        send_time: "2026-11-10 10:00:00"
      })
    ).toMatchObject({
      ok: true,
      event: { type: "delivered", providerMessageId: "991" }
    });
    expect(
      parseMailketingEvent({ type: "emailopen", email: "a@b.example" })
    ).toEqual({ ok: false, reason: "invalid_event" });

    const click = parseMailketingEvent({
      type: "emailclick",
      email: "a@b.example",
      link_clicked: "https://Shop.Example/path?u=a@b.example",
      date: "2026-11-10"
    });

    expect(click).toMatchObject({
      ok: true,
      event: { type: "click", linkHost: "shop.example" }
    });
    expect(JSON.stringify(click)).not.toContain("/path");
  });

  test("links that are not http(s) are refused; nothing is fetched", () => {
    expect(summarizeClickedLink("javascript:alert(1)")).toBeNull();
    expect(summarizeClickedLink("file:///etc/passwd")).toBeNull();
    expect(summarizeClickedLink("not a url")).toBeNull();
    expect(
      summarizeClickedLink(`https://x.example/${"a".repeat(3000)}`)
    ).toBeNull();
  });

  test("newsubscriber is ignored outright; unknown types too", () => {
    expect(
      parseMailketingEvent({
        type: "newsubscriber",
        email: "a@b.example",
        first_name: "A",
        mobile: "0812"
      })
    ).toEqual({ ok: false, reason: "newsubscriber_ignored" });
    expect(parseMailketingEvent({ type: "spam" })).toEqual({
      ok: false,
      reason: "unknown_type"
    });
  });

  test("a body is one object or a bounded non-empty array", () => {
    expect(parseMailketingWebhookBody({ type: "x" })).toHaveLength(1);
    expect(parseMailketingWebhookBody([])).toBeNull();
    expect(
      parseMailketingWebhookBody(
        Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => ({}))
      )
    ).toBeNull();
    expect(parseMailketingWebhookBody("text")).toBeNull();
    expect(parseMailketingWebhookBody(null)).toBeNull();
  });

  test("reported time: zone-less is UTC, stale and future are out of window, unreadable is unknown", () => {
    const now = new Date("2026-11-11T00:00:00Z");

    expect(
      parseReportedAt("2026-11-10 10:00:00", now).value?.toISOString()
    ).toBe("2026-11-10T10:00:00.000Z");
    expect(parseReportedAt("2026-09-01 10:00:00", now).outOfWindow).toBe(true);
    expect(parseReportedAt("2026-11-12 10:00:00", now).outOfWindow).toBe(true);
    expect(parseReportedAt("yesterday", now)).toEqual({
      value: null,
      outOfWindow: false
    });
  });

  test("the dedupe key changes with every named part and nothing else", () => {
    const base = {
      espAccountId: SUB,
      type: "bounce" as const,
      providerMessageId: "m1",
      recipientHash: "h",
      reportedAtRaw: "d"
    };
    const key = providerEventDedupeKey(base);

    expect(providerEventDedupeKey({ ...base })).toBe(key);

    for (const change of [
      { espAccountId: TENANT },
      { type: "open" as const },
      { providerMessageId: "m2" },
      { recipientHash: "h2" },
      { reportedAtRaw: "e" }
    ]) {
      expect(providerEventDedupeKey({ ...base, ...change })).not.toBe(key);
    }
  });
});

describe("suppression precedence (ADR-0151 section 4)", () => {
  test("security mail is blocked only by an operator's hard suppression", () => {
    const cases: [string, string, boolean, boolean][] = [
      // reason, source, blocks transactional, blocks security
      ["manual", "operator", true, true],
      ["bounced", "operator", true, true],
      ["complained", "operator", true, true],
      ["unsubscribed", "operator", true, false],
      ["bounced", "provider_report", true, false],
      ["unsubscribed", "provider_report", true, false]
    ];

    for (const [reason, source, transactional, security] of cases) {
      const entry = { reason, source } as Parameters<
        typeof suppressionBlocksPurpose
      >[0];

      expect(suppressionBlocksPurpose(entry, "transactional")).toBe(
        transactional
      );
      expect(suppressionBlocksPurpose(entry, "security")).toBe(security);
    }

    expect(suppressionBlocksPurpose(undefined, "transactional")).toBe(false);
  });

  test("soft bounces need the threshold; a hard bounce does not", () => {
    expect(bounceMeetsSuppressionThreshold("hard", 0, 3)).toBe(true);
    expect(bounceMeetsSuppressionThreshold("soft", 2, 3)).toBe(false);
    expect(bounceMeetsSuppressionThreshold("unknown", 3, 3)).toBe(true);
    expect(resolveSoftBounceThreshold({})).toBe(3);
    expect(
      resolveSoftBounceThreshold({ EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD: "1" })
    ).toBe(3);
    expect(
      resolveSoftBounceThreshold({ EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD: "5" })
    ).toBe(5);
  });

  test("the projection only moves forward, whatever the arrival order", () => {
    expect(projectProviderReportedStatus("sent", [])).toBe("accepted");
    expect(projectProviderReportedStatus("failed", [])).toBeNull();
    expect(projectProviderReportedStatus("sent", ["bounce", "delivered"])).toBe(
      "bounced"
    );
    expect(projectProviderReportedStatus("sent", ["delivered", "bounce"])).toBe(
      "bounced"
    );
    expect(
      projectProviderReportedStatus("sent", ["open", "click", "unsubscribe"])
    ).toBe("accepted");
  });
});

describe("switches and the session boundary", () => {
  test("off unless exactly true; rate bounded", () => {
    expect(isEmailWebhookEnabled({})).toBe(false);
    expect(isEmailWebhookEnabled({ EMAIL_WEBHOOK_ENABLED: "1" })).toBe(false);
    expect(isEmailWebhookEnabled({ EMAIL_WEBHOOK_ENABLED: "true" })).toBe(true);
    expect(resolveEmailWebhookRatePerMinute({})).toBe(120);
    expect(
      resolveEmailWebhookRatePerMinute({ EMAIL_WEBHOOK_RATE_PER_MINUTE: "5" })
    ).toBe(120);
  });

  test("only the callback path is session-free; its neighbours are not", () => {
    expect(
      requiresAuthenticatedCallerBeforeBody(
        "POST",
        "/api/v1/email/webhooks/mailketing/mkw1.x"
      )
    ).toBe(false);

    for (const path of [
      "/api/v1/email/webhooks/mailketing",
      "/api/v1/email/webhooks/mailketing/a/b",
      "/api/v1/email/webhook-callbacks",
      "/api/v1/email/provider-events/x/review",
      "/api/v1/email/suppressions"
    ]) {
      expect(requiresAuthenticatedCallerBeforeBody("POST", path)).toBe(true);
    }

    expect(
      requiresAuthenticatedCallerBeforeBody(
        "PUT",
        "/api/v1/email/webhooks/mailketing/mkw1.x"
      )
    ).toBe(true);
  });

  test("the route does no database work before the address bucket, the token shape and the size cap", () => {
    const source = readFileSync(
      "src/pages/api/v1/email/webhooks/mailketing/[token].ts",
      "utf8"
    );
    const order = [
      "isEmailWebhookEnabled()",
      "email-webhook-ip:",
      "parseCallbackToken(",
      "readCappedText(",
      "verifyMailketingCallback(",
      "email-webhook-callback:",
      "recordMailketingEvents("
    ].map((needle) => source.indexOf(needle));

    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
