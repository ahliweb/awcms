/**
 * Pure rules of `telegram_engagement` (Issue #1156, ADR-0152): the update
 * classifier (T-W3), the callback token and derived secrets (TG3), redaction
 * (TG11), request validation (T-N2), eligibility (TG6/TG7) and the event
 * payloads (ADR-0150 N4: no identity, no content, no secret).
 */
import { describe, expect, test } from "bun:test";

import { validateDomainEventPayload } from "../src/modules/domain-event-runtime/domain/envelope";
import {
  TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE as REGISTRY_CONSENT,
  TELEGRAM_ENGAGEMENT_EVENT_VERSION as REGISTRY_VERSION,
  TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE as REGISTRY_INTERACTION
} from "../src/modules/domain-event-runtime/domain/event-type-registry";
import { evaluateEligibility } from "../src/modules/telegram-engagement/domain/eligibility";
import { staffBotIdFromEnvironment } from "../src/modules/telegram-engagement/domain/staff-bot-identity";
import { resolveWebhookOrigin } from "../src/modules/telegram-engagement/domain/telegram-engagement-config";
import {
  TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE,
  TELEGRAM_ENGAGEMENT_EVENT_VERSION,
  TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE
} from "../src/modules/telegram-engagement/domain/telegram-engagement-constants";
import {
  buildConsentChangedPayload,
  buildInteractionReceivedPayload
} from "../src/modules/telegram-engagement/domain/telegram-engagement-events";
import {
  botIdOfToken,
  containsSecretShape,
  redactProviderText
} from "../src/modules/telegram-engagement/domain/telegram-engagement-redaction";
import {
  validateConsentPrompt,
  validateListContactsQuery,
  validateRegisterBot,
  validateSendMessage
} from "../src/modules/telegram-engagement/domain/telegram-engagement-validation";
import {
  consentCallbackData,
  parseTelegramUpdate
} from "../src/modules/telegram-engagement/domain/update-parser";
import {
  constantTimeEquals,
  deriveHeaderSecret,
  derivePathSecret,
  formatCallbackToken,
  generateWebhookSeed,
  hashPathSecret,
  parseCallbackToken,
  SECRET_TOKEN_PATTERN
} from "../src/modules/telegram-engagement/domain/webhook-secrets";
import { parseBotApiResponseForTests } from "../src/modules/telegram-engagement/infrastructure/bot-api-client";
import { changesConsent } from "../src/modules/telegram-engagement/application/webhook-handler";

describe("updates the per-chat bucket may never drop (audit M-2 of PR #1260)", () => {
  test("/start, /stop, a block and a consent button change consent; chatter does not", () => {
    const chat = { id: 9, type: "private" };
    const from = { id: 9, is_bot: false };
    const msg = (text: string) => ({
      update_id: 1,
      message: { message_id: 1, date: 1, chat, from, text }
    });

    expect(changesConsent(msg("/start"))).toBe(true);
    expect(changesConsent(msg("/stop"))).toBe(true);
    expect(
      changesConsent({
        update_id: 2,
        my_chat_member: { chat, from, new_chat_member: { status: "kicked" } }
      })
    ).toBe(true);
    expect(
      changesConsent({
        update_id: 3,
        callback_query: {
          id: "q",
          from,
          message: { message_id: 4, chat },
          data: "tgw1:marketing:v1"
        }
      })
    ).toBe(true);
    expect(changesConsent(msg("hello"))).toBe(false);
    expect(changesConsent({ update_id: 5 })).toBe(false);
  });
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const ENDPOINT = "22222222-2222-4222-8222-222222222222";
const TOKEN = "123456789:AAHcanaryTokenSecretPart_0123456789abc";

const message = (extra: Record<string, unknown> = {}, text = "hello") => ({
  update_id: 10,
  message: {
    message_id: 1,
    date: 1_700_000_000,
    chat: { id: 555, type: "private" },
    from: { id: 555, is_bot: false },
    text,
    ...extra
  }
});

describe("update classification (T-W3)", () => {
  test("/start with a deep-link parameter is a start; the parameter is provenance", () => {
    const parsed = parseTelegramUpdate(message({}, "/start promo_2026"));

    expect(parsed).toMatchObject({
      kind: "start",
      userId: "555",
      startParam: "promo_2026"
    });
  });

  test("/start@Bot and /stop are recognised; an unsafe parameter is dropped", () => {
    expect(parseTelegramUpdate(message({}, "/start@ShopBot")).kind).toBe(
      "start"
    );
    expect(parseTelegramUpdate(message({}, "/stop")).kind).toBe("stop");
    expect(parseTelegramUpdate(message({}, "/start <script>"))).toMatchObject({
      kind: "start",
      startParam: null
    });
  });

  test("a forwarded /start is just a message, never a command", () => {
    const parsed = parseTelegramUpdate(
      message({ forward_origin: { type: "user" } }, "/start")
    );

    expect(parsed).toMatchObject({ kind: "message", forwarded: true });
  });

  test("groups, channels, bot senders and an id mismatch are ignored", () => {
    expect(
      parseTelegramUpdate(message({ chat: { id: -1001, type: "supergroup" } }))
    ).toMatchObject({ kind: "ignored", reason: "not_private" });
    expect(
      parseTelegramUpdate(message({ from: { id: 555, is_bot: true } }))
    ).toMatchObject({ kind: "ignored", reason: "bot_sender" });
    expect(
      parseTelegramUpdate(message({ from: { id: 556, is_bot: false } }))
    ).toMatchObject({ kind: "ignored", reason: "identity_mismatch" });
    expect(
      parseTelegramUpdate({ update_id: 3, channel_post: {} })
    ).toMatchObject({ kind: "ignored" });
    expect(
      parseTelegramUpdate({ update_id: 4, edited_message: message().message })
    ).toMatchObject({ kind: "ignored" });
  });

  test("an update without a valid update_id is invalid", () => {
    expect(parseTelegramUpdate({})).toEqual({ kind: "invalid" });
    expect(parseTelegramUpdate({ update_id: -1 })).toEqual({ kind: "invalid" });
    expect(parseTelegramUpdate({ update_id: "7" })).toEqual({
      kind: "invalid"
    });
    expect(parseTelegramUpdate(null)).toEqual({ kind: "invalid" });
  });

  test("a block is a membership change; content is described by kind only", () => {
    expect(
      parseTelegramUpdate({
        update_id: 5,
        my_chat_member: {
          chat: { id: 555, type: "private" },
          from: { id: 555, is_bot: false },
          new_chat_member: { status: "kicked" }
        }
      })
    ).toMatchObject({ kind: "membership", change: "blocked" });

    const photo = parseTelegramUpdate(
      message({ photo: [{}], text: undefined })
    );

    expect(photo).toMatchObject({ kind: "message", contentKinds: ["media"] });
    expect(JSON.stringify(photo)).not.toContain("hello");
  });

  test("consent buttons parse only our own data shapes", () => {
    const button = (data: string) =>
      parseTelegramUpdate({
        update_id: 6,
        callback_query: {
          id: "x",
          from: { id: 555, is_bot: false },
          message: { message_id: 9, chat: { id: 555, type: "private" } },
          data
        }
      });

    expect(button(consentCallbackData("marketing", "v1", true))).toMatchObject({
      kind: "consent_button",
      purpose: "marketing",
      noticeVersion: "v1",
      accept: true,
      messageId: 9
    });
    expect(button("tgc1:support:v1")).toMatchObject({ kind: "ignored" });
    expect(button("tgc1:marketing:../x")).toMatchObject({ kind: "ignored" });
    expect(button("anything")).toMatchObject({ kind: "ignored" });
  });
});

describe("callback token and derived secrets (TG3)", () => {
  test("round-trips, and the two derived values are independent", () => {
    const seed = generateWebhookSeed();
    const path = derivePathSecret(seed);
    const header = deriveHeaderSecret(seed);
    const token = formatCallbackToken(TENANT, ENDPOINT, path);

    expect(parseCallbackToken(token)).toEqual({
      tenantId: TENANT,
      endpointId: ENDPOINT,
      pathSecret: path
    });
    expect(path).not.toBe(header);
    expect(header).toMatch(SECRET_TOKEN_PATTERN);
    expect(hashPathSecret(path)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(derivePathSecret(generateWebhookSeed())).not.toBe(path);
  });

  test("anything not exactly the shape is refused", () => {
    for (const raw of [
      undefined,
      "",
      "tge1",
      `tge2.${TENANT}.${ENDPOINT}.${"a".repeat(43)}`,
      `tge1.${TENANT}.${ENDPOINT}.${"a".repeat(42)}`,
      `tge1.not-a-uuid.${ENDPOINT}.${"a".repeat(43)}`,
      `tge1.${TENANT}.${ENDPOINT}.${"a".repeat(43)}.extra`,
      "x".repeat(500)
    ]) {
      expect(parseCallbackToken(raw)).toBeNull();
    }
  });

  test("constant-time equality never matches a missing or empty value", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abd", "abc")).toBe(false);
    expect(constantTimeEquals(null, "abc")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(false);
  });
});

describe("redaction (TG11)", () => {
  test("tokens, callback tokens and ids are stripped from provider text", () => {
    const callback = formatCallbackToken(TENANT, ENDPOINT, "a".repeat(43));
    const text = `failed https://api.telegram.org/bot${TOKEN}/sendMessage chat 987654321 ${callback}`;
    const redacted = redactProviderText(text, TOKEN);

    expect(containsSecretShape(redacted)).toBe(false);
    expect(redacted).not.toContain("987654321");
    expect(redacted).not.toContain(TOKEN.split(":")[1]!);
  });

  test("a provider error carries a redacted description and the retry_after", () => {
    const parsed = parseBotApiResponseForTests(
      429,
      JSON.stringify({
        ok: false,
        error_code: 429,
        description: `Too Many Requests ${TOKEN}`,
        parameters: { retry_after: 12 }
      }),
      TOKEN
    );

    expect(parsed).toMatchObject({
      kind: "error",
      errorCode: 429,
      retryAfterSeconds: 12
    });
    expect(JSON.stringify(parsed)).not.toContain(TOKEN.split(":")[1]!);
  });

  test("the bot id comes from the token prefix only", () => {
    expect(botIdOfToken(TOKEN)).toBe("123456789");
    expect(botIdOfToken("not-a-token")).toBeNull();
    expect(
      staffBotIdFromEnvironment({
        TELEGRAM_BOT_TOKEN: TOKEN
      } as NodeJS.ProcessEnv)
    ).toBe("123456789");
    expect(staffBotIdFromEnvironment({} as NodeJS.ProcessEnv)).toBeNull();
  });

  test("the webhook origin is APP_URL as https only, never a fallback", () => {
    expect(
      resolveWebhookOrigin({
        APP_URL: "https://shop.example/x"
      } as NodeJS.ProcessEnv)
    ).toBe("https://shop.example");
    expect(
      resolveWebhookOrigin({
        APP_URL: "http://shop.example"
      } as NodeJS.ProcessEnv)
    ).toBeNull();
    expect(resolveWebhookOrigin({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("request validation (T-N2)", () => {
  test("an addressee other than a contact cannot even be expressed", () => {
    for (const extra of [
      { chatId: 1 },
      { username: "@x" },
      { phone: "+62" },
      { tenantId: TENANT }
    ]) {
      expect(
        validateSendMessage({ purpose: "support", text: "hi", ...extra }).valid
      ).toBe(false);
    }

    expect(validateSendMessage({ purpose: "support", text: "hi" }).valid).toBe(
      true
    );
    expect(
      validateSendMessage({ purpose: "staff_ops", text: "hi" }).valid
    ).toBe(false);
    expect(
      validateSendMessage({ purpose: "support", text: "a\u0007b" }).valid
    ).toBe(false);
  });

  test("prompts are only for transactional and marketing, with a versioned notice", () => {
    expect(
      validateConsentPrompt({
        purpose: "marketing",
        noticeVersion: "v1",
        noticeText: "ok?"
      }).valid
    ).toBe(true);
    expect(
      validateConsentPrompt({
        purpose: "support",
        noticeVersion: "v1",
        noticeText: "ok?"
      }).valid
    ).toBe(false);
    expect(
      validateConsentPrompt({
        purpose: "marketing",
        noticeVersion: "v 1",
        noticeText: "ok?"
      }).valid
    ).toBe(false);
  });

  test("registration and listing are closed shapes", () => {
    expect(validateRegisterBot({ accountId: ENDPOINT }).valid).toBe(true);
    expect(
      validateRegisterBot({ accountId: ENDPOINT, token: TOKEN }).valid
    ).toBe(false);
    expect(validateListContactsQuery(new URLSearchParams("")).valid).toBe(
      false
    );
    expect(
      validateListContactsQuery(
        new URLSearchParams(`accountId=${ENDPOINT}&cursor=zzz`)
      ).valid
    ).toBe(false);
  });
});

describe("eligibility (TG6, TG7)", () => {
  const optIn = (method: string) => ({
    id: "c1",
    action: "opt_in" as const,
    method
  });

  test("nothing is eligible unless the contact is started", () => {
    for (const state of ["stopped", "blocked", "ended"] as const) {
      expect(
        evaluateEligibility(state, "support", optIn("start_command"))
      ).toEqual({ eligible: false, reason: "CONTACT_NOT_STARTED" });
    }
  });

  test("/start is support; marketing needs the button; a withdrawal wins", () => {
    expect(
      evaluateEligibility("started", "support", optIn("start_command")).eligible
    ).toBe(true);
    expect(evaluateEligibility("started", "marketing", null)).toEqual({
      eligible: false,
      reason: "CONSENT_REQUIRED"
    });
    expect(
      evaluateEligibility("started", "marketing", optIn("start_command"))
        .eligible
    ).toBe(false);
    expect(
      evaluateEligibility("started", "marketing", optIn("consent_button"))
        .eligible
    ).toBe(true);
    expect(
      evaluateEligibility("started", "marketing", {
        id: "c2",
        action: "opt_out",
        method: "stop_command"
      })
    ).toEqual({ eligible: false, reason: "CONSENT_WITHDRAWN" });
  });
});

describe("events (ADR-0150 N4)", () => {
  test("the literals match the registry", () => {
    expect(TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE).toBe(
      REGISTRY_INTERACTION
    );
    expect(TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE).toBe(
      REGISTRY_CONSENT
    );
    expect(TELEGRAM_ENGAGEMENT_EVENT_VERSION).toBe(REGISTRY_VERSION);
  });

  test("payloads carry ids, kinds and classes only and pass the envelope validator", () => {
    const interaction = buildInteractionReceivedPayload({
      channelAccountId: ENDPOINT,
      contactId: TENANT,
      updateId: 42,
      eventKind: "message",
      contentKinds: ["text"],
      forwarded: false,
      occurredAt: new Date(0),
      receivedAt: new Date(0),
      correlationId: "c",
      privacyClass: "conversation_meta"
    });
    const consent = buildConsentChangedPayload({
      channelAccountId: ENDPOINT,
      contactId: TENANT,
      purpose: "marketing",
      action: "opt_in",
      method: "consent_button",
      noticeVersion: "v1",
      occurredAt: new Date(0)
    });

    for (const payload of [interaction, consent]) {
      expect(validateDomainEventPayload(payload).valid).toBe(true);

      const keys = JSON.stringify(Object.keys(payload));

      for (const banned of [
        "chat",
        "username",
        'text"',
        "phone",
        "token",
        "secret",
        "userId"
      ]) {
        expect(keys).not.toContain(banned);
      }
    }
  });
});
