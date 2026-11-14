/**
 * StarSender per-device adapter, the parts that need no database (Issue #1142,
 * ADR-0148 section 4 and 7): the wire contract over fixtures, the adapter's
 * properties (allowlisted endpoint, no redirect, per-device breaker, fixed error
 * text, accepted is not delivered), the factory and its flag, the risk text
 * catalogue and its fail-closed approval, the port decisions through a scripted
 * transaction, and the structural facts that keep "no webhook, no fallback, no
 * second queue" true.
 *
 * The properties that live in PostgreSQL (the acknowledgement table, the
 * `connected` guard, revocation, the dispatcher's hold of a disconnected device)
 * are in `tests/integration/starsender-adapter.integration.test.ts`.
 *
 * FIXTURES ARE NOT LIVE TRAFFIC: see `tests/fixtures/starsender/contract-fixtures.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import { createChannelAccountPortAdapter } from "../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { validateAcknowledgeRisk } from "../src/modules/channel-accounts/domain/channel-accounts-validation";
import {
  PROVIDER_MATRIX,
  PROVIDER_MATRIX_VERSION
} from "../src/modules/channel-accounts/domain/provider-matrix";
import {
  describeRiskAcknowledgement,
  hashRiskText,
  overrideRiskAcknowledgementCatalogueForTests,
  resolveRiskAcknowledgement,
  STARSENDER_RISK_TEXT_VERSION,
  type RiskAcknowledgementEntry
} from "../src/modules/channel-accounts/domain/risk-acknowledgements";
import {
  buildStarsenderRequestBody,
  classifyStarsenderResponse,
  isPlausibleStarsenderDeviceKey,
  STARSENDER_ALLOWED_ORIGIN,
  STARSENDER_SEND_URL
} from "../src/modules/whatsapp-delivery/domain/starsender-contract";
import { whatsappSenderBreakerKey } from "../src/modules/whatsapp-delivery/domain/whatsapp-config";
import { classifySenderUnavailable } from "../src/modules/whatsapp-delivery/domain/whatsapp-sender";
import type { WhatsappSendRequest } from "../src/modules/whatsapp-delivery/domain/whatsapp-provider-contract";
import { createStarsenderWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/starsender-provider";
import type {
  WhatsappHttpClient,
  WhatsappHttpRequest
} from "../src/modules/whatsapp-delivery/infrastructure/whatsapp-http-client";
import {
  buildWhatsappSenderProvider,
  hasWhatsappSenderAdapter
} from "../src/modules/whatsapp-delivery/infrastructure/whatsapp-sender-providers";
import {
  DEVICE_KEY_A,
  DEVICE_KEY_B,
  FIXTURES,
  type HttpAnswer
} from "./fixtures/starsender/contract-fixtures";

const T1 = "11111111-1111-4111-8111-111111111111";
const D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const D2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ON = {
  WHATSAPP_STARSENDER_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;

const REQUEST: WhatsappSendRequest = {
  to: "+6281234567890",
  toMasked: "+*********7890",
  body: "Your appointment is tomorrow at 9.",
  templateKey: "booking.reminder",
  parameters: []
};

type Call = { url: string; request: WhatsappHttpRequest };

function fakeHttp(answer: (call: Call) => HttpAnswer): {
  http: WhatsappHttpClient;
  calls: Call[];
} {
  const calls: Call[] = [];

  return {
    calls,
    http: async (url, request) => {
      const call = { url, request };

      calls.push(call);
      const result = answer(call);

      return "reason" in result
        ? { ok: false, reason: result.reason }
        : { ok: true, ...result };
    }
  };
}

afterEach(() => {
  resetProviderCircuitBreakersForTests();
  overrideRiskAcknowledgementCatalogueForTests(null);
});

describe("the wire contract, fixture by fixture", () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, async () => {
      const { http } = fakeHttp(() => fixture.answer);
      const provider = createStarsenderWhatsappProvider({
        deviceKey: DEVICE_KEY_A,
        timeoutMs: 1000,
        breakerKey: whatsappSenderBreakerKey(D1),
        http
      })!;
      const result = await provider.send(REQUEST);

      expect(result.ok).toBe(fixture.expect.ok);

      if (!result.ok) {
        expect(result.failureCode).toBe(fixture.expect.failureCode!);
        expect(result.retryable).toBe(fixture.expect.retryable!);
        // A StarSender answer never decides that a RECIPIENT is invalid: that
        // would be a permanent suppression made from free text.
        expect(result.recipientInvalid).toBeUndefined();
        // The error is a FIXED sentence: nothing the provider said, and nothing
        // the request carried, can be in it.
        expect(result.error).not.toContain(DEVICE_KEY_A);
        expect(result.error).not.toContain("6281234567890");
        expect(result.error).not.toContain("appointment");
        expect(result.error.length).toBeLessThan(200);
      } else {
        // Accepted by StarSender: NO message id (unevidenced) and nothing that
        // says delivered or read.
        expect(result).toEqual({ ok: true });
      }
    });
  }

  test("every fixture is exercised through the pure classifier too", () => {
    for (const fixture of FIXTURES) {
      if ("reason" in fixture.answer) continue;

      const result = classifyStarsenderResponse(
        fixture.answer.status,
        fixture.answer.body
      );

      expect(result.ok).toBe(fixture.expect.ok);
    }
  });
});

describe("the request: allowlisted endpoint, device key as the credential, no redirect", () => {
  test("one POST to the constant URL, the raw device key in Authorization, a text message", async () => {
    const { http, calls } = fakeHttp(() => ({
      status: 200,
      body: '{"success":true,"data":{},"message":"Success sent message"}'
    }));
    const provider = createStarsenderWhatsappProvider({
      deviceKey: DEVICE_KEY_A,
      timeoutMs: 4321,
      http
    })!;

    expect(await provider.send(REQUEST)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.starsender.online/api/send");
    expect(new URL(calls[0]!.url).origin).toBe(STARSENDER_ALLOWED_ORIGIN);
    expect(calls[0]!.request.method).toBe("POST");
    expect(calls[0]!.request.headers.Authorization).toBe(DEVICE_KEY_A);
    expect(calls[0]!.request.timeoutMs).toBe(4321);
    expect(JSON.parse(calls[0]!.request.body)).toEqual({
      messageType: "text",
      to: "6281234567890",
      body: REQUEST.body
    });
  });

  test("redirects are refused, not followed: the device key is an Authorization header the guard would re-send", async () => {
    const { http, calls } = fakeHttp(() => ({
      status: 200,
      body: '{"success":true}'
    }));
    const provider = createStarsenderWhatsappProvider({
      deviceKey: DEVICE_KEY_A,
      timeoutMs: 1000,
      http
    })!;

    await provider.send(REQUEST);

    expect(calls[0]!.request.maxRedirects).toBe(0);
  });

  test("the URL is a constant on the allowed origin and is not read from anywhere", () => {
    expect(STARSENDER_SEND_URL).toBe("https://api.starsender.online/api/send");

    const source = readFileSync(
      "src/modules/whatsapp-delivery/infrastructure/starsender-provider.ts",
      "utf8"
    );

    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/options\.(url|endpoint|baseUrl)/);
  });

  test("an unusable recipient or an empty body is refused locally and nothing is sent", async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: "{}" }));
    const provider = createStarsenderWhatsappProvider({
      deviceKey: DEVICE_KEY_A,
      timeoutMs: 1000,
      http
    })!;

    for (const bad of [
      { ...REQUEST, to: "08123456789" },
      { ...REQUEST, to: "+62abc" },
      { ...REQUEST, body: "   " }
    ]) {
      expect(await provider.send(bad)).toMatchObject({
        ok: false,
        failureCode: "recipient_unusable",
        retryable: false
      });
    }

    expect(calls).toHaveLength(0);
    expect(
      buildStarsenderRequestBody({ to: "+6281234567890", body: "x" })
    ).not.toBeNull();
  });

  test("a device key that could inject a header or is implausibly short builds no adapter", () => {
    for (const key of [
      "",
      "short",
      "has space in it 123",
      "line\nbreak-123456",
      "x".repeat(600)
    ]) {
      expect(isPlausibleStarsenderDeviceKey(key)).toBe(false);
      expect(
        createStarsenderWhatsappProvider({ deviceKey: key, timeoutMs: 1000 })
      ).toBeNull();
    }

    expect(isPlausibleStarsenderDeviceKey(DEVICE_KEY_A)).toBe(true);
  });
});

describe("accepted is not delivered", () => {
  test("a success carries no provider message id, so nothing downstream can mistake it for a delivery receipt", async () => {
    const { http } = fakeHttp(() => ({
      status: 200,
      body: '{"success":true,"data":{"id":"should-not-be-trusted","status":"delivered"},"message":"Success sent message"}'
    }));
    const provider = createStarsenderWhatsappProvider({
      deviceKey: DEVICE_KEY_A,
      timeoutMs: 1000,
      http
    })!;

    expect(await provider.send(REQUEST)).toEqual({ ok: true });
  });

  test("the adapter source never reports delivered, read or a webhook status", () => {
    const source = readFileSync(
      "src/modules/whatsapp-delivery/infrastructure/starsender-provider.ts",
      "utf8"
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/delivered|"read"|webhook/i);
  });
});

describe("per-device circuit breaker and isolation", () => {
  test("two devices of one tenant never share a key, an identity or a breaker", async () => {
    const down = fakeHttp(() => ({ status: 503, body: "" }));
    const up = fakeHttp(() => ({
      status: 200,
      body: '{"success":true,"data":{},"message":"Success sent message"}'
    }));
    const a = buildWhatsappSenderProvider({
      sender: { accountId: D1, provider: "starsender", externalId: "dev-a" },
      credential: DEVICE_KEY_A,
      breakerKey: whatsappSenderBreakerKey(D1),
      env: ON,
      http: down.http
    })!;
    const b = buildWhatsappSenderProvider({
      sender: { accountId: D2, provider: "starsender", externalId: "dev-b" },
      credential: DEVICE_KEY_B,
      breakerKey: whatsappSenderBreakerKey(D2),
      env: ON,
      http: up.http
    })!;

    for (let i = 0; i < 6; i += 1) await a.send(REQUEST);
    await b.send(REQUEST);

    expect(
      down.calls.every((c) => c.request.headers.Authorization === DEVICE_KEY_A)
    ).toBe(true);
    expect(
      up.calls.every((c) => c.request.headers.Authorization === DEVICE_KEY_B)
    ).toBe(true);
    expect(
      getProviderCircuitBreaker(whatsappSenderBreakerKey(D1)).canAttempt(
        new Date()
      )
    ).toBe(false);
    expect(
      getProviderCircuitBreaker(whatsappSenderBreakerKey(D2)).canAttempt(
        new Date()
      )
    ).toBe(true);
    expect(await a.healthCheck()).toEqual({
      ok: false,
      error: "Circuit breaker is open."
    });
    expect(await b.healthCheck()).toEqual({ ok: true });
  });

  test("a verdict about one MESSAGE or credential (rejected, unauthorized) never opens the breaker; provider ill-health does", async () => {
    for (const [answer, shouldOpen] of [
      [{ status: 200, body: '{"success":false,"message":"bad"}' }, false],
      [{ status: 401, body: "" }, false],
      [
        {
          status: 200,
          body: '{"success":false,"message":"Device is not connected"}'
        },
        true
      ],
      [{ reason: "outbound request refused: request_failed" }, true]
    ] as const) {
      resetProviderCircuitBreakersForTests();

      const { http } = fakeHttp(() => answer);
      const provider = createStarsenderWhatsappProvider({
        deviceKey: DEVICE_KEY_A,
        timeoutMs: 1000,
        breakerKey: whatsappSenderBreakerKey(D1),
        http
      })!;

      for (let i = 0; i < 8; i += 1) await provider.send(REQUEST);

      expect(
        getProviderCircuitBreaker(whatsappSenderBreakerKey(D1)).canAttempt(
          new Date()
        )
      ).toBe(!shouldOpen);
    }
  });
});

describe("the factory: off by default, from the device's own record", () => {
  const sender = {
    accountId: D1,
    provider: "starsender" as const,
    externalId: "dev-a"
  };

  test("off by default: no flag, no adapter, at enqueue and at dispatch", () => {
    const off = {} as NodeJS.ProcessEnv;

    expect(hasWhatsappSenderAdapter("starsender", off)).toBe(false);
    expect(
      hasWhatsappSenderAdapter("starsender", {
        WHATSAPP_STARSENDER_ENABLED: "1"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      buildWhatsappSenderProvider({
        sender,
        credential: DEVICE_KEY_A,
        breakerKey: whatsappSenderBreakerKey(D1),
        env: off
      })
    ).toBeNull();
    expect(hasWhatsappSenderAdapter("starsender", ON)).toBe(true);
    expect(
      hasWhatsappSenderAdapter("whatsapp_cloud", {} as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  test("a malformed device id, key or an unknown provider builds nothing", () => {
    for (const [externalId, credential] of [
      ["bad id with spaces", DEVICE_KEY_A],
      ["", DEVICE_KEY_A],
      ["dev-a", "   "],
      ["dev-a", "tiny"]
    ] as const) {
      expect(
        buildWhatsappSenderProvider({
          sender: { ...sender, externalId },
          credential,
          breakerKey: whatsappSenderBreakerKey(D1),
          env: ON
        })
      ).toBeNull();
    }
  });
});

describe("the risk acknowledgement text is a human decision, so it ships unapproved", () => {
  test("the shipped StarSender text has NO approval: nothing can be acknowledged until a reviewed change fills it", () => {
    const resolved = resolveRiskAcknowledgement("starsender");

    expect(resolved.approved).toBe(false);
    expect(resolved.entry.approval).toBeNull();
    expect(resolved.entry.textVersion).toBe(STARSENDER_RISK_TEXT_VERSION);
    expect(describeRiskAcknowledgement("starsender")).toMatchObject({
      approved: false,
      approval: null
    });
  });

  test("the draft claims no Meta authorisation, no ban-free sending and no delivery guarantee, in both languages", () => {
    const { text } = describeRiskAcknowledgement("starsender");

    expect(text.en).toMatch(/UNOFFICIAL/);
    expect(text.en).toMatch(/not an interface authorised/i);
    expect(text.en).toMatch(/banned/i);
    expect(text.en).toMatch(/does not mean the message was delivered/i);
    expect(text.en).toMatch(/will not send through another device/i);
    expect(text.id).toMatch(/TIDAK RESMI/);
    expect(text.id).toMatch(/tidak berarti pesan terkirim/i);
    expect(text.en).not.toMatch(
      /guarantee|ban-free|approved by (meta|whatsapp)/i
    );
  });

  test("an approved text hashes its exact words: changing a word changes the hash, and the version label alone is not the proof", () => {
    const entry: RiskAcknowledgementEntry = {
      ...resolveRiskAcknowledgement("starsender").entry,
      approval: {
        approvedBy: "the business owner",
        approvedOn: "2026-11-10",
        reference: "issue-1142#comment"
      }
    };
    const edited: RiskAcknowledgementEntry = {
      ...entry,
      text: { ...entry.text, en: `${entry.text.en} extra` }
    };

    expect(hashRiskText(entry)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRiskText(entry)).not.toBe(hashRiskText(edited));

    overrideRiskAcknowledgementCatalogueForTests({ starsender: entry });

    expect(resolveRiskAcknowledgement("starsender")).toMatchObject({
      approved: true,
      textHash: hashRiskText(entry)
    });
  });

  test("the acknowledge body names a provider and a text version, and nobody else: another person cannot be named", () => {
    expect(
      validateAcknowledgeRisk({
        provider: "starsender",
        textVersion: STARSENDER_RISK_TEXT_VERSION
      })
    ).toMatchObject({ valid: true });

    for (const bad of [
      {},
      { provider: "starsender" },
      { provider: "whatsapp_cloud", textVersion: "v1" },
      { provider: "starsender", textVersion: "" },
      { provider: "starsender", textVersion: "v1", tenantUserId: "x" },
      { provider: "starsender", textVersion: "v1", userId: "x" },
      "starsender",
      null
    ]) {
      expect(validateAcknowledgeRisk(bad)).toMatchObject({ valid: false });
    }
  });
});

describe("the sender decision for a StarSender device (scripted transaction)", () => {
  const ENABLED = {
    CHANNEL_ACCOUNTS_ENABLED: "true"
  } as unknown as NodeJS.ProcessEnv;
  const device = {
    id: D1,
    business_scope_type: null,
    business_scope_id: null,
    provider: "starsender",
    account_kind: "device",
    external_id: "dev-a",
    auth_mode: "device_key",
    connection_id: null,
    parent_account_id: null,
    secret_id: "secret-1",
    status: "connected"
  };

  function tx(options: { acknowledged: boolean; evidence?: string }) {
    const statements: string[] = [];
    const sql = (async (strings: TemplateStringsArray) => {
      const text = strings.join("?");

      statements.push(text);

      if (text.includes("FROM awcms_channel_accounts")) return [device];
      if (text.includes("awcms_channel_provider_risk_acknowledgements")) {
        return options.acknowledged ? [{ present: 1 }] : [];
      }
      if (text.includes("FROM awcms_channel_account_capabilities")) {
        return [
          {
            state: "granted",
            evidence_kind: options.evidence ?? "app_review_reference",
            evidence_ref: "owner-ack-1",
            matrix_version: PROVIDER_MATRIX_VERSION
          }
        ];
      }

      return [];
    }) as unknown as Bun.SQL;

    return { sql, statements };
  }

  const approvedCatalogue = () =>
    overrideRiskAcknowledgementCatalogueForTests({
      starsender: {
        ...resolveRiskAcknowledgement("starsender").entry,
        approval: {
          approvedBy: "owner",
          approvedOn: "2026-11-10",
          reference: "ref"
        }
      }
    });

  test("with the shipped (unapproved) text no device is usable, and the database is not even asked", async () => {
    const port = createChannelAccountPortAdapter({ env: ENABLED });
    const { sql, statements } = tx({ acknowledged: true });

    expect(
      await port.resolveWhatsappSender(sql, {
        tenantId: T1,
        accountId: D1,
        capability: "dm"
      })
    ).toEqual({ usable: false, reason: "RISK_ACKNOWLEDGEMENT_REQUIRED" });
    expect(statements.some((s) => s.includes("risk_acknowledgements"))).toBe(
      false
    );
  });

  test("approved text and an active acknowledgement: usable; without one: refused, terminal", async () => {
    approvedCatalogue();

    const port = createChannelAccountPortAdapter({ env: ENABLED });
    const ask = (acknowledged: boolean) =>
      port.resolveWhatsappSender(tx({ acknowledged }).sql, {
        tenantId: T1,
        accountId: D1,
        capability: "dm"
      });

    expect(await ask(true)).toMatchObject({
      usable: true,
      sender: { provider: "starsender", accountKind: "device" }
    });
    expect(await ask(false)).toEqual({
      usable: false,
      reason: "RISK_ACKNOWLEDGEMENT_REQUIRED"
    });
    expect(classifySenderUnavailable("RISK_ACKNOWLEDGEMENT_REQUIRED")).toBe(
      "terminal"
    );
  });

  test("marketing needs `broadcast`, which the matrix marks restricted for StarSender: a device cannot broadcast without contract evidence", async () => {
    approvedCatalogue();

    const port = createChannelAccountPortAdapter({ env: ENABLED });
    const sql = tx({ acknowledged: true }).sql;

    expect(PROVIDER_MATRIX.starsender!.cells.broadcast).toBe("restricted");
    expect(
      await port.resolveWhatsappSender(sql, {
        tenantId: T1,
        accountId: D1,
        capability: "broadcast"
      })
    ).toEqual({ usable: false, reason: "CAPABILITY_DENIED" });
  });

  test("audit L2: with the adapter flag OFF the device key is not decrypted at all, whatever else holds", async () => {
    approvedCatalogue();

    let resolved = 0;
    const store = {
      async resolve() {
        resolved += 1;

        return DEVICE_KEY_A;
      }
    } as never;
    const off = createChannelSenderCredentialAdapter({ env: ENABLED, store });
    const on = createChannelSenderCredentialAdapter({
      env: {
        ...ENABLED,
        WHATSAPP_STARSENDER_ENABLED: "true"
      } as unknown as NodeJS.ProcessEnv,
      store
    });

    expect(
      await off.resolveWhatsappCredential(tx({ acknowledged: true }).sql, {
        tenantId: T1,
        accountId: D1
      })
    ).toEqual({ ok: false, reason: "PROVIDER_ADAPTER_DISABLED" });
    expect(resolved).toBe(0);
    expect(
      await on.resolveWhatsappCredential(tx({ acknowledged: true }).sql, {
        tenantId: T1,
        accountId: D1
      })
    ).toEqual({ ok: true, credential: DEVICE_KEY_A });
    expect(resolved).toBe(1);
  });

  test("the credential adapter does not decrypt a device key for an unacknowledged tenant (defence in depth)", async () => {
    approvedCatalogue();

    let resolved = 0;
    const adapter = createChannelSenderCredentialAdapter({
      env: {
        ...ENABLED,
        WHATSAPP_STARSENDER_ENABLED: "true"
      } as unknown as NodeJS.ProcessEnv,
      store: {
        async resolve() {
          resolved += 1;

          return DEVICE_KEY_A;
        }
      } as never
    });
    const result = await adapter.resolveWhatsappCredential(
      tx({ acknowledged: false }).sql,
      { tenantId: T1, accountId: D1 }
    );

    expect(result).toEqual({
      ok: false,
      reason: "RISK_ACKNOWLEDGEMENT_REQUIRED"
    });
    expect(resolved).toBe(0);
  });
});

describe("structural facts", () => {
  function walk(dir: string, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);

      if (statSync(full).isDirectory()) walk(full, found);
      else found.push(full);
    }

    return found;
  }

  test("the dispatcher HOLDS a device's lane on `device_disconnected` as well as on `unauthorized` (guard that goes red if the clause is removed; the DB-backed proof is in the integration suite)", () => {
    const source = readFileSync(
      "src/modules/whatsapp-delivery/application/whatsapp-dispatch.ts",
      "utf8"
    );
    const at = source.indexOf("lane.credentialRejected = true");
    const around = source.slice(Math.max(0, at - 700), at);

    expect(at).toBeGreaterThan(0);
    expect(around).toContain('sendResult.failureCode === "unauthorized"');
    expect(around).toContain(
      'sendResult.failureCode === "device_disconnected"'
    );
    expect(around).toContain("lane.senderAccountId");
  });

  test("there is NO StarSender webhook route, and the matrix keeps its inbound cell unverified: untrusted status or contacts cannot enter (ADR-0148 I9)", () => {
    const routes = walk("src/pages").filter((file) => /starsender/i.test(file));

    expect(routes).toEqual([]);
    expect(PROVIDER_MATRIX.starsender!.cells.inbound).toBe("unverified");
    expect(PROVIDER_MATRIX.starsender!.cells.broadcast).toBe("restricted");
  });

  test("no module imports the StarSender adapter except the per-sender factory: no second dispatcher, no direct call", () => {
    const importers = walk("src")
      .concat(walk("scripts"))
      .filter((file) => /\.(ts|astro)$/.test(file))
      .filter((file) =>
        /from "[^"]*starsender-(provider|contract)"/.test(
          readFileSync(file, "utf8")
        )
      );

    expect(importers.sort()).toEqual(
      [
        "src/modules/whatsapp-delivery/infrastructure/starsender-provider.ts",
        "src/modules/whatsapp-delivery/infrastructure/whatsapp-sender-providers.ts"
      ].sort()
    );
  });

  test("the StarSender endpoint appears in exactly one source file", () => {
    const files = walk("src")
      .concat(walk("scripts"))
      .filter((file) => /\.(ts|astro)$/.test(file))
      // The provider changelog register names every provider host by design
      // (it is the list of them), and calls none of them.
      .filter((file) => file !== "scripts/provider-api-register.ts")
      .filter((file) =>
        readFileSync(file, "utf8").includes("api.starsender.online")
      );

    expect(files.sort()).toEqual(
      ["src/modules/whatsapp-delivery/domain/starsender-contract.ts"].sort()
    );
    expect(
      existsSync("src/modules/whatsapp-delivery/domain/starsender-contract.ts")
    ).toBe(true);
  });
});
