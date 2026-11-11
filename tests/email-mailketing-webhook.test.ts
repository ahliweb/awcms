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
  reportedDay,
  summarizeClickedLink
} from "../src/modules/email/domain/mailketing-webhook";
import {
  bounceMeetsSuppressionThreshold,
  projectProviderReportedStatus,
  resolveSoftBounceThreshold,
  suppressionBlocksPurpose
} from "../src/modules/email/domain/suppression-policy";
import {
  EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE,
  isEmailWebhookEnabled,
  resolveEmailWebhookMaxPending,
  resolveEmailWebhookRatePerMinute
} from "../src/modules/email/domain/email-webhook-config";
import { isRequestReservedEmailCategory } from "../src/modules/email/domain/email-sender";
import {
  assertSecurityMailPermitted,
  SECURITY_MAIL_GRANT,
  SecurityMailNotPermittedError
} from "../src/modules/email/application/security-mail-grant";
import { handleMailketingWebhook } from "../src/modules/email/application/mailketing-webhook-handler";
import { personOnlyRefusal } from "../src/modules/email/application/webhook-route-support";
import { resetRateLimitForTests } from "../src/lib/security/rate-limit";

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

  test("reported time is parsed strictly: two grammars, everything else is stale", () => {
    const now = new Date("2026-11-11T00:00:00Z");

    // The vendor's documented zone-less form, read as UTC.
    expect(
      parseReportedAt("2026-11-10 10:00:00", now).value?.toISOString()
    ).toBe("2026-11-10T10:00:00.000Z");
    // ISO-8601 with an explicit zone.
    expect(
      parseReportedAt("2026-11-10T17:00:00+07:00", now).value?.toISOString()
    ).toBe("2026-11-10T10:00:00.000Z");
    // A WIB value read as UTC lands hours "ahead": still inside the skew.
    expect(parseReportedAt("2026-11-11 06:00:00", now).outOfWindow).toBe(false);

    for (const stale of [
      null,
      "yesterday",
      "2026/11/10 10:00:00",
      "2026-11-10",
      "2026-11-10 10:00",
      "2026-11-10T10:00:00",
      "Tue, 10 Nov 2026 10:00:00 GMT",
      "2026-02-31 10:00:00",
      "2026-11-10 25:00:00",
      "2026-09-01 10:00:00",
      "2026-11-12 10:00:00",
      "2026-11-11T00:10:00Z"
    ]) {
      expect(parseReportedAt(stale, now)).toEqual({
        value: null,
        outOfWindow: true
      });
    }

    expect(reportedDay(new Date("2026-11-10T23:59:59Z"))).toBe("2026-11-10");
  });

  test("the dedupe key ignores the provider timestamp: per message, or per recipient and day", () => {
    const message = {
      espAccountId: SUB,
      type: "bounce" as const,
      emailMessageId: "m1"
    };
    const key = providerEventDedupeKey(message);

    expect(providerEventDedupeKey({ ...message })).toBe(key);

    for (const change of [
      { espAccountId: TENANT },
      { type: "open" as const },
      { emailMessageId: "m2" }
    ]) {
      expect(providerEventDedupeKey({ ...message, ...change })).not.toBe(key);
    }

    const recipient = {
      espAccountId: SUB,
      type: "unsubscribe" as const,
      recipientHash: "h",
      reportedDay: "2026-11-10"
    };
    const rkey = providerEventDedupeKey(recipient);

    for (const change of [
      { recipientHash: "h2" },
      { reportedDay: "2026-11-11" },
      { type: "click" as const }
    ]) {
      expect(providerEventDedupeKey({ ...recipient, ...change })).not.toBe(
        rkey
      );
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
    expect(resolveEmailWebhookMaxPending({})).toBe(5000);
    expect(
      resolveEmailWebhookMaxPending({ EMAIL_WEBHOOK_MAX_PENDING: "50" })
    ).toBe(5000);
    expect(
      resolveEmailWebhookMaxPending({ EMAIL_WEBHOOK_MAX_PENDING: "200" })
    ).toBe(200);
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

  const handlerDeps = () => {
    let sqlCalls = 0;
    let directoryCalls = 0;

    return {
      deps: {
        env: { EMAIL_WEBHOOK_ENABLED: "true" } as NodeJS.ProcessEnv,
        getSql: () => {
          sqlCalls += 1;
          throw new Error("no database in this unit test");
        },
        loadDirectory: async () => {
          directoryCalls += 1;
          return null;
        }
      },
      sqlCalls: () => sqlCalls,
      directoryCalls: () => directoryCalls
    };
  };
  const post = (token: string, body = "{}") =>
    new Request(`https://x.example/api/v1/email/webhooks/mailketing/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });

  test("off is a 404 that reads nothing", async () => {
    resetRateLimitForTests();
    const h = handlerDeps();
    const response = await handleMailketingWebhook(
      post("garbage"),
      "garbage",
      "198.51.100.1",
      { ...h.deps, env: {} }
    );

    expect(response.status).toBe(404);
    expect(h.sqlCalls() + h.directoryCalls()).toBe(0);
  });

  test("failed proofs from one address are throttled BEFORE any database work; another address is not", async () => {
    resetRateLimitForTests();
    const h = handlerDeps();
    const statuses: number[] = [];

    for (let i = 0; i <= EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE; i += 1) {
      statuses.push(
        (
          await handleMailketingWebhook(
            post("garbage"),
            "garbage",
            "198.51.100.7",
            h.deps
          )
        ).status
      );
    }

    expect(statuses.slice(0, EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE)).toEqual(
      Array(EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE).fill(401)
    );
    expect(statuses.at(-1)).toBe(429);
    expect(h.sqlCalls() + h.directoryCalls()).toBe(0);

    const elsewhere = await handleMailketingWebhook(
      post("garbage"),
      "garbage",
      "198.51.100.8",
      h.deps
    );

    expect(elsewhere.status).toBe(401);
  });

  test("an oversized body is refused before any database work", async () => {
    resetRateLimitForTests();
    const h = handlerDeps();
    const token = formatCallbackToken(TENANT, SUB, generateCallbackSecret());
    const response = await handleMailketingWebhook(
      post(token, "x".repeat(40 * 1024)),
      token,
      "198.51.100.9",
      h.deps
    );

    expect(response.status).toBe(413);
    expect(h.sqlCalls() + h.directoryCalls()).toBe(0);
  });
});

describe("security mail is sent only by internal ports (audit H-1)", () => {
  test("request-facing routes may not name a security category", () => {
    for (const category of [
      "auth.password_reset",
      "auth.invitation",
      "system.security_notice"
    ]) {
      expect(isRequestReservedEmailCategory(category)).toBe(true);
    }

    for (const category of ["system.announcement", "workflow.task_assigned"]) {
      expect(isRequestReservedEmailCategory(category)).toBe(false);
    }
  });

  test("enqueue refuses security mail without the grant", () => {
    expect(() => assertSecurityMailPermitted("security", undefined)).toThrow(
      SecurityMailNotPermittedError
    );
    expect(() =>
      assertSecurityMailPermitted("security", SECURITY_MAIL_GRANT)
    ).not.toThrow();
    expect(() =>
      assertSecurityMailPermitted("transactional", undefined)
    ).not.toThrow();
  });

  test("only the internal security port holds the grant", () => {
    const holders = [...new Bun.Glob("src/**/*.{ts,astro}").scanSync(".")]
      .filter((file: string) =>
        readFileSync(file, "utf8").includes("SECURITY_MAIL_GRANT")
      )
      .sort();

    expect(holders).toEqual([
      "src/modules/email/application/auth-notification-port-adapter.ts",
      "src/modules/email/application/security-mail-grant.ts"
    ]);
  });

  test("M-4 (M9): every high-risk webhook admin route refuses a machine credential", async () => {
    // A machine credential cannot hold `approve` or `configure` at all (its
    // write ceiling is create/update), so this guard is defence in depth that
    // no route-level fixture can reach; it is pinned here instead.
    const refusal = personOnlyRefusal({
      context: { viaMachineCredential: true }
    });

    expect(refusal?.status).toBe(403);
    expect(
      ((await refusal!.json()) as { error: { code: string } }).error.code
    ).toBe("INTERACTIVE_SESSION_REQUIRED");
    expect(personOnlyRefusal({ context: {} })).toBeNull();

    for (const route of [
      "src/pages/api/v1/email/provider-events/[id]/review.ts",
      "src/pages/api/v1/email/webhook-callbacks/index.ts",
      "src/pages/api/v1/email/webhook-callbacks/[id]/revoke.ts"
    ]) {
      const source = readFileSync(route, "utf8");

      expect(source).toContain(
        "const refused = personOnlyRefusal(context.auth);"
      );
      expect(source).toContain("if (refused) return refused;");
    }
  });

  test("both announcement routes refuse reserved categories before doing anything else with them", () => {
    for (const route of [
      "src/pages/api/v1/email/announcements/index.ts",
      "src/pages/api/v1/email/announcements/preview.ts"
    ]) {
      const source = readFileSync(route, "utf8");

      expect(source).toContain(
        "isRequestReservedEmailCategory(input.templateKey)"
      );
      expect(source).toContain("TEMPLATE_CATEGORY_RESERVED_CODE");
    }
  });
});
