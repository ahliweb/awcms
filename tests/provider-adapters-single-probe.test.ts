/**
 * Issue #1409 — the WhatsApp (Fonnte, Meta Cloud, StarSender), Telegram and
 * push (Web Push, FCM) adapters reserve the half-open probe PER PROVIDER CALL.
 *
 * The dispatchers only PEEK (`wouldAllowAttempt`) once per pass, so before this
 * a `half_open` breaker let every message of a batch through. The adapter is the
 * one place every send passes, so it is where `tryAcquire` lives. The clock is
 * injected; nothing here sleeps.
 *
 * Every test drives `N` sends AT ONCE against an HTTP seam that never answers
 * until released, which is the shape that exposed the gap: all callers ask
 * before the first one reports back.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import { TELEGRAM_CIRCUIT_BREAKER_KEY } from "../src/modules/telegram-delivery/domain/telegram-constants";
import type { TelegramSendRequest } from "../src/modules/telegram-delivery/domain/telegram-provider-contract";
import { createTelegramBotProvider } from "../src/modules/telegram-delivery/infrastructure/telegram-bot-provider";
import {
  WHATSAPP_CIRCUIT_BREAKER_KEY,
  whatsappSenderBreakerKey
} from "../src/modules/whatsapp-delivery/domain/whatsapp-config";
import type {
  WhatsappProvider,
  WhatsappSendRequest
} from "../src/modules/whatsapp-delivery/domain/whatsapp-provider-contract";
import { createFonnteWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/fonnte-provider";
import { createMetaCloudWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/meta-cloud-provider";
import { createStarsenderWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/starsender-provider";
import type { WhatsappHttpResult } from "../src/modules/whatsapp-delivery/infrastructure/whatsapp-http-client";

const T0 = new Date("2026-11-22T00:00:00.000Z");
/** Past the default 30s open window, so the breaker is half_open. */
const HALF_OPEN_AT = new Date(T0.getTime() + 31_000);
const BATCH = 8;

const WA_REQUEST: WhatsappSendRequest = {
  to: "+6281234567890",
  toMasked: "+*********7890",
  body: "Hello",
  templateKey: "booking.reminder",
  providerTemplate: { name: "booking_reminder", language: "id" },
  parameters: []
};
const TG_REQUEST: TelegramSendRequest = {
  chatId: "12345",
  text: "Hello",
  templateKey: "booking.alert"
};

afterEach(() => {
  resetProviderCircuitBreakersForTests();
});

function tripBreaker(key: string): void {
  const breaker = getProviderCircuitBreaker(key);

  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0);
}

/** An HTTP seam that counts calls and holds every one until `release` is called. */
function gatedHttp<T>(answer: T) {
  let calls = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });

  return {
    http: async () => {
      calls += 1;
      await gate;

      return answer;
    },
    calls: () => calls,
    release: () => open()
  };
}

const OK_JSON: WhatsappHttpResult = {
  ok: true,
  status: 200,
  body: JSON.stringify({ status: true, id: ["1"] })
};

async function exercise(
  send: () => Promise<{ ok: boolean; skipped?: true }>,
  seam: { calls: () => number; release: () => void },
  breakerKey: string
): Promise<void> {
  tripBreaker(breakerKey);

  const breaker = getProviderCircuitBreaker(breakerKey);

  expect(breaker.getState(HALF_OPEN_AT)).toBe("half_open");

  const pending = Array.from({ length: BATCH }, () => send());

  // Let every send run up to its first await; only the probe reached the wire.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(seam.calls()).toBe(1);

  seam.release();

  const results = await Promise.all(pending);

  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => result.skipped === true)).toHaveLength(
    BATCH - 1
  );
  expect(seam.calls()).toBe(1);

  // The probe succeeded: the breaker is closed and the next send goes out.
  expect(breaker.getState(HALF_OPEN_AT)).toBe("closed");
}

describe("half-open: one provider call per breaker, the rest skipped (Issue #1409)", () => {
  test("Fonnte", async () => {
    const seam = gatedHttp(OK_JSON);
    const provider = createFonnteWhatsappProvider({
      token: "tok",
      timeoutMs: 1000,
      http: seam.http,
      now: () => HALF_OPEN_AT
    });

    await exercise(
      () => provider.send(WA_REQUEST),
      seam,
      WHATSAPP_CIRCUIT_BREAKER_KEY
    );
  });

  test("Meta Cloud", async () => {
    const seam = gatedHttp({
      ok: true,
      status: 200,
      body: JSON.stringify({ messages: [{ id: "wamid.1" }] })
    } satisfies WhatsappHttpResult);
    const provider = createMetaCloudWhatsappProvider({
      accessToken: "tok",
      phoneNumberId: "1",
      apiVersion: "v21.0",
      timeoutMs: 1000,
      http: seam.http,
      now: () => HALF_OPEN_AT
    });

    await exercise(
      () => provider.send(WA_REQUEST),
      seam,
      WHATSAPP_CIRCUIT_BREAKER_KEY
    );
  });

  test("StarSender, per device key", async () => {
    const key = whatsappSenderBreakerKey(
      "11111111-1111-4111-8111-111111111111"
    );
    const seam = gatedHttp({
      ok: true,
      status: 200,
      body: JSON.stringify({ success: true, data: {}, message: "ok" })
    } satisfies WhatsappHttpResult);
    const provider = createStarsenderWhatsappProvider({
      deviceKey: "device-key-abcdefgh",
      timeoutMs: 1000,
      breakerKey: key,
      http: seam.http,
      now: () => HALF_OPEN_AT
    }) as WhatsappProvider;

    await exercise(() => provider.send(WA_REQUEST), seam, key);
  });

  test("Telegram", async () => {
    const seam = gatedHttp({
      ok: true,
      status: 200,
      body: JSON.stringify({ ok: true, result: { message_id: 7 } })
    } as { ok: true; status: number; body: string });
    const provider = createTelegramBotProvider({
      token: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678",
      timeoutMs: 1000,
      minSendIntervalMs: 0,
      retryAfterCapSeconds: 60,
      http: seam.http,
      now: () => HALF_OPEN_AT,
      sleep: async () => {}
    });

    await exercise(
      () => provider.send(TG_REQUEST),
      seam,
      TELEGRAM_CIRCUIT_BREAKER_KEY
    );
  });
});

describe("a call that gives the breaker no verdict hands the probe back", () => {
  test("a 401 (credential problem) frees the half-open probe for the next send", async () => {
    tripBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY);

    const answers: WhatsappHttpResult[] = [
      { ok: true, status: 401, body: "{}" },
      OK_JSON
    ];
    let calls = 0;
    const provider = createFonnteWhatsappProvider({
      token: "tok",
      timeoutMs: 1000,
      http: async () => answers[calls++]!,
      now: () => HALF_OPEN_AT
    });

    expect(await provider.send(WA_REQUEST)).toMatchObject({
      ok: false,
      failureCode: "unauthorized"
    });
    // Not held until the probe expires: the very next send is the new probe.
    expect(await provider.send(WA_REQUEST)).toMatchObject({ ok: true });
    expect(calls).toBe(2);
  });
});

describe("isolation per breaker key", () => {
  test("a half-open probe held on one sender never skips another sender", async () => {
    const keyA = whatsappSenderBreakerKey(
      "11111111-1111-4111-8111-111111111111"
    );
    const keyB = whatsappSenderBreakerKey(
      "22222222-2222-4222-8222-222222222222"
    );

    tripBreaker(keyA);
    tripBreaker(keyB);

    const held = gatedHttp(OK_JSON);
    const free = gatedHttp(OK_JSON);
    const make = (key: string, http: typeof held.http) =>
      createStarsenderWhatsappProvider({
        deviceKey: "device-key-abcdefgh",
        timeoutMs: 1000,
        breakerKey: key,
        http: async () => {
          await http();

          return {
            ok: true,
            status: 200,
            body: JSON.stringify({ success: true, data: {}, message: "ok" })
          };
        },
        now: () => HALF_OPEN_AT
      }) as WhatsappProvider;
    const a = make(keyA, held.http);
    const b = make(keyB, free.http);

    const probeA = a.send(WA_REQUEST);
    const skippedA = await a.send(WA_REQUEST);
    const probeB = b.send(WA_REQUEST);

    expect(skippedA).toMatchObject({ ok: false, skipped: true });

    free.release();
    held.release();

    expect(await probeB).toMatchObject({ ok: true });
    expect(await probeA).toMatchObject({ ok: true });
  });
});
