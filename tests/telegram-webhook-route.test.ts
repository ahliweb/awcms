/**
 * `POST /api/v1/telegram/webhook` as a real handler, without a database
 * (Issue #965, ADR-0140 section 7).
 *
 * What it proves is the ORDER: the cheap refusals come first and do no work.
 *
 * - off means `404`, before the secret is even compared;
 * - a missing or wrong secret is a `401`, an unset server secret refuses
 *   everything, and none of them reads the body or touches the database (the test
 *   points `DATABASE_URL` nowhere and passes a body that would throw if read);
 * - repeated wrong secrets from one address are throttled to `429`;
 * - once the secret is right, a malformed body is a `400`, and an update the
 *   handler ignores is a `200` with no reply.
 *
 * The two commands themselves are proved against PostgreSQL in
 * `tests/integration/telegram-delivery.integration.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resetRateLimitForTests } from "../src/lib/security/rate-limit";
import {
  pendingWebhookRejections,
  resetWebhookRejectionsForTests
} from "../src/modules/telegram-delivery/application/telegram-webhook-guard";
import { POST } from "../src/pages/api/v1/telegram/webhook";

const SECRET = "w".repeat(8) + "0123456789abcdefghijklmnopABCDEFGH_-";
const HEADER = "x-telegram-bot-api-secret-token";

const saved = { ...process.env };

function call(
  init: {
    secret?: string | null;
    body?: BodyInit;
    address?: string;
  } = {}
) {
  const headers = new Headers({ "content-type": "application/json" });

  if (init.secret !== null) {
    headers.set(HEADER, init.secret ?? SECRET);
  }

  return POST({
    request: new Request("https://erp.example.test/api/v1/telegram/webhook", {
      method: "POST",
      headers,
      body: init.body ?? JSON.stringify({ update_id: 1 })
    }),
    clientAddress: init.address ?? "203.0.113.7"
  } as unknown as Parameters<typeof POST>[0]) as Promise<Response>;
}

/** A body whose first read throws: proves the route never reads it. */
function explodingBody(): ReadableStream {
  return new ReadableStream({
    pull() {
      throw new Error("the body was read before the secret was verified");
    }
  });
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

describe("the webhook refuses cheaply and in order", () => {
  test("off means 404, with the secret never consulted", async () => {
    delete process.env.TELEGRAM_ENABLED;

    const response = await call({ secret: null });

    expect(response.status).toBe(404);
    expect(pendingWebhookRejections()).toEqual({});
  });

  test("a missing secret is a 401 and the body is never read", async () => {
    const response = await call({
      secret: null,
      body: explodingBody() as unknown as BodyInit
    });

    expect(response.status).toBe(401);
    expect(pendingWebhookRejections()).toEqual({ header_absent: 1 });
  });

  test("a wrong secret is a 401 and the body is never read", async () => {
    const response = await call({
      secret: SECRET.slice(0, -1) + "X",
      body: explodingBody() as unknown as BodyInit
    });

    expect(response.status).toBe(401);
    expect(pendingWebhookRejections()).toEqual({ header_mismatch: 1 });
  });

  test("an unset or malformed server secret refuses EVERYTHING, even a matching header", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await call({ secret: "" })).status).toBe(401);
    expect((await call({ secret: SECRET })).status).toBe(401);

    process.env.TELEGRAM_WEBHOOK_SECRET = "short";
    expect((await call({ secret: "short" })).status).toBe(401);
  });

  test("the 401 says nothing about what failed", async () => {
    const response = await call({ secret: "nope" });
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).not.toContain(SECRET);
    expect(text.toLowerCase()).not.toContain("secret");
    expect(text.toLowerCase()).not.toContain("header");
  });

  test("repeated wrong secrets from one address are throttled; another address is not", async () => {
    let last = 0;

    for (let i = 0; i < 31; i += 1) {
      last = (await call({ secret: "wrong", address: "198.51.100.9" })).status;
    }

    expect(last).toBe(429);
    expect(
      (await call({ secret: "wrong", address: "198.51.100.10" })).status
    ).toBe(401);
  });
});

describe("with the right secret", () => {
  test("a malformed body is a 400", async () => {
    const response = await call({ body: "{not json" });

    expect(response.status).toBe(400);
    expect(pendingWebhookRejections()).toEqual({ malformed: 1 });
  });

  test("an update the handler ignores is a 200 with no reply, and needs no database", async () => {
    const response = await call({
      body: JSON.stringify({
        update_id: 2,
        message: {
          text: "hello there",
          chat: { id: 5, type: "private" },
          from: { id: 5, is_bot: false }
        }
      })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  test("a group message is ignored too, whatever it says", async () => {
    const response = await call({
      body: JSON.stringify({
        message: {
          text: "/stop",
          chat: { id: -1001, type: "supergroup" },
          from: { id: 5, is_bot: false }
        }
      })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });
});
