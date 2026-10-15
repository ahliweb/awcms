/**
 * Issue #965 (ADR-0140) — `telegram_delivery` without a database.
 *
 * Pins the rules that would otherwise be "covered" by a test that cannot fail:
 *
 * - the bot token (which Telegram puts in the request URL path) appears in NO
 *   output of the adapter, even when an error message, a refusal reason or a
 *   Telegram description contains it;
 * - the adapter sends PLAIN TEXT (no `parse_mode`), with link preview disabled and
 *   `protect_content`, and maps `429` to Telegram's own `retry_after` without
 *   touching the network again until it passes, `403` / "chat not found" to a dead
 *   binding, `5xx` to a retry and a `400` to a terminal rejection;
 * - the global pacer keeps two sends apart and the configured ceilings can never
 *   exceed the documented limits;
 * - a chat id round-trips through the ADR-0137 helper, fails authentication when
 *   copied to another tenant or binding, and its hash survives key rotation;
 * - the webhook parser acts on `/start <code>` and `/stop` from a PRIVATE chat
 *   only and ignores everything else (groups, channels, bots, bare `/start`);
 * - the template registry refuses payroll, every deny-listed variable, free text
 *   and URLs in fixed wording, and drops an unlisted or ill-typed variable;
 * - the webhook secret check is constant-time and fails closed on an unset secret;
 * - the module descriptor: delegated retention, six permissions mirrored by the
 *   seed, a navigation entry, and an erasure answer for every table.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import {
  parseKeyRing,
  STRICT_KEY_RING_OPTIONS
} from "../src/lib/security/field-encryption";
import { enqueueTelegramMessage } from "../src/modules/telegram-delivery/application/telegram-enqueue";
import {
  pendingWebhookRejections,
  recordWebhookRejection,
  resetWebhookRejectionsForTests,
  verifyWebhookSecret
} from "../src/modules/telegram-delivery/application/telegram-webhook-guard";
import { sanitizeProviderError } from "../src/modules/telegram-delivery/application/telegram-dispatch";
import {
  chatHashCandidates,
  decryptChatId,
  encryptChatId,
  hashChatId,
  maskChatId,
  maskUsername,
  normalizePrivateChatId,
  sanitizeDisplayName
} from "../src/modules/telegram-delivery/domain/telegram-chat";
import {
  isTelegramEnabled,
  isValidTelegramBotToken,
  isValidTelegramWebhookSecret,
  resolveTelegramBotUsername,
  resolveTelegramGlobalPerSecond,
  resolveTelegramPerChatIntervalMs,
  resolveTelegramSendMaxRetries
} from "../src/modules/telegram-delivery/domain/telegram-config";
import { TELEGRAM_CIRCUIT_BREAKER_KEY } from "../src/modules/telegram-delivery/domain/telegram-constants";
import {
  buildDeepLink,
  generateLinkCode,
  hashLinkCode,
  isWellFormedLinkCode,
  parseTelegramUpdate
} from "../src/modules/telegram-delivery/domain/telegram-link-code";
import {
  containsBotToken,
  redactBotToken,
  redactProviderText
} from "../src/modules/telegram-delivery/domain/telegram-redaction";
import { evaluateTelegramRetry } from "../src/modules/telegram-delivery/domain/telegram-retry";
import {
  deniedWordInVariableName,
  getTelegramTemplate,
  isValidTelegramVariableValue,
  registerTelegramTemplate,
  renderTelegramTemplate,
  resetTelegramTemplatesForTests,
  TelegramTemplateRegistrationError
} from "../src/modules/telegram-delivery/domain/telegram-templates";
import { createTelegramBotProvider } from "../src/modules/telegram-delivery/infrastructure/telegram-bot-provider";
import type {
  TelegramHttpClient,
  TelegramHttpRequest
} from "../src/modules/telegram-delivery/infrastructure/telegram-http-client";
import { resolveTelegramProvider } from "../src/modules/telegram-delivery/infrastructure/telegram-provider-resolver";
import {
  executeWebhookRegistration,
  planWebhookRegistration
} from "../src/modules/telegram-delivery/infrastructure/telegram-webhook-registration";
import { telegramDeliveryModule } from "../src/modules/telegram-delivery/module";

const TOKEN = "123456789:AAH_fake_token_value_for_tests_0123456789";
const SECRET = "kQ7mZp2LxV9aRt4NwB8cYd3HsJ6eFgU1oPi5XnA0zMb_-vTqEr";
const KEY_A = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const KEY_B = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 251)
).toString("base64");
const TENANT = "a9650000-0000-4000-8000-00000000000a";
const OTHER_TENANT = "a9650000-0000-4000-8000-00000000000b";
const BINDING = "b9650000-0000-4000-8000-00000000000a";
const OTHER_BINDING = "b9650000-0000-4000-8000-00000000000b";

function ring(spec: string) {
  const result = parseKeyRing(spec, "TEST_RING", STRICT_KEY_RING_OPTIONS);

  if (!result.ok) throw new Error(result.reason);

  return result;
}

beforeEach(() => {
  resetProviderCircuitBreakersForTests();
  resetWebhookRejectionsForTests();
  resetTelegramTemplatesForTests();
});

// ---------------------------------------------------------------------------
describe("configuration", () => {
  test("off by default; only the literal string true turns it on", () => {
    expect(isTelegramEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isTelegramEnabled({ TELEGRAM_ENABLED: "1" } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      isTelegramEnabled({ TELEGRAM_ENABLED: "true" } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  test("the rate ceilings can never exceed Telegram's documented limits, whatever is configured", () => {
    const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

    expect(resolveTelegramGlobalPerSecond(env({}))).toBe(20);
    expect(
      resolveTelegramGlobalPerSecond(
        env({ TELEGRAM_RATE_GLOBAL_PER_SECOND: "500" })
      )
    ).toBe(25);
    expect(
      resolveTelegramGlobalPerSecond(
        env({ TELEGRAM_RATE_GLOBAL_PER_SECOND: "0" })
      )
    ).toBe(20);
    expect(resolveTelegramPerChatIntervalMs(env({}))).toBe(1000);
    expect(
      resolveTelegramPerChatIntervalMs(
        env({ TELEGRAM_RATE_PER_CHAT_INTERVAL_MS: "10" })
      )
    ).toBe(1000);
    expect(
      resolveTelegramPerChatIntervalMs(
        env({ TELEGRAM_RATE_PER_CHAT_INTERVAL_MS: "5000" })
      )
    ).toBe(5000);
  });

  test("retries: zero is a real value, empty is unset", () => {
    const env = (value: string) =>
      ({ TELEGRAM_SEND_MAX_RETRIES: value }) as NodeJS.ProcessEnv;

    expect(resolveTelegramSendMaxRetries(env("0"))).toBe(0);
    expect(resolveTelegramSendMaxRetries(env(""))).toBe(3);
    expect(resolveTelegramSendMaxRetries(env("junk"))).toBe(3);
  });

  test("token, secret and bot username are validated by shape", () => {
    expect(isValidTelegramBotToken(TOKEN)).toBe(true);
    expect(isValidTelegramBotToken("changeme")).toBe(false);
    expect(isValidTelegramBotToken(undefined)).toBe(false);
    expect(isValidTelegramWebhookSecret(SECRET)).toBe(true);
    expect(isValidTelegramWebhookSecret("short")).toBe(false);
    // M2: the floor is 43 characters, 12 distinct ones and no placeholder word.
    expect(isValidTelegramWebhookSecret("a".repeat(64))).toBe(false);
    expect(isValidTelegramWebhookSecret("ab".repeat(32))).toBe(false);
    expect(isValidTelegramWebhookSecret(SECRET.slice(0, 42))).toBe(false);
    expect(isValidTelegramWebhookSecret(SECRET.slice(0, 43))).toBe(true);
    for (const word of ["change-me", "secret", "password", "replace-me"]) {
      expect(
        isValidTelegramWebhookSecret(`${word}-${SECRET}`.slice(0, 64))
      ).toBe(false);
    }
    expect(isValidTelegramWebhookSecret(`${SECRET}`.toUpperCase())).toBe(true);
    expect(isValidTelegramWebhookSecret("has spaces " + "x".repeat(40))).toBe(
      false
    );
    expect(
      resolveTelegramBotUsername({
        TELEGRAM_BOT_USERNAME: "@Awcms_Staff_bot"
      } as NodeJS.ProcessEnv)
    ).toBe("Awcms_Staff_bot");
    expect(
      resolveTelegramBotUsername({
        TELEGRAM_BOT_USERNAME: "x"
      } as NodeJS.ProcessEnv)
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("chat id storage (ADR-0137 helper)", () => {
  test("only a positive integer is a private chat id; groups and channels are refused", () => {
    expect(normalizePrivateChatId(123456789)).toBe("123456789");
    expect(normalizePrivateChatId(-1001234567890)).toBeNull();
    expect(normalizePrivateChatId(0)).toBeNull();
    expect(normalizePrivateChatId("123")).toBeNull();
    expect(normalizePrivateChatId(1.5)).toBeNull();
    expect(normalizePrivateChatId(2 ** 60)).toBeNull();
  });

  test("encrypt / decrypt round-trips, and the ciphertext is bound to its tenant and binding", () => {
    const keys = ring(`k1:${KEY_A}`);
    const sealed = encryptChatId("123456789", TENANT, BINDING, keys);

    expect(sealed).toMatch(/^v2:k1:/);
    expect(sealed).not.toContain("123456789");
    expect(decryptChatId(sealed, TENANT, BINDING, keys)).toBe("123456789");
    expect(() => decryptChatId(sealed, OTHER_TENANT, BINDING, keys)).toThrow();
    expect(() => decryptChatId(sealed, TENANT, OTHER_BINDING, keys)).toThrow();
  });

  test("a rotated ring still decrypts the old value, and new values use the first key", () => {
    const old = ring(`k1:${KEY_A}`);
    const rotated = ring(`k2:${KEY_B},k1:${KEY_A}`);
    const sealedOld = encryptChatId("42", TENANT, BINDING, old);

    expect(decryptChatId(sealedOld, TENANT, BINDING, rotated)).toBe("42");
    expect(encryptChatId("42", TENANT, BINDING, rotated)).toMatch(/^v2:k2:/);
    // ... and a ring that lost the key cannot.
    expect(() =>
      decryptChatId(sealedOld, TENANT, BINDING, ring(`k2:${KEY_B}`))
    ).toThrow();
  });

  test("the keyed hash is tenant-bound, ring-keyed, and findable across a rotation", () => {
    const old = ring(`k1:${KEY_A}`);
    const rotated = ring(`k2:${KEY_B},k1:${KEY_A}`);
    const stored = hashChatId("555", TENANT, old);

    expect(stored.chatHash).toMatch(/^k1:[0-9a-f]{64}$/);
    expect(stored.hashKeyId).toBe("k1");
    expect(hashChatId("555", OTHER_TENANT, old).chatHash).not.toBe(
      stored.chatHash
    );
    expect(hashChatId("555", TENANT, rotated).chatHash).toMatch(/^k2:/);
    expect(chatHashCandidates("555", TENANT, rotated)).toContain(
      stored.chatHash
    );
    expect(stored.chatHash).not.toContain("555");
  });

  test("the mask keeps three digits; the display name and username are made safe", () => {
    expect(maskChatId("123456789")).toBe("***789");
    expect(sanitizeDisplayName("Sari‮\u0000", "  Wulan\n")).toBe("Sari Wulan");
    expect(sanitizeDisplayName("x".repeat(200), null)).toHaveLength(64);
    expect(sanitizeDisplayName(null, undefined)).toBeNull();
    expect(maskUsername("sari_wulan")).toBe("@s******n");
    expect(maskUsername("a b")).toBeNull();
    expect(maskUsername(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("link codes and the update parser", () => {
  test("a code is 43 base64url characters and is stored only as a SHA-256", () => {
    const code = generateLinkCode();

    expect(code).toHaveLength(43);
    expect(isWellFormedLinkCode(code)).toBe(true);
    expect(generateLinkCode()).not.toBe(code);
    expect(hashLinkCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkCode(code)).not.toContain(code);
    expect(buildDeepLink("Awcms_bot", code)).toBe(
      `https://t.me/Awcms_bot?start=${code}`
    );
  });

  const privateStart = (text: string, over: Record<string, unknown> = {}) => ({
    update_id: 1,
    message: {
      text,
      chat: { id: 777, type: "private" },
      from: { id: 777, is_bot: false, first_name: "Sari", username: "sari" },
      ...over
    }
  });

  test("`/start <code>` from a private chat is a start command carrying the sender", () => {
    const code = generateLinkCode();
    const parsed = parseTelegramUpdate(privateStart(`/start ${code}`));

    expect(parsed).toMatchObject({ kind: "start", code, chatId: "777" });
  });

  test("`/stop` from a private chat is a stop command (also with the bot suffix)", () => {
    expect(parseTelegramUpdate(privateStart("/stop"))).toEqual({
      kind: "stop",
      chatId: "777"
    });
    expect(parseTelegramUpdate(privateStart("/stop@Awcms_staff_bot"))).toEqual({
      kind: "stop",
      chatId: "777"
    });
  });

  test("a payload that is not a code is answered like an unknown code, not as an oracle", () => {
    expect(parseTelegramUpdate(privateStart("/start nonsense"))).toEqual({
      kind: "start_invalid",
      chatId: "777"
    });
  });

  test("everything else is ignored: bare /start, other text, groups, channels, bots, edits, media", () => {
    const code = generateLinkCode();
    const ignored = { kind: "ignored" as const };

    expect(parseTelegramUpdate(privateStart("/start"))).toEqual(ignored);
    expect(parseTelegramUpdate(privateStart("hello"))).toEqual(ignored);
    expect(parseTelegramUpdate(privateStart("/help"))).toEqual(ignored);
    expect(parseTelegramUpdate(privateStart(`/start ${code} extra`))).toEqual(
      ignored
    );
    expect(
      parseTelegramUpdate(
        privateStart(`/start ${code}`, {
          chat: { id: -100123, type: "supergroup" },
          from: { id: 777, is_bot: false }
        })
      )
    ).toEqual(ignored);
    expect(
      parseTelegramUpdate(
        privateStart(`/start ${code}`, {
          chat: { id: -100123, type: "channel" }
        })
      )
    ).toEqual(ignored);
    // A "private" chat whose id is not the sender's is not a private conversation.
    expect(
      parseTelegramUpdate(
        privateStart(`/start ${code}`, { chat: { id: 999, type: "private" } })
      )
    ).toEqual(ignored);
    expect(
      parseTelegramUpdate(
        privateStart(`/start ${code}`, {
          from: { id: 777, is_bot: true }
        })
      )
    ).toEqual(ignored);
    expect(parseTelegramUpdate({ edited_message: { text: "/stop" } })).toEqual(
      ignored
    );
    expect(
      parseTelegramUpdate({
        message: { chat: { id: 1, type: "private" }, from: { id: 1 } }
      })
    ).toEqual(ignored);
    expect(parseTelegramUpdate(null)).toEqual(ignored);
    expect(parseTelegramUpdate("x")).toEqual(ignored);
    expect(parseTelegramUpdate(privateStart("x".repeat(500)))).toEqual(ignored);
  });
});

// ---------------------------------------------------------------------------
describe("template registry (ADR-0140 section 1)", () => {
  const ok = {
    ownerModuleKey: "booking",
    key: "booking.staff_reminder",
    version: 1,
    purpose: "staff_ops" as const,
    body: "{{count}} arrivals tomorrow for resource {{resource}}. Open the admin: {{link}}",
    variables: [
      { name: "count", kind: "count" as const },
      { name: "resource", kind: "reference" as const },
      { name: "link", kind: "link" as const }
    ]
  };

  test("a well-formed staff_ops template registers; the built-in alert exists", () => {
    registerTelegramTemplate(ok);

    expect(getTelegramTemplate("booking.staff_reminder")?.version).toBe(1);
    expect(getTelegramTemplate("system.ops_alert")).toBeDefined();
  });

  test("any other purpose is not representable and is refused", () => {
    for (const purpose of ["transactional", "security", "marketing", "otp"]) {
      expect(() =>
        registerTelegramTemplate({ ...ok, purpose: purpose as "staff_ops" })
      ).toThrow(TelegramTemplateRegistrationError);
    }
  });

  test("a template under a payroll-owning module is refused at registration", () => {
    for (const key of ["hr_payroll.payslip_ready", "payroll.run_state"]) {
      expect(() =>
        registerTelegramTemplate({
          ...ok,
          ownerModuleKey: key.slice(0, key.indexOf(".")),
          key
        })
      ).toThrow(/payroll/);
    }
  });

  test("every PII-like variable name is refused at registration, however it is spelled", () => {
    const denied = [
      "customerName",
      "name",
      "phone",
      "phone_number",
      "email",
      "address",
      "nik",
      "npwp",
      "bank_account",
      "netSalary",
      "amount",
      "totalPrice",
      "guestName",
      "note",
      "comment",
      "message",
      "description",
      "reason",
      "payslipLink",
      "otp",
      "password",
      "identifier"
    ];

    for (const name of denied) {
      expect(deniedWordInVariableName(name)).not.toBeNull();
      expect(() =>
        registerTelegramTemplate({
          ...ok,
          body: `Hello {{${name}}}`,
          variables: [{ name, kind: "reference" }]
        })
      ).toThrow(TelegramTemplateRegistrationError);
    }

    for (const name of [
      "count",
      "resource",
      "job",
      "failures",
      "link",
      "reservationRef"
    ]) {
      expect(deniedWordInVariableName(name)).toBeNull();
    }
  });

  test("there is no kind that can carry free text, so an unknown kind is refused", () => {
    expect(() =>
      registerTelegramTemplate({
        ...ok,
        variables: [{ name: "resource", kind: "text" as "reference" }]
      })
    ).toThrow(/unknown kind/);
  });

  test("fixed wording may not carry a URL, a domain or a mention", () => {
    for (const body of [
      "See https://example.org/{{resource}}",
      "Open www.example.org for {{resource}}",
      "Write to ops@example.org about {{resource}}",
      "Ask @someone about {{resource}}",
      "Join t.me/chat for {{resource}}",
      "Visit example.com for {{resource}}"
    ]) {
      expect(() =>
        registerTelegramTemplate({
          ...ok,
          body,
          variables: [{ name: "resource", kind: "reference" }]
        })
      ).toThrow(TelegramTemplateRegistrationError);
    }
  });

  test("a placeholder must be declared, a name may not repeat, a conflicting re-registration is refused", () => {
    expect(() =>
      registerTelegramTemplate({ ...ok, body: "{{ghost}}", variables: [] })
    ).toThrow(/not on its variable list/);
    expect(() =>
      registerTelegramTemplate({
        ...ok,
        variables: [
          { name: "resource", kind: "reference" },
          { name: "resource", kind: "count" }
        ]
      })
    ).toThrow(/twice/);

    registerTelegramTemplate(ok);
    registerTelegramTemplate(ok);
    expect(() =>
      registerTelegramTemplate({ ...ok, body: "{{count}} different" })
    ).toThrow(/already registered/);
  });

  test("typed values: a value that does not satisfy its kind is dropped, never rendered", () => {
    expect(isValidTelegramVariableValue("reference", "R-12")).toBe(true);
    expect(isValidTelegramVariableValue("reference", "Sari Wulan")).toBe(false);
    expect(isValidTelegramVariableValue("reference", "a.b")).toBe(false);
    expect(isValidTelegramVariableValue("reference", "https://x")).toBe(false);
    expect(isValidTelegramVariableValue("count", "3")).toBe(true);
    expect(isValidTelegramVariableValue("count", "3 people")).toBe(false);
    expect(isValidTelegramVariableValue("token", "email:dispatch")).toBe(true);
    expect(isValidTelegramVariableValue("token", "Email Dispatch")).toBe(false);
    expect(isValidTelegramVariableValue("link", "/admin/telegram")).toBe(true);
    expect(
      isValidTelegramVariableValue("link", "https://evil.example/admin/x")
    ).toBe(false);
    expect(isValidTelegramVariableValue("link", "//evil.example/admin/x")).toBe(
      false
    );
    expect(isValidTelegramVariableValue("link", "/admin/../etc")).toBe(false);
    expect(isValidTelegramVariableValue("link", "/other/path")).toBe(false);
    expect(isValidTelegramVariableValue("count", 3)).toBe(false);
  });

  test("rendering drops unlisted and ill-typed variables and builds the link from the declared origin only", () => {
    registerTelegramTemplate(ok);
    const template = getTelegramTemplate("booking.staff_reminder")!;
    const rendered = renderTelegramTemplate(
      template,
      {
        count: "3",
        resource: "R-12",
        link: "/admin/booking",
        netSalary: "12000000",
        customerName: "Sari"
      },
      "https://erp.example.test"
    );

    expect(rendered.body).toBe(
      "3 arrivals tomorrow for resource R-12. Open the admin: https://erp.example.test/admin/booking"
    );
    expect(rendered.droppedVariables.sort()).toEqual([
      "customerName",
      "netSalary"
    ]);
    expect(JSON.stringify(rendered.variables)).not.toContain("12000000");
    expect(rendered.body).not.toContain("Sari");

    const illTyped = renderTelegramTemplate(
      template,
      { count: "three", resource: "Sari Wulan", link: "https://evil.example/" },
      "https://erp.example.test"
    );

    expect(illTyped.variables).toEqual({});
    expect(illTyped.body).not.toContain("evil.example");
    expect(illTyped.body).not.toContain("Sari");
  });
});

// ---------------------------------------------------------------------------
describe("redaction", () => {
  test("the exact token and anything shaped like one is removed, with or without the bot prefix", () => {
    const text = `POST https://api.telegram.org/bot${TOKEN}/sendMessage failed; token ${TOKEN}; other 987654321:ZZZ_another_token_value_0123456789abc`;
    const cleaned = redactBotToken(text, TOKEN);

    expect(cleaned).not.toContain(TOKEN);
    expect(cleaned).not.toContain("AAH_fake");
    expect(cleaned).not.toContain("ZZZ_another");
    expect(containsBotToken(cleaned)).toBe(false);
    expect(containsBotToken(text)).toBe(true);
  });

  test("a configured token that does not match the general shape is still removed", () => {
    const odd = "short:tok";

    expect(redactBotToken(`x ${odd} y`, odd)).not.toContain(odd);
  });

  test("provider text also loses number runs (a chat id) and is capped", () => {
    const cleaned = redactProviderText("chat 123456789 not found", TOKEN);

    expect(cleaned).toBe("chat [number] not found");
    expect(redactProviderText("a".repeat(1000), TOKEN, 50)).toHaveLength(50);
  });

  test("the dispatcher scrubs the row's own body and variables out of provider text", () => {
    const cleaned = sanitizeProviderError(
      "Bad Request: cannot send 'Job email:dispatch has failed 3 runs'",
      {
        body: "Job email:dispatch has failed 3 runs",
        variables: { job: "email:dispatch" }
      },
      TOKEN
    );

    expect(cleaned).not.toContain("email:dispatch");
    expect(cleaned).toContain("[redacted]");
  });
});

// ---------------------------------------------------------------------------
describe("the Bot API adapter", () => {
  type Scripted = (
    token: string,
    request: TelegramHttpRequest,
    call: number
  ) => ReturnType<TelegramHttpClient>;

  function setup(script: Scripted, over: { minSendIntervalMs?: number } = {}) {
    const requests: TelegramHttpRequest[] = [];
    const tokens: string[] = [];
    const sleeps: number[] = [];
    let clock = 1_000_000;
    const http: TelegramHttpClient = async (token, request) => {
      tokens.push(token);
      requests.push(request);

      return script(token, request, requests.length);
    };
    const provider = createTelegramBotProvider({
      token: TOKEN,
      timeoutMs: 50,
      minSendIntervalMs: over.minSendIntervalMs ?? 0,
      retryAfterCapSeconds: 300,
      http,
      now: () => new Date(clock),
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      }
    });

    return {
      provider,
      requests,
      sleeps,
      advance: (ms: number) => {
        clock += ms;
      }
    };
  }

  const SEND = {
    chatId: "777",
    text: "Hello",
    templateKey: "system.ops_alert"
  };
  const json = (status: number, body: unknown) => ({
    ok: true as const,
    status,
    body: JSON.stringify(body)
  });

  test("sends plain text: no parse_mode, preview disabled, protect_content on, to sendMessage only", async () => {
    const { provider, requests } = setup(async () =>
      json(200, { ok: true, result: { message_id: 42 } })
    );
    const result = await provider.send(SEND);

    expect(result).toEqual({ ok: true, providerMessageId: "42" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("sendMessage");

    const body = JSON.parse(requests[0]!.body);

    expect(body).toMatchObject({
      chat_id: "777",
      text: "Hello",
      disable_web_page_preview: true,
      protect_content: true,
      link_preview_options: { is_disabled: true }
    });
    expect("parse_mode" in body).toBe(false);
    expect(requests[0]!.body).not.toContain(TOKEN);
  });

  test("a token-bearing transport error never reaches any output", async () => {
    const leak = `connect ECONNRESET https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const thrown = setup(async () => {
      throw new Error(leak);
    });
    const refused = setup(async () => ({
      ok: false as const,
      reason: leak
    }));
    const described = setup(async () =>
      json(400, {
        ok: false,
        error_code: 400,
        description: `Bad Request: bot${TOKEN} rejected chat 123456789`
      })
    );

    for (const run of [thrown, refused, described]) {
      const result = await run.provider.send(SEND);

      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain("AAH_fake");
      expect(JSON.stringify(result)).not.toContain("123456789");
      expect(JSON.stringify(await run.provider.healthCheck())).not.toContain(
        TOKEN
      );
    }
  });

  test("429 honours retry_after, spends no retry budget, and the adapter then answers without the network", async () => {
    const { provider, requests, advance } = setup(async () =>
      json(429, {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 7",
        parameters: { retry_after: 7 }
      })
    );
    const first = await provider.send(SEND);

    expect(first).toMatchObject({
      ok: false,
      retryable: true,
      failureCode: "rate_limited",
      retryAfterSeconds: 7
    });
    expect(requests).toHaveLength(1);

    // Inside the window: no network call, and the remaining time is reported.
    advance(3000);
    const second = await provider.send(SEND);

    expect(requests).toHaveLength(1);
    expect(second).toMatchObject({ ok: false, failureCode: "rate_limited" });
    expect((second as { retryAfterSeconds: number }).retryAfterSeconds).toBe(4);

    // After the window the adapter calls Telegram again.
    advance(5000);
    await provider.send(SEND);
    expect(requests).toHaveLength(2);
  });

  test("a hostile retry_after is capped", async () => {
    const { provider } = setup(async () =>
      json(429, { ok: false, parameters: { retry_after: 10_000_000 } })
    );

    expect(await provider.send(SEND)).toMatchObject({ retryAfterSeconds: 300 });
  });

  test("403 and 'chat not found' mean a dead binding, terminal; a 400 rejection is terminal but not a binding verdict", async () => {
    const blocked = setup(async () =>
      json(403, {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user"
      })
    );
    const gone = setup(async () =>
      json(400, {
        ok: false,
        error_code: 400,
        description: "Bad Request: chat not found"
      })
    );
    const rejected = setup(async () =>
      json(400, {
        ok: false,
        error_code: 400,
        description: "Bad Request: message is too long"
      })
    );

    expect(await blocked.provider.send(SEND)).toMatchObject({
      ok: false,
      retryable: false,
      bindingUnreachable: true
    });
    expect(await gone.provider.send(SEND)).toMatchObject({
      ok: false,
      retryable: false,
      bindingUnreachable: true
    });

    const verdict = await rejected.provider.send(SEND);

    expect(verdict).toMatchObject({
      ok: false,
      retryable: false,
      failureCode: "rejected"
    });
    expect(
      (verdict as { bindingUnreachable?: boolean }).bindingUnreachable
    ).toBe(undefined);
  });

  test("5xx, a transport failure and a bad token are retryable", async () => {
    for (const status of [500, 502, 503]) {
      const run = setup(async () => json(status, { ok: false }));

      expect(await run.provider.send(SEND)).toMatchObject({
        ok: false,
        retryable: true,
        failureCode: "provider_error"
      });
    }

    expect(
      await setup(async () => ({
        ok: false as const,
        reason: "timeout"
      })).provider.send(SEND)
    ).toMatchObject({ retryable: true, failureCode: "network_error" });
    expect(
      await setup(async () => json(401, { ok: false })).provider.send(SEND)
    ).toMatchObject({ retryable: true, failureCode: "unauthorized" });
  });

  test("only the adapter feeds the breaker: failures open it, a per-message rejection never does", async () => {
    const breaker = getProviderCircuitBreaker(TELEGRAM_CIRCUIT_BREAKER_KEY);
    const now = new Date(1_000_000);
    const rejecting = setup(async () =>
      json(400, { ok: false, description: "Bad Request: message is too long" })
    );

    for (let i = 0; i < 10; i += 1) {
      await rejecting.provider.send(SEND);
    }

    expect(breaker.canAttempt(now)).toBe(true);

    const failing = setup(async () => json(500, { ok: false }));

    for (let i = 0; i < 5; i += 1) {
      await failing.provider.send(SEND);
    }

    expect(breaker.canAttempt(now)).toBe(false);
    expect(await failing.provider.healthCheck()).toEqual({
      ok: false,
      error: "Circuit breaker is open."
    });
  });

  test("the global pacer keeps two sends at least one interval apart", async () => {
    const { provider, sleeps } = setup(
      async () => json(200, { ok: true, result: { message_id: 1 } }),
      { minSendIntervalMs: 50 }
    );

    await provider.send(SEND);
    await provider.send(SEND);
    await provider.send(SEND);

    // The first goes at once; the next two each wait out the interval.
    expect(sleeps).toEqual([50, 50]);
  });

  test("a misconfigured deployment degrades to a non-retryable failure that echoes no value", async () => {
    const provider = resolveTelegramProvider({
      TELEGRAM_BOT_TOKEN: "not-a-token"
    } as NodeJS.ProcessEnv);
    const result = await provider.send(SEND);

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      failureCode: "misconfigured"
    });
    expect(JSON.stringify(result)).not.toContain("not-a-token");
  });

  test("the resolver shares ONE adapter across tenants for one configuration, so the pacer and the 429 pause are per bot", () => {
    const env = { TELEGRAM_BOT_TOKEN: TOKEN } as NodeJS.ProcessEnv;

    expect(resolveTelegramProvider(env)).toBe(resolveTelegramProvider(env));
  });
});

// ---------------------------------------------------------------------------
describe("retry policy", () => {
  test("exponential minutes, capped at 15, none past the cap", () => {
    const now = new Date(0);

    expect(evaluateTelegramRetry(0, 3, now).nextAttemptAt?.getTime()).toBe(
      60_000
    );
    expect(evaluateTelegramRetry(2, 10, now).nextAttemptAt?.getTime()).toBe(
      4 * 60_000
    );
    expect(evaluateTelegramRetry(8, 10, now).nextAttemptAt?.getTime()).toBe(
      15 * 60_000
    );
    expect(evaluateTelegramRetry(3, 3, now).eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("the enqueue port, before any database is touched", () => {
  // Registered per test run, not at collection: earlier describes reset the registry.
  beforeEach(() => {
    registerTelegramTemplate({
      ownerModuleKey: "booking",
      key: "booking.enqueue_probe",
      version: 1,
      purpose: "staff_ops",
      body: "{{count}} arrivals tomorrow",
      variables: [{ name: "count", kind: "count" }]
    });
  });

  const input = {
    templateKey: "booking.enqueue_probe",
    recipientPrincipalId: "c9650000-0000-4000-8000-00000000000c",
    variables: { count: "3" },
    idempotencyKey: "k1",
    expiresAt: new Date(Date.now() + 60_000)
  };
  // A transaction that fails the test if anything queries it.
  const untouched = (() => {
    throw new Error("the database was touched");
  }) as unknown as Bun.TransactionSQL;

  test("disabled: refused before any query", async () => {
    expect(
      await enqueueTelegramMessage(untouched, input, {
        env: {} as NodeJS.ProcessEnv
      })
    ).toEqual({ status: "refused", reason: "DISABLED" });
  });

  test("N1: a system.* template is not enqueueable by a consumer, whatever its values are", async () => {
    const env = { TELEGRAM_ENABLED: "true" } as NodeJS.ProcessEnv;

    expect(
      await enqueueTelegramMessage(
        untouched,
        {
          ...input,
          templateKey: "system.ops_alert",
          variables: { job: "gaji:15000000", failures: "1", link: "/admin/x" }
        },
        { env }
      )
    ).toEqual({ status: "refused", reason: "TEMPLATE_UNKNOWN" });
  });

  test("an unknown template and a missing, past or too-distant expiry are refused before any query", async () => {
    const env = { TELEGRAM_ENABLED: "true" } as NodeJS.ProcessEnv;

    expect(
      await enqueueTelegramMessage(
        untouched,
        { ...input, templateKey: "nope.missing" },
        { env }
      )
    ).toEqual({ status: "refused", reason: "TEMPLATE_UNKNOWN" });

    for (const expiresAt of [
      undefined,
      new Date(Date.now() - 1000),
      new Date(Number.NaN),
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    ]) {
      expect(
        await enqueueTelegramMessage(
          untouched,
          { ...input, expiresAt: expiresAt as Date },
          { env }
        )
      ).toEqual({ status: "refused", reason: "EXPIRY_REQUIRED" });
    }
  });

  test("an empty idempotency key is a programming error and throws", async () => {
    await expect(
      enqueueTelegramMessage(untouched, { ...input, idempotencyKey: "" })
    ).rejects.toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
describe("the webhook secret and the rejection record", () => {
  test("the secret must match exactly; a missing header, a wrong one and an unset server secret all fail", () => {
    expect(verifyWebhookSecret(SECRET, SECRET)).toBe(true);
    expect(verifyWebhookSecret(null, SECRET)).toBe(false);
    expect(verifyWebhookSecret("", SECRET)).toBe(false);
    expect(verifyWebhookSecret(SECRET + "x", SECRET)).toBe(false);
    expect(verifyWebhookSecret(SECRET.slice(1), SECRET)).toBe(false);
    // M2 at request time: a weak SERVER secret verifies nothing, even a header
    // that equals it, so a deployment never run through config:validate is safe.
    const weak = "a".repeat(64);

    expect(verifyWebhookSecret(weak, weak)).toBe(false);
    expect(
      verifyWebhookSecret("changeme-".repeat(8), "changeme-".repeat(8))
    ).toBe(false);
    // Fail closed: an unset or malformed server secret verifies NOTHING, not
    // even the empty header or the same malformed value.
    expect(verifyWebhookSecret("", undefined)).toBe(false);
    expect(verifyWebhookSecret("anything", undefined)).toBe(false);
    expect(verifyWebhookSecret("short", "short")).toBe(false);
  });

  test("rejections are counted in-process by reason; nothing else is recorded", () => {
    recordWebhookRejection("header_mismatch", 1000);
    recordWebhookRejection("header_mismatch", 1001);
    recordWebhookRejection("header_absent", 1002);

    expect(pendingWebhookRejections()).toEqual({
      header_mismatch: 2,
      header_absent: 1
    });
  });
});

// ---------------------------------------------------------------------------
describe("webhook registration is a deliberate, narrow operator act", () => {
  const env = {
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBHOOK_SECRET: SECRET
  } as NodeJS.ProcessEnv;
  const URL_OK = "https://erp.example.test/api/v1/telegram/webhook";

  test("setWebhook subscribes to message updates only, with the secret, without dropping pending updates", () => {
    const plan = planWebhookRegistration({ action: "set", url: URL_OK, env });

    expect(plan.ok).toBe(true);

    if (!plan.ok) return;

    const body = JSON.parse(plan.body);

    expect(plan.method).toBe("setWebhook");
    expect(body).toEqual({
      url: URL_OK,
      secret_token: SECRET,
      allowed_updates: ["message"]
    });
    expect("drop_pending_updates" in body).toBe(false);
    // The summary is what gets printed: it must carry neither secret.
    expect(plan.summary).not.toContain(SECRET);
    expect(plan.summary).not.toContain(TOKEN);
  });

  test("a URL that is not exactly the webhook path over https is refused", () => {
    for (const url of [
      "http://erp.example.test/api/v1/telegram/webhook",
      "https://erp.example.test/api/v1/telegram/webhook?x=1",
      "https://erp.example.test/api/v1/telegram/webhook#f",
      "https://u:p@erp.example.test/api/v1/telegram/webhook",
      "https://erp.example.test/api/v1/telegram/webhook/",
      "https://erp.example.test/other",
      "not a url",
      ""
    ]) {
      expect(planWebhookRegistration({ action: "set", url, env }).ok).toBe(
        false
      );
    }
  });

  test("a missing token or secret is refused, and the delete plan needs only the token", () => {
    expect(
      planWebhookRegistration({
        action: "set",
        url: URL_OK,
        env: { TELEGRAM_BOT_TOKEN: TOKEN } as NodeJS.ProcessEnv
      }).ok
    ).toBe(false);
    expect(
      planWebhookRegistration({
        action: "set",
        url: URL_OK,
        env: { TELEGRAM_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv
      }).ok
    ).toBe(false);
    expect(
      planWebhookRegistration({
        action: "delete",
        env: { TELEGRAM_BOT_TOKEN: TOKEN } as NodeJS.ProcessEnv
      }).ok
    ).toBe(true);
  });

  test("a failing registration reports Telegram's reason with the token redacted", async () => {
    const plan = planWebhookRegistration({ action: "set", url: URL_OK, env });

    if (!plan.ok) throw new Error("plan should be valid");

    const result = await executeWebhookRegistration(plan, {
      env,
      http: async () => ({
        ok: false,
        reason: `refused https://api.telegram.org/bot${TOKEN}/setWebhook`
      })
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
describe("the module descriptor and the migrations", () => {
  // Comment lines explain WHY and name the very things the assertions forbid, so
  // the assertions read the statements only.
  const statements = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
  const schema = statements("sql/216_awcms_telegram_delivery_schema.sql");
  const bootstrap = statements("sql/217_awcms_telegram_delivery_bootstrap.sql");
  const permissionsSeed = readFileSync(
    "sql/218_awcms_telegram_delivery_permissions.sql",
    "utf8"
  );

  test("the six permissions are exactly the six seeded, and none is the unenforceable kind", () => {
    const declared = (telegramDeliveryModule.permissions ?? []).map(
      (p) => `${p.activityCode}.${p.action}`
    );

    expect(declared.sort()).toEqual(
      [
        "messages.read",
        "templates.read",
        "bindings.read",
        "bindings.revoke",
        "links.create",
        "settings.configure"
      ].sort()
    );

    for (const key of declared) {
      const [activityCode, action] = key.split(".");

      expect(permissionsSeed).toContain(`'${activityCode}', '${action}'`);
    }
  });

  test("the navigation entry opens a page that exists and is gated on a seeded permission", () => {
    expect(telegramDeliveryModule.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/telegram",
        requiredPermission: "telegram_delivery.links.create"
      })
    ]);
    expect(telegramDeliveryModule.status).toBe("active");
  });

  test("migrations use only the 216-219 band", () => {
    for (const name of [
      "216_awcms_telegram_delivery_schema.sql",
      "217_awcms_telegram_delivery_bootstrap.sql",
      "218_awcms_telegram_delivery_permissions.sql"
    ]) {
      const number = Number(name.slice(0, 3));

      expect(number).toBeGreaterThanOrEqual(216);
      expect(number).toBeLessThanOrEqual(219);
    }
  });

  test("every table is tenant-scoped with RLS ENABLED and FORCED and a tenant-isolation policy", () => {
    const tables = [
      "awcms_telegram_settings",
      "awcms_telegram_link_codes",
      "awcms_telegram_bindings",
      "awcms_telegram_messages",
      "awcms_telegram_delivery_attempts"
    ];

    for (const table of tables) {
      expect(schema).toContain(
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`
      );
      expect(schema).toContain(
        `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`
      );
      expect(schema).toContain(`CREATE POLICY ${table}_tenant_isolation`);
    }

    expect(
      (schema.match(/CREATE TABLE IF NOT EXISTS awcms_telegram_/g) ?? []).length
    ).toBe(tables.length);
  });

  test("the schema holds no plaintext chat column and no fallback queue", () => {
    expect(schema).not.toMatch(/\bchat_id\b/);
    expect(schema).not.toMatch(/chat_plain|raw_chat/i);
    expect(schema).toContain("chat_ciphertext text");
    // A revoked binding carrying ciphertext is unrepresentable.
    expect(schema).toContain("awcms_telegram_bindings_ciphertext_check");
    // The only purpose class.
    expect(schema).toContain("CHECK (purpose IN ('staff_ops'))");
    // Every message has an expiry, structurally.
    expect(schema).toMatch(/expires_at timestamptz NOT NULL/);
  });

  test("the bootstrap functions are narrow, search_path-pinned, and executable by exactly their caller", () => {
    expect(bootstrap).toContain("NOLOGIN NOSUPERUSER NOBYPASSRLS");
    expect(bootstrap.match(/^SECURITY DEFINER$/gm)?.length).toBe(4);
    expect(
      bootstrap.match(/^SET search_path = public, pg_temp$/gm)?.length
    ).toBe(4);
    expect(bootstrap).toContain(
      "GRANT EXECUTE ON FUNCTION awcms_telegram_resolve_link_code(text) TO awcms_app;"
    );
    expect(bootstrap).toContain(
      "GRANT EXECUTE ON FUNCTION awcms_telegram_principal_active(uuid, uuid) TO awcms_worker;"
    );
    expect(bootstrap).not.toMatch(/GRANT EXECUTE[^;]*PUBLIC/);
    expect(bootstrap.match(/REVOKE ALL ON FUNCTION/g)?.length).toBe(4);
    // No dynamic SQL inside a SECURITY DEFINER body.
    expect(bootstrap).not.toMatch(/EXECUTE\s+format|EXECUTE\s+'/i);
  });

  test("retention is delegated, names terminal statuses, and is within bounds; every table has a subject-data answer", () => {
    const lifecycle = telegramDeliveryModule.dataLifecycle ?? [];

    expect(lifecycle.map((d) => d.tableName).sort()).toEqual([
      "awcms_telegram_bindings",
      "awcms_telegram_delivery_attempts",
      "awcms_telegram_link_codes",
      "awcms_telegram_messages",
      "awcms_telegram_settings"
    ]);

    for (const descriptor of lifecycle) {
      expect(descriptor.executionMode).toBe("delegated");
      expect(descriptor.defaultRetentionDays).toBeGreaterThanOrEqual(
        descriptor.retentionMinDays
      );
      expect(descriptor.defaultRetentionDays).toBeLessThanOrEqual(
        descriptor.retentionMaxDays
      );
    }

    const byKey = new Map(lifecycle.map((d) => [d.key, d]));

    expect(byKey.get("telegram_delivery.messages")?.defaultRetentionDays).toBe(
      14
    );
    expect(byKey.get("telegram_delivery.bindings")?.defaultRetentionDays).toBe(
      90
    );
    expect(
      byKey.get("telegram_delivery.link_codes")?.defaultRetentionDays
    ).toBe(1);
    expect(
      (telegramDeliveryModule.subjectData ?? []).map((d) => d.tableName).sort()
    ).toEqual(lifecycle.map((d) => d.tableName).sort());
  });

  test("the binding subject-data answer overwrites the ciphertext and the hash, and never exports them", () => {
    const binding = telegramDeliveryModule.subjectData!.find(
      (d) => d.tableName === "awcms_telegram_bindings"
    )!;

    expect(binding.erasure).toBe("anonymize");
    expect(binding.anonymizedColumns).toEqual(
      expect.arrayContaining(["chat_ciphertext", "chat_hash", "chat_masked"])
    );
    expect(binding.redactedColumns).toEqual(
      expect.arrayContaining(["chat_ciphertext", "chat_hash"])
    );
  });
});

// ---------------------------------------------------------------------------
describe("audit M4: registry hardening beyond the name list", () => {
  test("digit-only references of 8+ digits are dropped (a phone, a national id), shorter ones kept", () => {
    expect(isValidTelegramVariableValue("reference", "12345678")).toBe(false);
    expect(isValidTelegramVariableValue("reference", "6281234567890")).toBe(
      false
    );
    expect(isValidTelegramVariableValue("reference", "1234567")).toBe(true);
    expect(isValidTelegramVariableValue("reference", "R-12345678")).toBe(true);
  });

  test("Indonesian words, English plurals and pay synonyms are denied", () => {
    for (const name of [
      "nama",
      "namaLengkap",
      "alamat",
      "telp",
      "hp",
      "gaji",
      "upah",
      "bonus",
      "wages",
      "salaries",
      "payee",
      "grossAmount",
      "net",
      "commission",
      "payouts",
      "names",
      "emails",
      "addresses"
    ]) {
      expect(deniedWordInVariableName(name)).not.toBeNull();
    }

    for (const name of ["count", "resource", "job", "failures", "tenant"]) {
      expect(deniedWordInVariableName(name)).toBeNull();
    }
  });
});

describe("audit N3: pay, earnings, payment, statement and slip wording is refused", () => {
  const owners = () => [{ key: "booking" }];

  test.each([
    "Your pay statement is ready",
    "Earnings summary for the week",
    "Payment received",
    "Open the slip",
    "Statement ready"
  ])("%s", (body) => {
    expect(() =>
      registerTelegramTemplate(
        {
          ownerModuleKey: "booking",
          key: "booking.n3_check",
          version: 1,
          purpose: "staff_ops",
          body,
          variables: []
        },
        { owners }
      )
    ).toThrow(/payroll term/);
  });
});
