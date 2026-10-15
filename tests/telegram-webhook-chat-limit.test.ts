/**
 * The per-chat rate limit of `POST /api/v1/telegram/webhook` (Issue #1008, L3 of
 * the #965 audit), as a real handler without a database.
 *
 * Telegram calls the webhook from a handful of addresses, so the per-address
 * bucket cannot tell one noisy user from another: before this, one chat sending
 * enough messages used up the shared bucket and everyone behind the same
 * addresses got `429`. The per-chat bucket sits after the secret check and
 * BEFORE the per-address bucket, answers an over-limit chat `200` with nothing
 * (Telegram would retry a refusal) and spends nothing else.
 *
 * What this does NOT claim: the shared limiter fails open when Redis is
 * configured but down, so this is a fairness control and not a security
 * boundary. What bounds abuse regardless is the secret check, the 256-bit link
 * code and the database-counted PIN attempts (see the integration suite).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resetRateLimitForTests } from "../src/lib/security/rate-limit";
import {
  pendingWebhookRejections,
  resetWebhookRejectionsForTests,
  telegramChatRateLimitKey
} from "../src/modules/telegram-delivery/application/telegram-webhook-guard";
import { extractUpdateChatKey } from "../src/modules/telegram-delivery/domain/telegram-link-code";
import { POST } from "../src/pages/api/v1/telegram/webhook";

const SECRET = "w".repeat(8) + "0123456789abcdefghijklmnopABCDEFGH_-";
const HEADER = "x-telegram-bot-api-secret-token";

const saved = { ...process.env };

const privateMessage = (chatId: number, text = "hello there") =>
  JSON.stringify({
    update_id: chatId,
    message: {
      text,
      chat: { id: chatId, type: "private" },
      from: { id: chatId, is_bot: false }
    }
  });

function call(init: {
  secret?: string;
  body: string;
  address?: string;
}): Promise<Response> {
  return POST({
    request: new Request("https://erp.example.test/api/v1/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HEADER]: init.secret ?? SECRET
      },
      body: init.body
    }),
    clientAddress: init.address ?? "149.154.167.1"
  } as unknown as Parameters<typeof POST>[0]) as Promise<Response>;
}

beforeEach(() => {
  resetRateLimitForTests();
  resetWebhookRejectionsForTests();
  process.env.TELEGRAM_ENABLED = "true";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  process.env = { ...saved };
});

describe("the per-chat rate limit", () => {
  test("a noisy chat is answered 200 with nothing, is counted, and does not 429 another chat on the same address", async () => {
    // A small per-address allowance, so that if the noisy chat spent it the
    // second chat WOULD be refused.
    process.env.TELEGRAM_WEBHOOK_RATE_PER_MINUTE = "15";

    const statuses: number[] = [];

    for (let i = 0; i < 40; i += 1) {
      statuses.push((await call({ body: privateMessage(7001) })).status);
    }

    // Never a 429 for the noisy chat either, even beyond the ceiling.
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(pendingWebhookRejections().chat_rate_limited).toBe(30);

    const other = await call({ body: privateMessage(7002) });

    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({});
    expect(pendingWebhookRejections().rate_limited).toBeUndefined();
  });

  test("a per-address 429 gives the chat's charge back, so Telegram's retries cannot burn it (audit L1)", async () => {
    process.env.TELEGRAM_WEBHOOK_RATE_PER_MINUTE = "3";

    // Another chat uses up this address's allowance.
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await call({ body: privateMessage(7010), address: "10.9.9.9" })).status
      ).toBe(200);
    }

    // The chat's requests from that address are 429s ...
    for (let i = 0; i < 7; i += 1) {
      expect(
        (await call({ body: privateMessage(7011), address: "10.9.9.9" })).status
      ).toBe(429);
    }

    // ... and must not have spent its allowance: from another address it still
    // has all ten, using a fresh address per request.
    for (let i = 0; i < 10; i += 1) {
      expect(
        (await call({ body: privateMessage(7011), address: `10.8.8.${i}` }))
          .status
      ).toBe(200);
    }

    expect(pendingWebhookRejections().chat_rate_limited).toBeUndefined();
  });

  test("the first requests of a chat are not limited", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await call({ body: privateMessage(7003) })).status).toBe(200);
    }

    expect(pendingWebhookRejections()).toEqual({});
  });

  test("a wrong secret never reaches the per-chat bucket", async () => {
    for (let i = 0; i < 15; i += 1) {
      await call({ secret: "wrong", body: privateMessage(7004) });
    }

    expect(pendingWebhookRejections().chat_rate_limited).toBeUndefined();

    // ... so the chat still has its whole allowance once the secret is right.
    for (let i = 0; i < 10; i += 1) {
      expect(
        (await call({ body: privateMessage(7004), address: "198.51.100.77" }))
          .status
      ).toBe(200);
    }

    expect(pendingWebhookRejections().chat_rate_limited).toBeUndefined();
  });

  test("the limiter key carries no chat id and depends on the secret", () => {
    const key = telegramChatRateLimitKey("5551234567", SECRET);

    expect(key).toMatch(/^telegram-webhook-chat:[0-9a-f]{32}$/);
    expect(key).not.toContain("5551234567");
    expect(key).not.toBe(telegramChatRateLimitKey("5551234567", SECRET + "x"));
    expect(key).not.toBe(telegramChatRateLimitKey("5551234568", SECRET));
  });
});

describe("extractUpdateChatKey", () => {
  test("reads the chat of any message, including plain text and groups", () => {
    expect(
      extractUpdateChatKey({ message: { chat: { id: 5, type: "private" } } })
    ).toBe("5");
    expect(extractUpdateChatKey({ message: { chat: { id: -1001 } } })).toBe(
      "-1001"
    );
  });

  test("returns null when there is no usable chat", () => {
    expect(extractUpdateChatKey(null)).toBeNull();
    expect(extractUpdateChatKey({ update_id: 1 })).toBeNull();
    expect(extractUpdateChatKey({ message: {} })).toBeNull();
    expect(extractUpdateChatKey({ message: { chat: { id: "5" } } })).toBeNull();
    expect(extractUpdateChatKey({ message: { chat: { id: 1.5 } } })).toBeNull();
  });
});
