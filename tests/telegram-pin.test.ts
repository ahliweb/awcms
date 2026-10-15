/**
 * The verification PIN, the runtime key-ring distinctness check and the shape of
 * migration 288 (Issue #1008). Pure: no database, no network. The behaviour
 * against PostgreSQL (attempt counting under the row lock, the trigger, the
 * replay) is in `tests/integration/telegram-delivery.integration.test.ts`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { resolveKeyRing } from "../src/lib/security/field-encryption";
import {
  resolveTelegramEncryptionRing,
  resolveTelegramEncryptionRingUnchecked,
  resolveTelegramHashRing,
  telegramRingsShareAKey
} from "../src/modules/telegram-delivery/domain/telegram-config";
import {
  PIN_LENGTH,
  PIN_MAX_ATTEMPTS,
  generateVerificationPin,
  hashVerificationPin,
  isWellFormedPin,
  verifyVerificationPin
} from "../src/modules/telegram-delivery/domain/telegram-pin";
import { parseConfirmBody } from "../src/modules/telegram-delivery/application/telegram-interactive-guard";
import { telegramReplyLinked } from "../src/modules/telegram-delivery/domain/telegram-link-code";

const key = (seed: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * seed + 5) % 251)
  ).toString("base64");

const HASH_ENV = { TELEGRAM_CHAT_HASH_KEYS: `k1:${key(13)}` };
const ring = (env: Record<string, string>, name: string) => {
  const result = resolveKeyRing(name, env, { strict: true } as never);

  if (!result.ok) {
    throw new Error(result.reason);
  }

  return result;
};

const TENANT = "11111111-1111-4111-8111-111111111111";
const BINDING = "22222222-2222-4222-8222-222222222222";

describe("the verification PIN", () => {
  test("is six digits, drawn with leading zeros preserved", () => {
    const seen = new Set<string>();

    for (let i = 0; i < 300; i += 1) {
      const pin = generateVerificationPin();

      expect(pin).toHaveLength(PIN_LENGTH);
      expect(isWellFormedPin(pin)).toBe(true);
      seen.add(pin);
    }

    expect(seen.size).toBeGreaterThan(250);
  });

  test("only six ASCII digits are well formed", () => {
    for (const bad of [
      "12345",
      "1234567",
      "12345a",
      " 12345",
      "١٢٣٤٥٦",
      "",
      123456,
      null,
      undefined
    ]) {
      expect(isWellFormedPin(bad)).toBe(false);
    }
  });

  test("verifies the right PIN and refuses a wrong one, another binding's, another tenant's and a missing hash", () => {
    const hashRing = ring(
      HASH_ENV as Record<string, string>,
      "TELEGRAM_CHAT_HASH_KEYS"
    );
    const stored = hashVerificationPin("123456", TENANT, BINDING, hashRing);

    expect(stored).toMatch(/^k1:[0-9a-f]{64}$/);
    expect(stored).not.toContain("123456");
    expect(
      verifyVerificationPin("123456", stored, TENANT, BINDING, hashRing)
    ).toBe(true);
    expect(
      verifyVerificationPin("123457", stored, TENANT, BINDING, hashRing)
    ).toBe(false);
    expect(
      verifyVerificationPin(
        "123456",
        stored,
        TENANT,
        "33333333-3333-4333-8333-333333333333",
        hashRing
      )
    ).toBe(false);
    expect(
      verifyVerificationPin(
        "123456",
        stored,
        "44444444-4444-4444-8444-444444444444",
        BINDING,
        hashRing
      )
    ).toBe(false);
    expect(
      verifyVerificationPin("123456", null, TENANT, BINDING, hashRing)
    ).toBe(false);
    expect(
      verifyVerificationPin("12345", stored, TENANT, BINDING, hashRing)
    ).toBe(false);
  });

  test("a PIN hashed before a ring rotation still verifies", () => {
    const old = ring(
      HASH_ENV as Record<string, string>,
      "TELEGRAM_CHAT_HASH_KEYS"
    );
    const stored = hashVerificationPin("654321", TENANT, BINDING, old);
    const rotated = ring(
      { TELEGRAM_CHAT_HASH_KEYS: `k2:${key(17)},k1:${key(13)}` },
      "TELEGRAM_CHAT_HASH_KEYS"
    );

    expect(
      verifyVerificationPin("654321", stored, TENANT, BINDING, rotated)
    ).toBe(true);
  });

  test("five wrong answers are tolerated, and the reply carries the PIN once, in both languages", () => {
    expect(PIN_MAX_ATTEMPTS).toBe(5);

    const reply = telegramReplyLinked("Acme", "042042");

    expect(reply).toContain("PIN is 042042");
    expect(reply).toContain("PIN verifikasi Anda adalah 042042");
    expect(reply.match(/042042/g)).toHaveLength(2);
  });

  test("the confirm body is exactly { bindingId, pin }", () => {
    const id = "2f0b7c4e-9d1a-4c3b-8a5e-6d7f8091a2b3";

    expect(parseConfirmBody({ bindingId: id, pin: "123456" })).toEqual({
      bindingId: id,
      pin: "123456"
    });
    expect(parseConfirmBody({ bindingId: id })).toBeNull();
    expect(parseConfirmBody({ pin: "123456" })).toBeNull();
    expect(parseConfirmBody({ bindingId: id, pin: "12345" })).toBeNull();
    expect(parseConfirmBody({ bindingId: id, pin: 123456 })).toBeNull();
    expect(
      parseConfirmBody({ bindingId: id, pin: "123456", extra: 1 })
    ).toBeNull();
    expect(parseConfirmBody([id, "123456"])).toBeNull();
    expect(parseConfirmBody(null)).toBeNull();
  });
});

describe("L11: the rings must be distinct at runtime", () => {
  const enc = key(7);
  const hash = key(13);

  test("distinct rings resolve", () => {
    const env = {
      TELEGRAM_CHAT_ENCRYPTION_KEYS: `k1:${enc}`,
      TELEGRAM_CHAT_HASH_KEYS: `k1:${hash}`
    } as NodeJS.ProcessEnv;

    expect(resolveTelegramEncryptionRing(env).ok).toBe(true);
    expect(resolveTelegramHashRing(env).ok).toBe(true);
  });

  test("a shared key (under any key id, in any position) fails BOTH closed, while the unchecked resolver still reads the ring", () => {
    const env = {
      TELEGRAM_CHAT_ENCRYPTION_KEYS: `k1:${enc},k2:${hash}`,
      TELEGRAM_CHAT_HASH_KEYS: `k9:${hash}`
    } as NodeJS.ProcessEnv;

    expect(resolveTelegramEncryptionRing(env).ok).toBe(false);
    expect(resolveTelegramHashRing(env).ok).toBe(false);
    expect(resolveTelegramEncryptionRingUnchecked(env).ok).toBe(true);
    expect(
      telegramRingsShareAKey(resolveTelegramEncryptionRingUnchecked(env), {
        ok: false,
        reason: "x"
      })
    ).toBe(false);
  });

  test("an unset ring is still just unavailable", () => {
    expect(resolveTelegramHashRing({} as NodeJS.ProcessEnv).ok).toBe(false);
  });
});

describe("migration 288", () => {
  const sql = readFileSync(
    "sql/288_awcms_telegram_binding_pin_proof.sql",
    "utf8"
  );

  test("adds the two columns, a PIN-only-while-pending CHECK and a bounded counter", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS pin_hash text");
    expect(sql).toContain("pin_attempts smallint NOT NULL DEFAULT 0");
    expect(sql).toContain("awcms_telegram_bindings_pin_hash_check");
    expect(sql).toContain("status = 'pending_confirmation'");
    expect(sql).toContain("awcms_telegram_bindings_pin_attempts_check");
  });

  test("the worker gets UPDATE on the one column it needs to clear, and the trigger bounds what it may write", () => {
    expect(sql).toContain(
      "GRANT UPDATE (pin_hash) ON awcms_telegram_bindings TO awcms_worker;"
    );
    expect(sql).not.toMatch(/GRANT[^;]*pin_attempts[^;]*awcms_worker/);
    expect(sql).toContain("awcms_telegram_bindings_pin_guard");
    expect(sql).toContain("current_user = 'awcms_app'");
    expect(sql).toContain("NEW.pin_attempts < OLD.pin_attempts");
  });

  test("creates no table, so RLS and lifecycle coverage are unchanged", () => {
    expect(sql).not.toMatch(/CREATE TABLE/i);
  });
});
