/**
 * Issue #963 (ADR-0133 phase 1) — `whatsapp_delivery` without a database.
 *
 * Pins the rules that would otherwise be "covered" by a test that cannot fail:
 *
 * - the phone number is normalised or REFUSED, never guessed, and the masked and
 *   hashed forms never contain the raw number;
 * - the template allow-list DROPS an unlisted variable (this is what keeps a
 *   payroll notice free of salary data, not caller discipline), and a security
 *   template must declare a secret;
 * - the consent rule: marketing needs a recorded opt-in, a security message is
 *   never blocked by an opt-out, and nothing about a segment is an input;
 * - provider failure mapping: retryable vs terminal vs "this number cannot
 *   receive WhatsApp", the adapter (not the dispatcher) feeds the circuit
 *   breaker, and a per-message rejection never trips it;
 * - no error text, log line or health result carries a number or a token;
 * - the module descriptor: delegated retention that names TERMINAL statuses,
 *   nine permissions mirrored by the seed, and a navigation entry.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import { whatsappDeliveryModule } from "../src/modules/whatsapp-delivery/module";
import {
  KNOWN_WHATSAPP_PROVIDERS,
  WHATSAPP_CIRCUIT_BREAKER_KEY,
  isKnownWhatsappProvider,
  isWhatsappEnabled,
  resolveWhatsappDefaultCountryCode,
  resolveWhatsappSendMaxRetries
} from "../src/modules/whatsapp-delivery/domain/whatsapp-config";
import { decideEligibility } from "../src/modules/whatsapp-delivery/domain/whatsapp-eligibility";
import {
  buildRecipientHashes,
  hashRecipient,
  maskRecipient,
  normalizePhoneNumber,
  parseRecipientHashKeys
} from "../src/modules/whatsapp-delivery/domain/whatsapp-recipient";
import { sanitizeProviderError } from "../src/modules/whatsapp-delivery/application/whatsapp-dispatch";
import { enqueueWhatsappMessage } from "../src/modules/whatsapp-delivery/application/whatsapp-enqueue";
import {
  WHATSAPP_MAX_RETRY_DELAY_MINUTES,
  evaluateWhatsappRetry
} from "../src/modules/whatsapp-delivery/domain/whatsapp-retry";
import {
  WhatsappTemplateRegistrationError,
  getWhatsappTemplate,
  listWhatsappTemplates,
  registerWhatsappTemplate,
  renderWhatsappTemplate,
  resetWhatsappTemplatesForTests
} from "../src/modules/whatsapp-delivery/domain/whatsapp-templates";
import {
  validateConsentGrantInput,
  validateSuppressionCreateInput
} from "../src/modules/whatsapp-delivery/domain/whatsapp-validation";
import { createFonnteWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/fonnte-provider";
import { createLogWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/log-whatsapp-provider";
import { createMetaCloudWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/meta-cloud-provider";
import { resolveWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/whatsapp-provider-resolver";
import type { WhatsappHttpClient } from "../src/modules/whatsapp-delivery/infrastructure/whatsapp-http-client";
import type { WhatsappSendRequest } from "../src/modules/whatsapp-delivery/domain/whatsapp-provider-contract";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NUMBER = "+6281234567890";
const OTHER_NUMBER = "+6289876543210";

const REQUEST: WhatsappSendRequest = {
  to: NUMBER,
  toMasked: maskRecipient(NUMBER),
  body: "Your code is 123456",
  templateKey: "system.notice",
  parameters: ["123456"],
  correlationId: "corr-1"
};

beforeEach(() => {
  resetProviderCircuitBreakersForTests();
  resetWhatsappTemplatesForTests();
});

describe("phone numbers are normalised or refused, never guessed", () => {
  test.each([
    ["+6281234567890", "+6281234567890"],
    ["+62 812-3456-7890", "+6281234567890"],
    ["(+62) 812.3456.7890", "+6281234567890"],
    ["006281234567890", "+6281234567890"]
  ])("accepts %j", (raw, expected) => {
    expect(normalizePhoneNumber(raw)).toEqual({ valid: true, e164: expected });
  });

  test("a national number needs a configured default country", () => {
    expect(normalizePhoneNumber("081234567890").valid).toBe(false);
    expect(normalizePhoneNumber("081234567890", "62")).toEqual({
      valid: true,
      e164: "+6281234567890"
    });
  });

  test.each([
    "",
    "abc",
    "+0123456789",
    "+12",
    "+1234567890123456",
    "+62812345; DROP TABLE x",
    "12345678"
  ])("refuses %j", (raw) => {
    expect(normalizePhoneNumber(raw, undefined).valid).toBe(false);
  });

  test("the default country code is digits only or it is ignored", () => {
    expect(
      resolveWhatsappDefaultCountryCode({ WHATSAPP_DEFAULT_COUNTRY_CODE: "62" })
    ).toBe("62");
    expect(
      resolveWhatsappDefaultCountryCode({
        WHATSAPP_DEFAULT_COUNTRY_CODE: "+62"
      })
    ).toBeUndefined();
    expect(resolveWhatsappDefaultCountryCode({})).toBeUndefined();
  });

  test("the mask never contains the raw number", () => {
    const masked = maskRecipient(NUMBER);

    expect(masked.endsWith("7890")).toBe(true);
    expect(masked).not.toContain("81234567");
  });
});

const KEY_A = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const KEY_B = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 251)
).toString("base64");
const RING = (value: string) =>
  parseRecipientHashKeys({ WHATSAPP_RECIPIENT_HASH_KEYS: value });

describe("the recipient hash is KEYED (audit F1)", () => {
  function okRing(value: string) {
    const ring = RING(value);

    if (!ring.ok) throw new Error(ring.reason);

    return ring;
  }

  test("the hash changes with the key, the tenant and the number, and carries the key id", () => {
    const a = okRing(`k1:${KEY_A}`).keys[0]!;
    const b = okRing(`k1:${KEY_B}`).keys[0]!;
    const other = "22222222-2222-4222-8222-222222222222";

    expect(hashRecipient(TENANT, NUMBER, a)).toMatch(/^k1:[0-9a-f]{64}$/);
    expect(hashRecipient(TENANT, NUMBER, a)).toBe(
      hashRecipient(TENANT, NUMBER, a)
    );
    expect(hashRecipient(TENANT, NUMBER, a)).not.toBe(
      hashRecipient(TENANT, NUMBER, b)
    );
    expect(hashRecipient(TENANT, NUMBER, a)).not.toBe(
      hashRecipient(other, NUMBER, a)
    );
    expect(hashRecipient(TENANT, NUMBER, a)).not.toBe(
      hashRecipient(TENANT, OTHER_NUMBER, a)
    );
  });

  test("it is NOT recoverable from the tenant id and the number alone", () => {
    const key = okRing(`k1:${KEY_A}`).keys[0]!;
    const hash = hashRecipient(TENANT, NUMBER, key).slice(3);
    const unkeyed = createHash("sha256")
      .update(`whatsapp:v1:${TENANT}:${NUMBER}`)
      .digest("hex");

    expect(hash).not.toBe(unkeyed);
    expect(hash).not.toContain("81234567");
  });

  test("the first key writes, every key is read, and a rotated ring still finds old rows", () => {
    const before = buildRecipientHashes(TENANT, NUMBER, okRing(`k1:${KEY_A}`));
    const after = buildRecipientHashes(
      TENANT,
      NUMBER,
      okRing(`k2:${KEY_B},k1:${KEY_A}`)
    );

    expect(after.primary.startsWith("k2:")).toBe(true);
    expect(after.all).toHaveLength(2);
    expect(after.all).toContain(before.primary);
  });

  test("no ring, a placeholder, a short or constant key, or a duplicate is refused", () => {
    expect(parseRecipientHashKeys({}).ok).toBe(false);
    expect(RING("").ok).toBe(false);
    expect(RING("nocolon").ok).toBe(false);
    expect(RING(`BAD ID:${KEY_A}`).ok).toBe(false);
    expect(RING("k1:c2hvcnQ=").ok).toBe(false);
    expect(RING(`k1:${Buffer.alloc(32, 7).toString("base64")}`).ok).toBe(false);
    expect(
      RING(
        `k1:${Buffer.from("changeme-changeme-changeme-chang").toString("base64")}`
      ).ok
    ).toBe(false);
    expect(RING(`k1:${KEY_A},k1:${KEY_B}`).ok).toBe(false);
    expect(RING(`k1:${KEY_A},k2:${KEY_A}`).ok).toBe(false);
    expect(RING(`k1:${KEY_A},k2:${KEY_B}`).ok).toBe(true);
  });

  test("enqueue with no usable ring is REFUSED before anything is written (fail closed)", async () => {
    const calls: string[] = [];
    const tx = new Proxy(
      {},
      {
        get: () => () => {
          calls.push("query");
        }
      }
    ) as never;

    for (const keys of [undefined, "", "k1:short"]) {
      const result = await enqueueWhatsappMessage(
        tx,
        {
          tenantId: TENANT,
          templateKey: "system.notice",
          variables: { message: "x" },
          recipient: { kind: "address", phone: NUMBER },
          idempotencyKey: "k"
        },
        {
          env: {
            WHATSAPP_ENABLED: "true",
            ...(keys === undefined
              ? {}
              : { WHATSAPP_RECIPIENT_HASH_KEYS: keys })
          } as NodeJS.ProcessEnv
        }
      );

      expect(result).toEqual({ status: "refused", reason: "MISCONFIGURED" });
    }
    expect(calls).toEqual([]);
  });
});

describe("provider error text is redacted before it is stored (audit F6)", () => {
  const row = {
    body: "Your code is 123456",
    variables: { code: "123456", name: "Sari" },
    contains_secret: false
  };

  test("a value echoed by the provider is replaced, whatever the row", () => {
    const text = sanitizeProviderError(
      "rejected: 'Your code is 123456' to Sari",
      row,
      "rejected"
    );

    expect(text).not.toContain("123456");
    expect(text).not.toContain("Sari");
    expect(text).toContain("[redacted]");
  });

  test("a secret-bearing row keeps NO provider detail", () => {
    const text = sanitizeProviderError(
      "anything incl. 123456",
      { ...row, contains_secret: true },
      "rejected"
    );

    expect(text).toBe("Provider reported rejected.");
  });
});

describe("the template registry enforces purpose and the variable allow-list", () => {
  test("an unlisted variable is DROPPED, not rendered", () => {
    registerWhatsappTemplate({
      key: "hr.payslip_ready",
      version: 1,
      purpose: "transactional",
      body: "Your payslip for {{period}} is ready.",
      variables: ["period"]
    });

    const rendered = renderWhatsappTemplate(
      getWhatsappTemplate("hr.payslip_ready")!,
      {
        period: "2026-09",
        netSalary: "12000000",
        bankAccount: "1234567890"
      }
    );

    expect(rendered.body).toBe("Your payslip for 2026-09 is ready.");
    expect(rendered.variables).toEqual({ period: "2026-09" });
    expect(rendered.droppedVariables.sort()).toEqual([
      "bankAccount",
      "netSalary"
    ]);
    expect(JSON.stringify(rendered)).not.toContain("12000000");
  });

  test("a placeholder naming an unlisted variable renders empty", () => {
    registerWhatsappTemplate({
      key: "booking.reminder",
      version: 1,
      purpose: "transactional",
      body: "Hi {{name}}, see {{secretThing}}.",
      variables: ["name"]
    });
    const rendered = renderWhatsappTemplate(
      getWhatsappTemplate("booking.reminder")!,
      {
        name: "Sari",
        secretThing: "leak"
      }
    );

    expect(rendered.body).toBe("Hi Sari, see .");
  });

  test("values lose control characters and are length-bounded", () => {
    const rendered = renderWhatsappTemplate(
      getWhatsappTemplate("system.notice")!,
      {
        message: `line1\n\r\u0000line2${"x".repeat(5000)}`
      }
    );

    expect(rendered.body).not.toMatch(/[\u0000-\u001f]/);
    expect(rendered.body.length).toBeLessThanOrEqual(1000);
  });

  test("a security template must declare a secret variable", () => {
    expect(() =>
      registerWhatsappTemplate({
        key: "auth.otp",
        version: 1,
        purpose: "security",
        body: "Code {{code}}",
        variables: ["code"]
      })
    ).toThrow(WhatsappTemplateRegistrationError);

    registerWhatsappTemplate({
      key: "auth.otp",
      version: 1,
      purpose: "security",
      body: "Code {{code}}",
      variables: ["code"],
      secretVariables: ["code"]
    });

    expect(
      renderWhatsappTemplate(getWhatsappTemplate("auth.otp")!, { code: "1" })
        .containsSecret
    ).toBe(true);
  });

  test("a key is registered once; a different definition under it conflicts", () => {
    const definition = {
      key: "booking.confirm",
      version: 1,
      purpose: "transactional" as const,
      body: "Booked.",
      variables: [] as string[]
    };
    registerWhatsappTemplate(definition);
    registerWhatsappTemplate({ ...definition });

    expect(() =>
      registerWhatsappTemplate({ ...definition, purpose: "marketing" })
    ).toThrow(WhatsappTemplateRegistrationError);
  });

  test("keys must be module-prefixed", () => {
    expect(() =>
      registerWhatsappTemplate({
        key: "noprefix",
        version: 1,
        purpose: "transactional",
        body: "x",
        variables: []
      })
    ).toThrow(WhatsappTemplateRegistrationError);
  });

  test("upstream ships only the neutral system.notice", () => {
    expect(listWhatsappTemplates().map((t) => t.key)).toEqual([
      "system.notice"
    ]);
  });
});

describe("the consent rule (ADR-0133 section 4)", () => {
  const none = { suppressionReason: null, consentStatus: null } as const;

  test("transactional needs no consent", () => {
    expect(decideEligibility("transactional", none)).toEqual({
      eligible: true
    });
  });

  test("marketing without a recorded opt-in is refused, not silently skipped", () => {
    expect(decideEligibility("marketing", none)).toEqual({
      eligible: false,
      kind: "consent_required"
    });
  });

  test("marketing with a granted consent is eligible", () => {
    expect(
      decideEligibility("marketing", {
        suppressionReason: null,
        consentStatus: "granted"
      })
    ).toEqual({ eligible: true });
  });

  test("a withdrawn consent is an opt-out", () => {
    expect(
      decideEligibility("marketing", {
        suppressionReason: null,
        consentStatus: "withdrawn"
      })
    ).toEqual({ eligible: false, kind: "suppressed", reason: "opt_out" });
  });

  test("a granted consent does not override a suppression", () => {
    expect(
      decideEligibility("marketing", {
        suppressionReason: "stop_reply",
        consentStatus: "granted"
      })
    ).toEqual({ eligible: false, kind: "suppressed", reason: "opt_out" });
  });

  test("a security message honours a hard failure only", () => {
    expect(
      decideEligibility("security", {
        suppressionReason: "hard_failure",
        consentStatus: null
      })
    ).toEqual({ eligible: false, kind: "suppressed", reason: "hard_failure" });
    for (const reason of ["stop_reply", "manual"] as const) {
      expect(
        decideEligibility("security", {
          suppressionReason: reason,
          consentStatus: "withdrawn"
        })
      ).toEqual({ eligible: true });
    }
  });

  test("a transactional message honours every suppression, a marketing opt-out does not hide it", () => {
    expect(
      decideEligibility("transactional", {
        suppressionReason: "manual",
        consentStatus: null
      })
    ).toEqual({ eligible: false, kind: "suppressed", reason: "opt_out" });
    expect(
      decideEligibility("transactional", {
        suppressionReason: null,
        consentStatus: "withdrawn"
      })
    ).toEqual({ eligible: true });
  });

  test("the rule takes no segment, list or audience input", () => {
    // The decision function's only inputs are the suppression and consent rows:
    // consent cannot be inferred from membership because membership is not an
    // argument. Pin the signature so adding one is a visible, reviewed change.
    expect(decideEligibility.length).toBe(2);
    const source = readFileSync(
      "src/modules/whatsapp-delivery/domain/whatsapp-eligibility.ts",
      "utf8"
    );
    expect(source).not.toMatch(/segment\w*\s*[:?]/i);
  });
});

describe("retry, config and validation", () => {
  test("backoff doubles and is capped", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    expect(evaluateWhatsappRetry(0, 3, now).nextAttemptAt).toEqual(
      new Date("2026-01-01T00:01:00Z")
    );
    expect(evaluateWhatsappRetry(2, 3, now).nextAttemptAt).toEqual(
      new Date("2026-01-01T00:04:00Z")
    );
    expect(evaluateWhatsappRetry(3, 3, now).eligible).toBe(false);
    expect(
      evaluateWhatsappRetry(20, 99, now).nextAttemptAt!.getTime() -
        now.getTime()
    ).toBe(WHATSAPP_MAX_RETRY_DELAY_MINUTES * 60_000);
  });

  test("off by default; zero retries survive; empty is unset", () => {
    expect(isWhatsappEnabled({})).toBe(false);
    expect(isWhatsappEnabled({ WHATSAPP_ENABLED: "yes" })).toBe(false);
    expect(isWhatsappEnabled({ WHATSAPP_ENABLED: "true" })).toBe(true);
    expect(
      resolveWhatsappSendMaxRetries({ WHATSAPP_SEND_MAX_RETRIES: "0" })
    ).toBe(0);
    expect(
      resolveWhatsappSendMaxRetries({ WHATSAPP_SEND_MAX_RETRIES: "" })
    ).toBe(3);
    expect(
      resolveWhatsappSendMaxRetries({ WHATSAPP_SEND_MAX_RETRIES: "-1" })
    ).toBe(3);
  });

  test("only the adapters that exist are known", () => {
    expect([...KNOWN_WHATSAPP_PROVIDERS]).toEqual(["log", "fonnte", "meta"]);
    expect(isKnownWhatsappProvider("twilio")).toBe(false);
    expect(isKnownWhatsappProvider(undefined)).toBe(false);
  });

  test("consent and suppression bodies are strict", () => {
    expect(
      validateConsentGrantInput({ phone: NUMBER, source: "admin" }).valid
    ).toBe(true);
    expect(
      validateConsentGrantInput({ phone: NUMBER, source: "Admin!" }).valid
    ).toBe(false);
    expect(
      validateConsentGrantInput({
        phone: NUMBER,
        source: "admin",
        recipientHash: "x"
      }).valid
    ).toBe(false);
    expect(validateConsentGrantInput([]).valid).toBe(false);
    expect(
      validateSuppressionCreateInput({ phone: NUMBER, reason: "manual" }).valid
    ).toBe(true);
    // An operator cannot forge a provider verdict.
    expect(
      validateSuppressionCreateInput({ phone: NUMBER, reason: "hard_failure" })
        .valid
    ).toBe(false);
  });
});

function fakeHttp(
  respond: (
    url: string,
    init: Parameters<WhatsappHttpClient>[1]
  ) => ReturnType<WhatsappHttpClient>
): {
  http: WhatsappHttpClient;
  calls: { url: string; headers: Record<string, string>; body: string }[];
} {
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];

  return {
    calls,
    http: async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });

      return respond(url, init);
    }
  };
}

const NOW = new Date("2026-01-01T00:00:00Z");

describe("Fonnte adapter", () => {
  function build(http: WhatsappHttpClient) {
    return createFonnteWhatsappProvider({
      token: "FONNTE-SECRET-TOKEN",
      timeoutMs: 1000,
      http,
      now: () => NOW
    });
  }

  test("success records the provider message id and feeds the breaker", async () => {
    const { http, calls } = fakeHttp(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ status: true, id: ["abc-1"] })
    }));
    const result = await build(http).send(REQUEST);

    expect(result).toEqual({ ok: true, providerMessageId: "abc-1" });
    expect(calls[0]!.headers.Authorization).toBe("FONNTE-SECRET-TOKEN");
    expect(calls[0]!.body).toContain("target=6281234567890");
    expect(
      getProviderCircuitBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY).getState(NOW)
    ).toBe("closed");
  });

  test("429 and 5xx are retryable and count against the breaker", async () => {
    for (const status of [429, 500, 503]) {
      const { http } = fakeHttp(async () => ({ ok: true, status, body: "" }));
      const result = await build(http).send(REQUEST);

      expect(result).toMatchObject({ ok: false, retryable: true });
    }
  });

  test("the breaker opens after repeated provider failures", async () => {
    const { http } = fakeHttp(async () => ({
      ok: true,
      status: 503,
      body: ""
    }));
    const provider = build(http);

    for (let i = 0; i < 20; i += 1) {
      await provider.send(REQUEST);
    }

    expect(
      getProviderCircuitBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY).canAttempt(NOW)
    ).toBe(false);
  });

  test("a free-text rejection is a failure of THIS message, never a permanent suppression (audit F7)", async () => {
    const { http } = fakeHttp(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        status: false,
        reason: "target invalid, not a whatsapp number"
      })
    }));
    const provider = build(http);

    for (let i = 0; i < 30; i += 1) {
      const result = await provider.send(REQUEST);

      expect(result).toMatchObject({
        ok: false,
        retryable: false,
        failureCode: "rejected"
      });
      expect(
        (result as { recipientInvalid?: boolean }).recipientInvalid
      ).toBeUndefined();
    }

    // And a per-message rejection never trips the breaker.
    expect(
      getProviderCircuitBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY).canAttempt(NOW)
    ).toBe(true);
  });

  test("a bad token is terminal configuration, not an outage", async () => {
    const { http } = fakeHttp(async () => ({
      ok: true,
      status: 401,
      body: "{}"
    }));

    expect(await build(http).send(REQUEST)).toMatchObject({
      ok: false,
      retryable: false,
      failureCode: "unauthorized"
    });
  });

  test("a network failure is retryable and its text carries no number", async () => {
    const { http } = fakeHttp(async () => ({
      ok: false,
      reason: `connect to ${NUMBER} failed (6281234567890)`
    }));
    const result = await build(http).send(REQUEST);

    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toContain("81234567");
  });
});

describe("Meta Cloud adapter", () => {
  function build(http: WhatsappHttpClient) {
    return createMetaCloudWhatsappProvider({
      accessToken: "META-SECRET-TOKEN",
      phoneNumberId: "123456789012",
      apiVersion: "v21.0",
      timeoutMs: 1000,
      http,
      now: () => NOW
    });
  }
  const approved = {
    ...REQUEST,
    providerTemplate: { name: "order_paid", language: "id" }
  };

  test("sends a template message with ordered parameters", async () => {
    const { http, calls } = fakeHttp(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ messages: [{ id: "wamid.1" }] })
    }));
    const result = await build(http).send(approved);
    const body = JSON.parse(calls[0]!.body);

    expect(result).toEqual({ ok: true, providerMessageId: "wamid.1" });
    expect(calls[0]!.url).toBe(
      "https://graph.facebook.com/v21.0/123456789012/messages"
    );
    expect(calls[0]!.headers.Authorization).toBe("Bearer META-SECRET-TOKEN");
    expect(body.type).toBe("template");
    expect(body.to).toBe("6281234567890");
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "123456" }
    ]);
  });

  test("no approved template fails terminally and never falls back to free text", async () => {
    const { http, calls } = fakeHttp(async () => ({
      ok: true,
      status: 200,
      body: "{}"
    }));
    const result = await build(http).send(REQUEST);

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      failureCode: "template_not_approved"
    });
    expect(calls).toHaveLength(0);
  });

  test("undeliverable number (131026) is a recipient verdict, not an outage", async () => {
    const { http } = fakeHttp(async () => ({
      ok: true,
      status: 400,
      body: JSON.stringify({
        error: { code: 131026, message: `Message undeliverable to ${NUMBER}` }
      })
    }));
    const result = await build(http).send(approved);

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      recipientInvalid: true
    });
    expect(JSON.stringify(result)).not.toContain("81234567");
  });

  test("rate limit and 5xx are retryable; an expired token is terminal", async () => {
    const cases: [number, unknown, boolean][] = [
      [429, { error: { code: 130429, message: "rate" } }, true],
      [500, {}, true],
      [401, { error: { code: 190, message: "token" } }, false]
    ];

    for (const [status, payload, retryable] of cases) {
      const { http } = fakeHttp(async () => ({
        ok: true,
        status,
        body: JSON.stringify(payload)
      }));

      expect(await build(http).send(approved)).toMatchObject({
        ok: false,
        retryable
      });
    }
  });

  test("the token never appears in a result", async () => {
    const { http } = fakeHttp(async () => ({
      ok: true,
      status: 401,
      body: JSON.stringify({
        error: { code: 190, message: "bad META-SECRET-TOKEN" }
      })
    }));

    expect(JSON.stringify(await build(http).send(approved))).not.toContain(
      "META-SECRET-TOKEN"
    );
  });
});

describe("provider resolution degrades instead of throwing", () => {
  test("a missing or unknown provider fails every send, non-retryably", async () => {
    for (const env of [{}, { WHATSAPP_PROVIDER: "twilio" }]) {
      const result = await resolveWhatsappProvider(
        env as NodeJS.ProcessEnv
      ).send(REQUEST);

      expect(result).toMatchObject({
        ok: false,
        retryable: false,
        failureCode: "misconfigured"
      });
    }
  });

  test("a real provider without its credential is misconfigured, not log", async () => {
    for (const env of [
      { WHATSAPP_PROVIDER: "fonnte" },
      { WHATSAPP_PROVIDER: "meta", WHATSAPP_META_ACCESS_TOKEN: "t" },
      {
        WHATSAPP_PROVIDER: "meta",
        WHATSAPP_META_ACCESS_TOKEN: "t",
        WHATSAPP_META_PHONE_NUMBER_ID: "not-digits"
      }
    ]) {
      const provider = resolveWhatsappProvider(env as NodeJS.ProcessEnv);

      expect(await provider.send(REQUEST)).toMatchObject({
        ok: false,
        failureCode: "misconfigured"
      });
      expect((await provider.healthCheck()).ok).toBe(false);
    }
  });

  test("the log provider records and always succeeds", async () => {
    const result = await resolveWhatsappProvider({
      WHATSAPP_PROVIDER: "log"
    } as NodeJS.ProcessEnv).send(REQUEST);

    expect(result.ok).toBe(true);
    expect(await createLogWhatsappProvider().healthCheck()).toEqual({
      ok: true
    });
  });
});

describe("static guarantees", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  test("the dispatcher never names the provider inside a transaction callback", () => {
    const source = stripComments(
      read("src/modules/whatsapp-delivery/application/whatsapp-dispatch.ts")
    );
    const callbacks =
      source.match(
        /withTenantOrThrow\([\s\S]*?\{ workClass: "background_sync" \}\s*\)/g
      ) ?? [];

    expect(callbacks.length).toBeGreaterThan(3);
    for (const callback of callbacks) {
      expect(callback).not.toContain("provider.send");
    }
    expect(source).toContain("await provider.send(");
  });

  test("enqueue and the queue code never touch a provider or the network", () => {
    for (const file of [
      "whatsapp-enqueue.ts",
      "whatsapp-consent-directory.ts",
      "whatsapp-diagnostics.ts"
    ]) {
      const source = stripComments(
        read(`src/modules/whatsapp-delivery/application/${file}`)
      );

      expect(source).not.toMatch(
        /\bfetch\(|ssrfSafeFetch|\.send\(|resolveWhatsappProvider/
      );
    }
  });

  test("the raw number column is selected only where delivery needs it", () => {
    // The consent directory reads the number ONLY to re-hash it under every ring
    // key when cancelling waiting messages; it never returns it.
    const allowed = new Set([
      "whatsapp-dispatch.ts",
      "whatsapp-enqueue.ts",
      "whatsapp-consent-directory.ts"
    ]);

    for (const file of [
      "whatsapp-consent-directory.ts",
      "whatsapp-diagnostics.ts",
      "whatsapp-dispatch.ts",
      "whatsapp-enqueue.ts",
      "whatsapp-queue-purge.ts"
    ]) {
      const source = stripComments(
        read(`src/modules/whatsapp-delivery/application/${file}`)
      );
      const selectsRaw = /(?:SELECT|RETURNING)[^;`]*\brecipient\b(?!_)/s.test(
        source
      );

      expect(selectsRaw).toBe(allowed.has(file) && selectsRaw);
    }
  });

  test("no route returns the raw recipient, body or variable values", () => {
    for (const route of [
      "diagnostics.ts",
      "suppressions/index.ts",
      "consents/index.ts"
    ]) {
      const source = stripComments(read(`src/pages/api/v1/whatsapp/${route}`));

      expect(source).not.toMatch(
        /\.recipient\b(?!Masked)|\.body\b|\.variables\b/
      );
    }

    // The template list shows the allow-list NAMES, never the wording.
    expect(
      stripComments(read("src/pages/api/v1/whatsapp/templates.ts"))
    ).not.toMatch(/\.body\b/);
  });
});

describe("module descriptor", () => {
  test("retention is delegated and the purge names terminal statuses", () => {
    const purge = readFileSync(
      "src/modules/whatsapp-delivery/application/whatsapp-queue-purge.ts",
      "utf8"
    );

    for (const descriptor of whatsappDeliveryModule.dataLifecycle ?? []) {
      expect(descriptor.executionMode).toBe("delegated");
    }
    expect(purge).toContain(
      "m.status IN ('sent', 'failed', 'cancelled', 'expired')"
    );
    // Only the DELETE statements are held to terminal statuses: the separate
    // expiry UPDATE legitimately targets non-terminal rows.
    for (const statement of purge.match(/DELETE FROM[\s\S]*?RETURNING id/g) ??
      []) {
      expect(statement).not.toMatch(/'queued'|'retry_wait'|'sending'/);
    }
    expect(purge).not.toContain("awcms_whatsapp_consents");
    expect(purge).not.toContain("awcms_whatsapp_suppressions");
  });

  test("every table of the module has a retention and a subject-data descriptor", () => {
    const tables = [
      "awcms_whatsapp_messages",
      "awcms_whatsapp_delivery_attempts",
      "awcms_whatsapp_consents",
      "awcms_whatsapp_suppressions"
    ];

    expect(
      (whatsappDeliveryModule.dataLifecycle ?? [])
        .map((d) => d.tableName)
        .sort()
    ).toEqual([...tables].sort());
    expect(
      (whatsappDeliveryModule.subjectData ?? []).map((d) => d.tableName).sort()
    ).toEqual([...tables].sort());
  });

  test("the ten permissions mirror the sql/179 seed exactly", () => {
    const seed = readFileSync(
      "sql/179_awcms_whatsapp_delivery_permissions.sql",
      "utf8"
    );
    const seeded = [
      ...seed.matchAll(/\('whatsapp_delivery', '(\w+)', '(\w+)'/g)
    ]
      .map((m) => `${m[1]}.${m[2]}`)
      .sort();
    const declared = (whatsappDeliveryModule.permissions ?? [])
      .map((p) => `${p.activityCode}.${p.action}`)
      .sort();

    expect(declared).toHaveLength(10);
    expect(declared).toEqual(seeded);
  });

  test("ships inert: the flag is off by default and nothing else turns it on", () => {
    expect(isWhatsappEnabled({})).toBe(false);
    expect(readFileSync(".env.example", "utf8")).toContain(
      "# WHATSAPP_ENABLED=false"
    );
  });

  test("the admin screen has a navigation entry gated on a seeded permission", () => {
    expect(whatsappDeliveryModule.navigation).toEqual([
      expect.objectContaining({
        path: "/admin/whatsapp",
        requiredPermission: "whatsapp_delivery.messages.read"
      })
    ]);
  });
});
