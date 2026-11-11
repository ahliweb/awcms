/**
 * Sender-aware WhatsApp routing, the parts that need no database (Issue #1141,
 * ADR-0148 section 4): the pure routing rules, the validators, the per-sender
 * provider factory, the two `channel_accounts` port adapters driven through a
 * scripted transaction, and the static contracts that keep "one queue, no
 * request-supplied token, no secret on the enqueue path" true.
 *
 * The properties that live in PostgreSQL (RLS, the immutability trigger,
 * concurrent claims, two tenants with several senders) are in
 * `tests/integration/whatsapp-sender-routing.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  createCircuitBreaker,
  type CircuitBreaker
} from "../src/lib/database/circuit-breaker";
import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../src/lib/database/circuit-breaker";
import { listModules } from "../src/modules";
import type { SenderUnavailableReason } from "../src/modules/_shared/ports/channel-account-port";
import {
  createChannelAccountPortAdapter,
  isWhatsappSenderShape
} from "../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { SecretStoreError } from "../src/modules/channel-accounts/application/secret-store";
import { CHANNEL_SECRET_PURPOSES } from "../src/modules/channel-accounts/domain/channel-accounts-constants";
import { PROVIDER_MATRIX_VERSION } from "../src/modules/channel-accounts/domain/provider-matrix";
import {
  overrideRiskAcknowledgementCatalogueForTests,
  resolveRiskAcknowledgement
} from "../src/modules/channel-accounts/domain/risk-acknowledgements";
import {
  WHATSAPP_CIRCUIT_BREAKER_KEY,
  resolveWhatsappSenderRatePerDay,
  resolveWhatsappSenderRatePerHour,
  resolveWhatsappSenderRevalidateEveryRows,
  whatsappSenderBreakerKey
} from "../src/modules/whatsapp-delivery/domain/whatsapp-config";
import {
  capabilityForSend,
  chooseSender,
  classifySenderUnavailable,
  parseBusinessScope,
  pickPolicy,
  senderScopeAllows,
  type PolicyRow
} from "../src/modules/whatsapp-delivery/domain/whatsapp-sender";
import { resolveEnqueueSender } from "../src/modules/whatsapp-delivery/application/whatsapp-sender-directory";
import { validateSenderPolicyInput } from "../src/modules/whatsapp-delivery/domain/whatsapp-validation";
import {
  buildWhatsappSenderProvider,
  hasWhatsappSenderAdapter,
  isWhatsappMetaApiVersionValid,
  resolveWhatsappMetaApiVersion
} from "../src/modules/whatsapp-delivery/infrastructure/whatsapp-sender-providers";
import type { WhatsappHttpClient } from "../src/modules/whatsapp-delivery/infrastructure/whatsapp-http-client";

const T1 = "11111111-1111-4111-8111-111111111111";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SCOPE_A = { type: "brand", id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const SCOPE_B = { type: "brand", id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
const CANARY = "CANARY-sender-token-5b1f0c9e";

describe("sender choice (pure precedence)", () => {
  const policy = (over: Partial<PolicyRow> = {}): PolicyRow => ({
    businessScope: null,
    defaultSenderAccountId: S2,
    configVersion: 3,
    ...over
  });

  test("an explicit sender wins over the policy and is snapshotted as explicit", () => {
    expect(
      chooseSender({
        explicitSenderAccountId: S1,
        thread: null,
        policy: policy()
      })
    ).toEqual({
      kind: "chosen",
      senderAccountId: S1,
      selection: "explicit",
      policyVersion: null
    });
  });

  test("with nothing named the policy decides, and its version is carried", () => {
    expect(
      chooseSender({
        explicitSenderAccountId: null,
        thread: null,
        policy: policy()
      })
    ).toEqual({
      kind: "chosen",
      senderAccountId: S2,
      selection: "policy",
      policyVersion: 3
    });
  });

  test("no policy, no thread, no sender is the deployment sender (null), today's behaviour", () => {
    expect(
      chooseSender({
        explicitSenderAccountId: null,
        thread: null,
        policy: null
      })
    ).toEqual({
      kind: "chosen",
      senderAccountId: null,
      selection: "deployment",
      policyVersion: null
    });
  });

  test("a policy whose default is null is an explicit choice of the deployment sender", () => {
    expect(
      chooseSender({
        explicitSenderAccountId: null,
        thread: null,
        policy: policy({ defaultSenderAccountId: null })
      })
    ).toEqual({
      kind: "chosen",
      senderAccountId: null,
      selection: "deployment",
      policyVersion: 3
    });
  });

  test("a reply keeps the thread's sender, ignoring the policy", () => {
    expect(
      chooseSender({
        explicitSenderAccountId: null,
        thread: { senderAccountId: S1 },
        policy: policy()
      })
    ).toEqual({
      kind: "chosen",
      senderAccountId: S1,
      selection: "reply",
      policyVersion: null
    });
    // The same explicit sender is not a conflict.
    expect(
      chooseSender({
        explicitSenderAccountId: S1,
        thread: { senderAccountId: S1 },
        policy: null
      })
    ).toMatchObject({ kind: "chosen", senderAccountId: S1 });
  });

  test("a different explicit sender than the thread's is a CONFLICT, never an override", () => {
    expect(
      chooseSender({
        explicitSenderAccountId: S2,
        thread: { senderAccountId: S1 },
        policy: null
      })
    ).toEqual({ kind: "refused", reason: "SENDER_AFFINITY_CONFLICT" });
    // A thread that started on the deployment sender cannot be moved to an account either.
    expect(
      chooseSender({
        explicitSenderAccountId: S2,
        thread: { senderAccountId: null },
        policy: null
      })
    ).toEqual({ kind: "refused", reason: "SENDER_AFFINITY_CONFLICT" });
  });
});

describe("policy lookup", () => {
  const tenantWide: PolicyRow = {
    businessScope: null,
    defaultSenderAccountId: S1,
    configVersion: 1
  };
  const scopedA: PolicyRow = {
    businessScope: SCOPE_A,
    defaultSenderAccountId: S2,
    configVersion: 2
  };

  test("the message's own scope beats the tenant-wide row", () => {
    expect(pickPolicy([tenantWide, scopedA], SCOPE_A)).toBe(scopedA);
  });

  test("a scope with no row falls to the tenant-wide row, not to another scope's", () => {
    expect(pickPolicy([tenantWide, scopedA], SCOPE_B)).toBe(tenantWide);
    expect(pickPolicy([scopedA], SCOPE_B)).toBeNull();
  });

  test("a message with no scope never matches a scoped row", () => {
    expect(pickPolicy([scopedA], null)).toBeNull();
    expect(pickPolicy([tenantWide, scopedA], null)).toBe(tenantWide);
  });

  test("a scoped row with a null default overrides a tenant-wide default (deployment sender, by decision)", () => {
    const override: PolicyRow = { ...scopedA, defaultSenderAccountId: null };

    expect(pickPolicy([tenantWide, override], SCOPE_A)).toBe(override);
  });
});

describe("scope and capability rules", () => {
  test("a tenant-wide account may send for any scope; a scoped one only for its own (exact equality)", () => {
    expect(senderScopeAllows(null, SCOPE_A)).toBe(true);
    expect(senderScopeAllows(null, null)).toBe(true);
    expect(senderScopeAllows(SCOPE_A, SCOPE_A)).toBe(true);
    expect(senderScopeAllows(SCOPE_A, SCOPE_B)).toBe(false);
    expect(senderScopeAllows(SCOPE_A, null)).toBe(false);
  });

  test("business scope parsing is strict and fail-closed", () => {
    expect(parseBusinessScope(undefined)).toBeNull();
    expect(parseBusinessScope(null)).toBeNull();
    expect(parseBusinessScope(SCOPE_A)).toEqual(SCOPE_A);
    for (const bad of [
      "brand",
      { type: "Brand", id: SCOPE_A.id },
      { type: "brand", id: "nope" },
      { type: "", id: SCOPE_A.id },
      { id: SCOPE_A.id },
      42
    ]) {
      expect(parseBusinessScope(bad)).toBe("invalid");
    }
  });

  test("purpose maps to the provider-matrix capability: broadcast for marketing ALWAYS, reply inside a thread, dm otherwise", () => {
    expect(capabilityForSend("transactional", false)).toBe("dm");
    expect(capabilityForSend("security", false)).toBe("dm");
    expect(capabilityForSend("marketing", false)).toBe("broadcast");
    expect(capabilityForSend("transactional", true)).toBe("reply");
    expect(capabilityForSend("security", true)).toBe("reply");
  });

  test("L3 (#1233): a marketing message linked to an earlier message still needs `broadcast`; affinity never relaxes the capability", () => {
    expect(capabilityForSend("marketing", true)).toBe("broadcast");
  });

  test("an unavailable sender is terminal when it is gone or never approved, held when it may recover", () => {
    const reasons: Record<SenderUnavailableReason, "terminal" | "hold"> = {
      ACCOUNT_NOT_FOUND: "terminal",
      NOT_A_WHATSAPP_SENDER: "terminal",
      ACCOUNT_REVOKED: "terminal",
      ACCOUNT_DISABLED: "terminal",
      CAPABILITY_DENIED: "terminal",
      RISK_ACKNOWLEDGEMENT_REQUIRED: "terminal",
      PROVIDER_ADAPTER_DISABLED: "terminal",
      CONNECTION_NOT_ACTIVE: "terminal",
      CONNECTION_EXPIRED: "hold",
      CHANNEL_ACCOUNTS_DISABLED: "hold",
      ACCOUNT_PENDING: "hold",
      ACCOUNT_DEGRADED: "hold",
      CREDENTIAL_UNAVAILABLE: "hold",
      SECRET_STORE_UNAVAILABLE: "hold"
    };

    for (const [reason, expected] of Object.entries(reasons)) {
      expect(classifySenderUnavailable(reason as SenderUnavailableReason)).toBe(
        expected
      );
    }
  });
});

describe("no fallback to the deployment sender (#1233 test gap a)", () => {
  const fakeTx = (() => {
    throw new Error("no query may run for an explicit sender");
  }) as unknown as Bun.SQL;
  const decide = (
    senders: Parameters<typeof resolveEnqueueSender>[1]["senders"],
    input: { senderAccountId?: string } = { senderAccountId: S1 }
  ) =>
    resolveEnqueueSender(fakeTx, {
      tenantId: T1,
      input,
      purpose: "transactional",
      hashes: { current: "h", all: ["h"] } as never,
      senders
    });

  test("at ENQUEUE a named sender that cannot send is a refusal, never the deployment sender", async () => {
    for (const reason of [
      "ACCOUNT_NOT_FOUND",
      "ACCOUNT_REVOKED",
      "CAPABILITY_DENIED",
      "CHANNEL_ACCOUNTS_DISABLED",
      "SECRET_STORE_UNAVAILABLE"
    ] as const) {
      const decision = await decide(async () => ({
        resolveWhatsappSender: async () => ({ usable: false, reason })
      }));

      expect(decision).toMatchObject({
        ok: false,
        reason: "SENDER_UNAVAILABLE"
      });
    }
  });

  test("at ENQUEUE no port, a port that cannot load, or a provider without an adapter is a refusal", async () => {
    expect(await decide(null)).toMatchObject({ ok: false });
    expect(
      await decide(async () => {
        throw new Error("import failed");
      })
    ).toMatchObject({ ok: false, reason: "SENDER_UNAVAILABLE" });
    expect(
      await decide(async () => ({
        resolveWhatsappSender: async () => ({
          usable: true,
          sender: {
            accountId: S1,
            provider: "starsender",
            accountKind: "device",
            externalId: "dev-1",
            businessScope: null
          }
        })
      }))
    ).toMatchObject({ ok: false, detail: "provider_has_no_adapter" });
  });

  test("at ENQUEUE a usable sender is the one named, and the capability asked is the purpose's (marketing: broadcast)", async () => {
    const asked: string[] = [];
    const port = async () => ({
      resolveWhatsappSender: async (
        _tx: unknown,
        input: { capability: string }
      ) => {
        asked.push(input.capability);

        return {
          usable: true as const,
          sender: {
            accountId: S1,
            provider: "whatsapp_cloud" as const,
            accountKind: "waba_phone_number",
            externalId: "1234567890",
            businessScope: null
          }
        };
      }
    });

    expect(await decide(port as never)).toMatchObject({
      ok: true,
      senderAccountId: S1,
      selection: "explicit"
    });
    await resolveEnqueueSender(fakeTx, {
      tenantId: T1,
      input: { senderAccountId: S1 },
      purpose: "marketing",
      hashes: { current: "h", all: ["h"] } as never,
      senders: port as never
    });
    expect(asked).toEqual(["dm", "broadcast"]);
  });

  test("at DISPATCH the gate has no branch that picks another sender: the gate source never assigns a different lane id or the deployment provider after a refusal", () => {
    const source = readFileSync(
      "src/modules/whatsapp-delivery/application/whatsapp-dispatch.ts",
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const gate = source.slice(
      source.indexOf("async function gateRow("),
      source.indexOf("async function processRow(")
    );

    // The deployment provider is returned only for the deployment lane.
    expect(gate.match(/lane\.deployment/g)).toHaveLength(1);
    expect(gate).toContain("if (lane.senderAccountId === null)");
    // Nothing in the gate resolves a provider other than the lane's own.
    expect(gate).not.toMatch(/resolveProvider|options\.resolveProvider/);
    expect(gate).not.toMatch(/senderAccountId\s*=[^=]/);
  });
});

describe("sender policy request validation", () => {
  test("accepts a scope or tenant-wide, and an account or the deployment sender", () => {
    expect(
      validateSenderPolicyInput({
        businessScope: null,
        defaultSenderAccountId: S1
      })
    ).toEqual({
      valid: true,
      value: { businessScope: null, defaultSenderAccountId: S1 }
    });
    expect(
      validateSenderPolicyInput({
        businessScope: SCOPE_A,
        defaultSenderAccountId: null
      })
    ).toEqual({
      valid: true,
      value: { businessScope: SCOPE_A, defaultSenderAccountId: null }
    });
  });

  test("both keys are required: leaving one out is not 'unchanged' and not 'deployment sender'", () => {
    expect(validateSenderPolicyInput({ businessScope: null }).valid).toBe(
      false
    );
    expect(
      validateSenderPolicyInput({ defaultSenderAccountId: S1 }).valid
    ).toBe(false);
    expect(validateSenderPolicyInput({}).valid).toBe(false);
    expect(validateSenderPolicyInput(null).valid).toBe(false);
  });

  test("a token, phone number id, device id or provider smuggled into the body is a 400, never ignored", () => {
    for (const key of [
      "accessToken",
      "token",
      "phoneNumberId",
      "phone_number_id",
      "deviceId",
      "provider"
    ]) {
      const result = validateSenderPolicyInput({
        businessScope: null,
        defaultSenderAccountId: S1,
        [key]: "x"
      });

      expect(result.valid, key).toBe(false);
    }
  });

  test("a sender that is not a uuid is rejected", () => {
    expect(
      validateSenderPolicyInput({
        businessScope: null,
        defaultSenderAccountId: "starsender"
      }).valid
    ).toBe(false);
  });
});

describe("per-sender caps", () => {
  test("have defaults, take a configured value, and ignore garbage", () => {
    expect(resolveWhatsappSenderRatePerHour({})).toBe(1000);
    expect(resolveWhatsappSenderRatePerDay({})).toBe(10_000);
    expect(
      resolveWhatsappSenderRatePerHour({
        WHATSAPP_SENDER_RATE_PER_HOUR: "25"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(25);
    expect(
      resolveWhatsappSenderRatePerHour({
        WHATSAPP_SENDER_RATE_PER_HOUR: "nope"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(1000);
  });

  test("each sender has its own breaker key, and the deployment sender keeps its old one", () => {
    expect(whatsappSenderBreakerKey(S1)).not.toBe(whatsappSenderBreakerKey(S2));
    expect(whatsappSenderBreakerKey(S1)).not.toBe(WHATSAPP_CIRCUIT_BREAKER_KEY);
    expect(WHATSAPP_CIRCUIT_BREAKER_KEY).toBe("whatsapp-delivery");
    // A uuid, never a number or a token.
    expect(whatsappSenderBreakerKey(S1)).toBe(`whatsapp-delivery:sender:${S1}`);
  });
});

describe("the tenant-owned sender's provider adapter", () => {
  type Call = { url: string; headers: Record<string, string>; body: string };

  function fakeHttp(
    answer: (
      call: Call
    ) => { status: number; body: string } | { reason: string }
  ): { http: WhatsappHttpClient; calls: Call[] } {
    const calls: Call[] = [];

    return {
      calls,
      http: async (url, request) => {
        const call = { url, headers: request.headers, body: request.body };

        calls.push(call);
        const result = answer(call);

        return "reason" in result
          ? { ok: false, reason: result.reason }
          : { ok: true, ...result };
      }
    };
  }

  const request = {
    to: "+6281234567890",
    toMasked: "+*********7890",
    body: "x",
    templateKey: "t.k",
    providerTemplate: { name: "reminder", language: "en" },
    parameters: ["Sari"]
  };

  test("whatsapp_cloud always has an adapter; a StarSender sender has one only when its flag is on (#1142, off by default)", () => {
    expect(hasWhatsappSenderAdapter("whatsapp_cloud")).toBe(true);
    expect(
      hasWhatsappSenderAdapter("starsender", {} as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      buildWhatsappSenderProvider({
        sender: { accountId: S1, provider: "starsender", externalId: "dev-1" },
        credential: CANARY,
        breakerKey: whatsappSenderBreakerKey(S1),
        env: {} as NodeJS.ProcessEnv
      })
    ).toBeNull();
  });

  test("L1 (#1233): the API version is validated apart from the identity, so a malformed one can be HELD rather than failed", () => {
    expect(resolveWhatsappMetaApiVersion({} as NodeJS.ProcessEnv)).toBe(
      "v21.0"
    );
    expect(
      resolveWhatsappMetaApiVersion({
        WHATSAPP_META_API_VERSION: " v22.1 "
      } as unknown as NodeJS.ProcessEnv)
    ).toBe("v22.1");

    for (const bad of ["21", "v21", "latest", "v21.0/../x"]) {
      const env = {
        WHATSAPP_META_API_VERSION: bad
      } as unknown as NodeJS.ProcessEnv;

      expect(resolveWhatsappMetaApiVersion(env)).toBeNull();
      expect(isWhatsappMetaApiVersionValid(env)).toBe(false);
      expect(
        buildWhatsappSenderProvider({
          sender: {
            accountId: S1,
            provider: "whatsapp_cloud",
            externalId: "1234567890"
          },
          credential: CANARY,
          breakerKey: whatsappSenderBreakerKey(S1),
          env
        })
      ).toBeNull();
    }
  });

  test("a malformed phone number id or an empty credential builds nothing (the row fails closed)", () => {
    for (const [externalId, credential] of [
      ["not-digits", CANARY],
      ["123", CANARY],
      ["1234567890", "   "]
    ] as const) {
      expect(
        buildWhatsappSenderProvider({
          sender: { accountId: S1, provider: "whatsapp_cloud", externalId },
          credential,
          breakerKey: whatsappSenderBreakerKey(S1),
          env: {} as NodeJS.ProcessEnv
        })
      ).toBeNull();
    }
  });

  test("the request is built from the SENDER's identity and credential, and from nothing else", async () => {
    const { http, calls } = fakeHttp(() => ({
      status: 200,
      body: JSON.stringify({ messages: [{ id: "wamid.1" }] })
    }));
    const provider = buildWhatsappSenderProvider({
      sender: {
        accountId: S1,
        provider: "whatsapp_cloud",
        externalId: "1098765432109"
      },
      credential: CANARY,
      breakerKey: whatsappSenderBreakerKey(S1),
      env: {
        WHATSAPP_META_API_VERSION: "v22.0"
      } as unknown as NodeJS.ProcessEnv,
      http
    })!;

    expect(await provider.send(request)).toEqual({
      ok: true,
      providerMessageId: "wamid.1"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://graph.facebook.com/v22.0/1098765432109/messages"
    );
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${CANARY}`);
  });

  test("two senders never share an identity, a credential or a breaker", async () => {
    resetProviderCircuitBreakersForTests();

    const down = fakeHttp(() => ({ status: 503, body: "{}" }));
    const up = fakeHttp(() => ({ status: 200, body: "{}" }));
    const a = buildWhatsappSenderProvider({
      sender: {
        accountId: S1,
        provider: "whatsapp_cloud",
        externalId: "11111111111"
      },
      credential: "token-of-A",
      breakerKey: whatsappSenderBreakerKey(S1),
      env: {} as NodeJS.ProcessEnv,
      http: down.http
    })!;
    const b = buildWhatsappSenderProvider({
      sender: {
        accountId: S2,
        provider: "whatsapp_cloud",
        externalId: "22222222222"
      },
      credential: "token-of-B",
      breakerKey: whatsappSenderBreakerKey(S2),
      env: {} as NodeJS.ProcessEnv,
      http: up.http
    })!;

    // Sender A fails five times in a row: ITS breaker opens.
    for (let i = 0; i < 6; i += 1) await a.send(request);
    await b.send(request);

    expect(
      down.calls.every((c) => c.headers.Authorization === "Bearer token-of-A")
    ).toBe(true);
    expect(
      up.calls.every((c) => c.headers.Authorization === "Bearer token-of-B")
    ).toBe(true);
    expect(down.calls[0]!.url).toContain("/11111111111/");
    expect(up.calls[0]!.url).toContain("/22222222222/");
    expect(
      getProviderCircuitBreaker(whatsappSenderBreakerKey(S1)).canAttempt(
        new Date()
      )
    ).toBe(false);
    expect(
      getProviderCircuitBreaker(whatsappSenderBreakerKey(S2)).canAttempt(
        new Date()
      )
    ).toBe(true);
    // ... and the deployment sender's breaker was never touched.
    expect(
      getProviderCircuitBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY).canAttempt(
        new Date()
      )
    ).toBe(true);

    resetProviderCircuitBreakersForTests();
  });

  test("the circuit breaker factory itself is untouched (pure, injected clock)", () => {
    const breaker: CircuitBreaker = createCircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 10
    });

    expect(breaker.canAttempt(new Date())).toBe(true);
  });
});

/** A transaction that answers by the table a statement reads, and records every statement. */
function scriptedTx(tables: {
  account?: Record<string, unknown> | null;
  parent?: Record<string, unknown> | null;
  connection?: Record<string, unknown> | null;
  /** Answers by connection id; falls back to `connection`. */
  connections?: Record<string, Record<string, unknown> | null>;
  capability?: Record<string, unknown> | null;
  /** Issue #1142: an active acknowledgement of an unofficial provider's current text exists. */
  acknowledged?: boolean;
}): { tx: Bun.SQL; statements: string[]; connectionIds: unknown[] } {
  const statements: string[] = [];
  const connectionIds: unknown[] = [];
  const tx = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");

    statements.push(text);

    if (text.includes("FROM awcms_channel_accounts")) {
      const isParent = values.includes("parent-1");

      return [isParent ? tables.parent : tables.account].filter(Boolean);
    }
    if (text.includes("FROM awcms_channel_provider_connections")) {
      const id = values[1] as string;

      connectionIds.push(id);

      return [
        tables.connections && id in tables.connections
          ? tables.connections[id]
          : tables.connection
      ].filter(Boolean);
    }
    if (text.includes("FROM awcms_channel_account_capabilities")) {
      return [tables.capability].filter(Boolean);
    }
    if (text.includes("awcms_channel_provider_risk_acknowledgements")) {
      return tables.acknowledged ? [{ present: 1 }] : [];
    }

    return [];
  }) as unknown as Bun.SQL;

  return { tx, statements, connectionIds };
}

const ENABLED = {
  CHANNEL_ACCOUNTS_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;
const cloudAccount = (over: Record<string, unknown> = {}) => ({
  id: S1,
  business_scope_type: null,
  business_scope_id: null,
  provider: "whatsapp_cloud",
  account_kind: "waba_phone_number",
  external_id: "1098765432109",
  auth_mode: "api_token",
  connection_id: null,
  parent_account_id: null,
  secret_id: "secret-1",
  status: "connected",
  ...over
});
const grantedRow = (over: Record<string, unknown> = {}) => ({
  state: "granted",
  evidence_kind: "app_review_reference",
  evidence_ref: "app-review-123",
  matrix_version: PROVIDER_MATRIX_VERSION,
  ...over
});

describe("ChannelAccountPort adapter (fail closed, no secret)", () => {
  const port = createChannelAccountPortAdapter({ env: ENABLED });
  const ask = (tx: Bun.SQL, capability: "dm" | "reply" | "broadcast" = "dm") =>
    port.resolveWhatsappSender(tx, { tenantId: T1, accountId: S1, capability });

  test("a connected, evidenced WhatsApp number may send; the answer is identity metadata only", async () => {
    const { tx } = scriptedTx({
      account: cloudAccount(),
      capability: grantedRow()
    });

    expect(await ask(tx)).toEqual({
      usable: true,
      sender: {
        accountId: S1,
        provider: "whatsapp_cloud",
        accountKind: "waba_phone_number",
        externalId: "1098765432109",
        businessScope: null
      }
    });
  });

  test("the control plane switched off denies every sender, and reads nothing", async () => {
    const { tx, statements } = scriptedTx({
      account: cloudAccount(),
      capability: grantedRow()
    });
    const off = createChannelAccountPortAdapter({
      env: {} as NodeJS.ProcessEnv
    });

    expect(
      await off.resolveWhatsappSender(tx, {
        tenantId: T1,
        accountId: S1,
        capability: "dm"
      })
    ).toEqual({ usable: false, reason: "CHANNEL_ACCOUNTS_DISABLED" });
    expect(statements).toHaveLength(0);
  });

  test("an unknown, foreign or deleted account is one answer: ACCOUNT_NOT_FOUND", async () => {
    expect(await ask(scriptedTx({ account: null }).tx)).toEqual({
      usable: false,
      reason: "ACCOUNT_NOT_FOUND"
    });
  });

  test("a container (WABA), another provider and a non-WhatsApp kind are not senders", async () => {
    for (const over of [
      { account_kind: "waba" },
      { provider: "facebook", account_kind: "page" },
      { provider: "whatsapp_cloud", account_kind: "device" }
    ]) {
      expect(
        await ask(
          scriptedTx({ account: cloudAccount(over), capability: grantedRow() })
            .tx
        )
      ).toEqual({ usable: false, reason: "NOT_A_WHATSAPP_SENDER" });
    }
    expect(isWhatsappSenderShape("starsender", "device")).toBe(true);
    expect(isWhatsappSenderShape("whatsapp_cloud", "waba")).toBe(false);
  });

  test("every status that is not connected names its own reason", async () => {
    const expected: Record<string, SenderUnavailableReason> = {
      pending: "ACCOUNT_PENDING",
      degraded: "ACCOUNT_DEGRADED",
      revoked: "ACCOUNT_REVOKED",
      disabled: "ACCOUNT_DISABLED"
    };

    for (const [status, reason] of Object.entries(expected)) {
      expect(
        await ask(
          scriptedTx({
            account: cloudAccount({ status }),
            capability: grantedRow()
          }).tx
        )
      ).toEqual({ usable: false, reason });
    }
  });

  test("unapproved: no capability row, a withdrawn one, missing evidence, or a stale matrix all deny", async () => {
    for (const capability of [
      null,
      grantedRow({ state: "pending_approval" }),
      grantedRow({ state: "denied" }),
      grantedRow({ evidence_ref: null }),
      grantedRow({ matrix_version: PROVIDER_MATRIX_VERSION + 1 })
    ]) {
      expect(
        await ask(scriptedTx({ account: cloudAccount(), capability }).tx)
      ).toEqual({
        usable: false,
        reason: "CAPABILITY_DENIED"
      });
    }
  });

  test("a dead connection denies even a granted capability; a recoverable one waits", async () => {
    const reasons: Record<string, SenderUnavailableReason> = {
      revoked: "CONNECTION_NOT_ACTIVE",
      failed: "CONNECTION_NOT_ACTIVE",
      expired: "CONNECTION_EXPIRED",
      pending: "CONNECTION_EXPIRED"
    };

    for (const [grant_state, reason] of Object.entries(reasons)) {
      expect(
        await ask(
          scriptedTx({
            account: cloudAccount({
              auth_mode: "oauth2",
              connection_id: "conn-1"
            }),
            connection: { grant_state },
            capability: grantedRow()
          }).tx
        )
      ).toEqual({ usable: false, reason });
    }
    // A connection that cannot be read is not an active one.
    expect(
      await ask(
        scriptedTx({
          account: cloudAccount({
            auth_mode: "oauth2",
            connection_id: "conn-1"
          }),
          connection: null,
          capability: grantedRow()
        }).tx
      )
    ).toEqual({ usable: false, reason: "CONNECTION_NOT_ACTIVE" });
  });

  describe("a child number borrows its parent container's connection (audit M3)", () => {
    const child = () =>
      cloudAccount({
        auth_mode: "oauth2",
        connection_id: null,
        secret_id: null,
        parent_account_id: "parent-1"
      });
    const parent = (over: Record<string, unknown> = {}) =>
      cloudAccount({
        id: "parent-1",
        account_kind: "waba",
        auth_mode: "oauth2",
        connection_id: "conn-parent",
        secret_id: null,
        ...over
      });

    test("the EFFECTIVE connection is the parent's, so the port and the credential adapter cannot disagree", async () => {
      const fixture = scriptedTx({
        account: child(),
        parent: parent(),
        connections: { "conn-parent": { grant_state: "active" } },
        capability: grantedRow()
      });

      expect((await ask(fixture.tx)).usable).toBe(true);
      expect(fixture.connectionIds).toEqual(["conn-parent"]);
    });

    test("an EXPIRED parent grant (a permanent refresh failure) is a HOLD for the child, not 'usable'", async () => {
      const fixture = {
        account: child(),
        parent: parent(),
        connections: {
          "conn-parent": { grant_state: "expired", access_secret_id: "a-1" }
        },
        capability: grantedRow()
      };
      const result = await ask(scriptedTx(fixture).tx);

      expect(result).toEqual({ usable: false, reason: "CONNECTION_EXPIRED" });
      expect(classifySenderUnavailable("CONNECTION_EXPIRED")).toBe("hold");

      // The credential adapter reaches the same verdict, so no queued row is
      // failed (OTPs included) while the tenant re-authorises.
      expect(
        await createChannelSenderCredentialAdapter({
          store: { resolve: async () => CANARY } as never,
          env: ENABLED
        }).resolveWhatsappCredential(scriptedTx(fixture).tx, {
          tenantId: T1,
          accountId: S1
        })
      ).toEqual({ ok: false, reason: "CONNECTION_EXPIRED" });
    });

    test("a REVOKED parent grant is terminal for the child", async () => {
      const result = await ask(
        scriptedTx({
          account: child(),
          parent: parent(),
          connections: { "conn-parent": { grant_state: "revoked" } },
          capability: grantedRow()
        }).tx
      );

      expect(result).toEqual({
        usable: false,
        reason: "CONNECTION_NOT_ACTIVE"
      });
      expect(classifySenderUnavailable("CONNECTION_NOT_ACTIVE")).toBe(
        "terminal"
      );
    });

    test("a disabled or revoked parent lends nothing (terminal); a degraded or pending one waits", async () => {
      const expected: Record<string, SenderUnavailableReason> = {
        disabled: "ACCOUNT_DISABLED",
        revoked: "ACCOUNT_REVOKED",
        degraded: "ACCOUNT_DEGRADED",
        pending: "ACCOUNT_PENDING"
      };

      for (const [status, reason] of Object.entries(expected)) {
        expect(
          await ask(
            scriptedTx({
              account: child(),
              parent: parent({ status }),
              connections: { "conn-parent": { grant_state: "active" } },
              capability: grantedRow()
            }).tx
          )
        ).toEqual({ usable: false, reason });
      }
    });

    test("a parent that is not this child's container (other provider, wrong kind) lends nothing", async () => {
      for (const over of [
        { provider: "starsender", account_kind: "device" },
        { account_kind: "waba_phone_number" },
        { provider: "facebook", account_kind: "page" }
      ]) {
        expect(
          await ask(
            scriptedTx({
              account: child(),
              parent: parent(over),
              connections: { "conn-parent": { grant_state: "active" } },
              capability: grantedRow()
            }).tx
          )
        ).toEqual({ usable: false, reason: "CREDENTIAL_UNAVAILABLE" });
      }
    });
  });

  test("StarSender broadcast (marketing) is restricted: it needs contract evidence, and app review is not enough", async () => {
    // The risk text is approved and acknowledged here so the decision under test
    // is the CAPABILITY one (Issue #1142 adds the acknowledgement gate before it).
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

    const device = {
      provider: "starsender",
      account_kind: "device",
      auth_mode: "device_key",
      external_id: "dev-1"
    };

    expect(
      await ask(
        scriptedTx({
          account: cloudAccount(device),
          capability: grantedRow(),
          acknowledged: true
        }).tx,
        "broadcast"
      )
    ).toEqual({ usable: false, reason: "CAPABILITY_DENIED" });
    expect(
      (
        await ask(
          scriptedTx({
            account: cloudAccount(device),
            capability: grantedRow({ evidence_kind: "contract_reference" }),
            acknowledged: true
          }).tx,
          "broadcast"
        )
      ).usable
    ).toBe(true);

    overrideRiskAcknowledgementCatalogueForTests(null);
  });

  test("every query is scoped by the tenant and names columns (no SELECT *)", async () => {
    const { tx, statements } = scriptedTx({
      account: cloudAccount(),
      capability: grantedRow()
    });

    await ask(tx);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toContain("tenant_id =");
      expect(statement).not.toMatch(/SELECT\s+\*/);
    }
  });
});

describe("ChannelSenderCredentialPort adapter (the one place a credential is decrypted)", () => {
  function fakeStore(values: Record<string, string>, fail?: SecretStoreError) {
    const resolved: { secretId: string; purpose: string; tenantId: string }[] =
      [];

    return {
      resolved,
      store: {
        async resolve(
          _tx: Bun.SQL,
          input: { tenantId: string; secretId: string; purpose: string }
        ) {
          resolved.push(input);

          if (fail) throw fail;

          const value = values[input.secretId];

          if (value === undefined)
            throw new SecretStoreError("SECRET_NOT_FOUND");

          return value;
        }
      } as unknown as import("../src/modules/channel-accounts/application/secret-store").SecretStorePort
    };
  }
  const adapter = (
    store: ReturnType<typeof fakeStore>["store"],
    now = new Date("2026-11-01T00:00:00Z")
  ) =>
    createChannelSenderCredentialAdapter({
      store,
      env: ENABLED,
      now: () => now
    });
  const ask = (a: ReturnType<typeof adapter>, tx: Bun.SQL) =>
    a.resolveWhatsappCredential(tx, { tenantId: T1, accountId: S1 });

  test("an api_token account's credential comes from ITS OWN secret reference, for the caller's tenant", async () => {
    const { store, resolved } = fakeStore({ "secret-1": CANARY });
    const { tx } = scriptedTx({ account: cloudAccount() });

    expect(await ask(adapter(store), tx)).toEqual({
      ok: true,
      credential: CANARY
    });
    expect(resolved).toEqual([
      { tenantId: T1, secretId: "secret-1", purpose: "api_token" }
    ]);
  });

  test("an OAuth account uses its connection's access token, only while the grant is active and unexpired", async () => {
    const { store, resolved } = fakeStore({ "access-1": CANARY });
    const oauth = cloudAccount({
      auth_mode: "oauth2",
      connection_id: "conn-1",
      secret_id: null
    });
    const active = {
      grant_state: "active",
      access_secret_id: "access-1",
      expires_at: null
    };

    expect(
      await ask(
        adapter(store),
        scriptedTx({ account: oauth, connection: active }).tx
      )
    ).toEqual({
      ok: true,
      credential: CANARY
    });
    expect(resolved[0]).toEqual({
      tenantId: T1,
      secretId: "access-1",
      purpose: "provider_access_token"
    });

    for (const [connection, reason] of [
      [{ ...active, grant_state: "revoked" }, "CONNECTION_NOT_ACTIVE"],
      [{ ...active, grant_state: "failed" }, "CONNECTION_NOT_ACTIVE"],
      [null, "CONNECTION_NOT_ACTIVE"],
      // Recoverable: the tenant re-authorises or the connector refreshes.
      [{ ...active, grant_state: "expired" }, "CONNECTION_EXPIRED"],
      [{ ...active, grant_state: "pending" }, "CONNECTION_EXPIRED"]
    ] as const) {
      expect(
        await ask(adapter(store), scriptedTx({ account: oauth, connection }).tx)
      ).toEqual({ ok: false, reason });
    }
    // An expired token is not refreshed here and is not used: wait for it.
    expect(
      await ask(
        adapter(store),
        scriptedTx({
          account: oauth,
          connection: {
            ...active,
            expires_at: new Date("2026-10-31T00:00:00Z")
          }
        }).tx
      )
    ).toEqual({ ok: false, reason: "CONNECTION_EXPIRED" });
  });

  test("a child number falls back to its parent container's credential", async () => {
    const { store, resolved } = fakeStore({ "secret-parent": CANARY });
    const child = cloudAccount({
      secret_id: null,
      parent_account_id: "parent-1"
    });
    const parent = cloudAccount({
      id: "parent-1",
      account_kind: "waba",
      secret_id: "secret-parent"
    });

    expect(
      await ask(adapter(store), scriptedTx({ account: child, parent }).tx)
    ).toEqual({
      ok: true,
      credential: CANARY
    });
    expect(resolved[0]!.secretId).toBe("secret-parent");
  });

  test("a child never borrows a secret from a disabled, degraded or foreign parent (audit M3)", async () => {
    const { store, resolved } = fakeStore({ "secret-parent": CANARY });
    const child = cloudAccount({
      secret_id: null,
      parent_account_id: "parent-1"
    });
    const parentOf = (over: Record<string, unknown>) =>
      cloudAccount({
        id: "parent-1",
        account_kind: "waba",
        secret_id: "secret-parent",
        ...over
      });

    for (const [over, reason] of [
      [{ status: "disabled" }, "ACCOUNT_DISABLED"],
      [{ status: "revoked" }, "ACCOUNT_REVOKED"],
      [{ status: "degraded" }, "ACCOUNT_DEGRADED"],
      [{ status: "pending" }, "ACCOUNT_PENDING"],
      [{ account_kind: "waba_phone_number" }, "CREDENTIAL_UNAVAILABLE"],
      [
        { provider: "starsender", account_kind: "device" },
        "CREDENTIAL_UNAVAILABLE"
      ]
    ] as const) {
      expect(
        await ask(
          adapter(store),
          scriptedTx({ account: child, parent: parentOf(over) }).tx
        )
      ).toEqual({ ok: false, reason });
    }
    // The secret store was never asked for the parent's credential.
    expect(resolved).toHaveLength(0);
  });

  test("a revoked, unknown or non-WhatsApp account yields no credential and the store is never touched", async () => {
    const { store, resolved } = fakeStore({ "secret-1": CANARY });

    for (const [account, reason] of [
      [cloudAccount({ status: "revoked" }), "ACCOUNT_REVOKED"],
      [cloudAccount({ status: "disabled" }), "ACCOUNT_DISABLED"],
      [
        cloudAccount({ provider: "facebook", account_kind: "page" }),
        "NOT_A_WHATSAPP_SENDER"
      ],
      [null, "ACCOUNT_NOT_FOUND"]
    ] as const) {
      expect(await ask(adapter(store), scriptedTx({ account }).tx)).toEqual({
        ok: false,
        reason
      });
    }
    expect(resolved).toHaveLength(0);
  });

  test("the control plane off yields no credential", async () => {
    const { store } = fakeStore({ "secret-1": CANARY });
    const off = createChannelSenderCredentialAdapter({
      store,
      env: {} as NodeJS.ProcessEnv
    });

    expect(
      await off.resolveWhatsappCredential(
        scriptedTx({ account: cloudAccount() }).tx,
        {
          tenantId: T1,
          accountId: S1
        }
      )
    ).toEqual({ ok: false, reason: "CHANNEL_ACCOUNTS_DISABLED" });
  });

  test("a missing key ring or an undecryptable secret is a returned reason, and the error never carries the value", async () => {
    for (const [code, reason] of [
      ["KEY_RING_UNAVAILABLE", "SECRET_STORE_UNAVAILABLE"],
      ["DECRYPT_FAILED", "SECRET_STORE_UNAVAILABLE"],
      ["SECRET_NOT_FOUND", "CREDENTIAL_UNAVAILABLE"]
    ] as const) {
      const { store } = fakeStore({}, new SecretStoreError(code));
      const result = await ask(
        adapter(store),
        scriptedTx({ account: cloudAccount() }).tx
      );

      expect(result).toEqual({ ok: false, reason });
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });
});

describe("static contracts", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const source = (file: string) =>
    read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  test("the port input carries no token, phone number id, device id or provider (it cannot be asked for a forged one)", () => {
    const port = source("src/modules/_shared/ports/whatsapp-delivery-port.ts");
    const input = port.slice(
      port.indexOf("export type EnqueueWhatsappInput"),
      port.indexOf("export type EnqueueWhatsappRefusalReason")
    );

    expect(input).toContain("senderAccountId?: string");
    for (const forbidden of [
      /token/i,
      /phoneNumberId/i,
      /phone_number_id/i,
      /deviceId/i,
      /device_key/i,
      /provider/i,
      /secret/i
    ]) {
      expect(input).not.toMatch(forbidden);
    }
  });

  test("the enqueue path never reaches the secret store or the key ring", () => {
    for (const file of [
      "src/modules/whatsapp-delivery/application/whatsapp-enqueue.ts",
      "src/modules/whatsapp-delivery/application/whatsapp-sender-directory.ts",
      "src/modules/whatsapp-delivery/infrastructure/channel-account-port-loader.ts",
      "src/modules/channel-accounts/application/channel-account-port-adapter.ts",
      "src/pages/api/v1/whatsapp/senders.ts",
      "src/pages/api/v1/whatsapp/sender-policy.ts"
    ]) {
      const code = source(file);

      expect(code, file).not.toMatch(
        /secret-store|channel-accounts-config|CHANNEL_SECRETS/
      );
      expect(code, file).not.toMatch(/\.resolve\(/);
    }
  });

  test("only the dispatcher's composition root composes the credential port", () => {
    const importers: string[] = [];

    for (const dir of ["src", "scripts"]) {
      for (const file of new Bun.Glob(`${dir}/**/*.{ts,astro}`).scanSync(".")) {
        if (read(file).includes("channel-sender-credential-adapter")) {
          importers.push(file);
        }
      }
    }

    // The #1145 audit (H1): `social-publishing:dispatch` shares the
    // `awcms_worker` role and must NOT be handed the key ring, or a compromised
    // WhatsApp worker could decrypt social tokens through it. Issue #1160
    // (ADR-0151 section 2) adds exactly the two EMAIL jobs that resolve a
    // tenant's Mailketing token: the dispatcher and the sender verifier.
    expect(importers.sort()).toEqual([
      "scripts/email-dispatch.ts",
      "scripts/email-senders-verify.ts",
      "scripts/whatsapp-dispatch.ts"
    ]);
  });

  test("one queue, no dual write: the migration creates no queue table and the module owns exactly one message table", () => {
    const migration = read("sql/322_awcms_whatsapp_sender_routing.sql");
    const created = [
      ...migration.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)
    ].map((m) => m[1]);

    expect(created).toEqual(["awcms_whatsapp_sender_policies"]);

    const owners = new Set<string>();

    for (const file of readdirSync("sql")) {
      for (const match of read(`sql/${file}`).matchAll(
        /CREATE TABLE IF NOT EXISTS (awcms_\w*whatsapp\w*)/g
      )) {
        owners.add(match[1]!);
      }
    }

    expect([...owners].sort()).toEqual(
      [
        "awcms_whatsapp_consents",
        "awcms_whatsapp_delivery_attempts",
        "awcms_whatsapp_messages",
        "awcms_whatsapp_sender_policies",
        "awcms_whatsapp_suppressions"
      ].sort()
    );
  });

  test("the migration: nullable immutable sender, composite tenant FK, FORCE RLS, worker grants column-only", () => {
    const migration = read("sql/322_awcms_whatsapp_sender_routing.sql");

    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS sender_account_id uuid,"
    );
    expect(migration).not.toMatch(/sender_account_id uuid NOT NULL/);
    expect(migration).toContain(
      "FOREIGN KEY (tenant_id, sender_account_id)\n    REFERENCES awcms_channel_accounts (tenant_id, id)"
    );
    expect(migration).toContain(
      "ALTER TABLE awcms_whatsapp_sender_policies FORCE ROW LEVEL SECURITY;"
    );
    expect(migration).toContain(
      "a WhatsApp message sender snapshot is immutable"
    );
    expect(migration).toContain("SET search_path = public, pg_temp");
    // The worker is never granted a write, and a whole-table read of exactly one
    // table: the policy (an enqueueing job reads the default sender). Every
    // channel_accounts table is column-only.
    const grants = [
      ...migration.matchAll(/GRANT\s+([^;]*?)\s+TO awcms_worker;/g)
    ];

    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant[1], grant[0]).toMatch(/^SELECT\b/);
      expect(grant[1], grant[0]).not.toMatch(
        /INSERT|UPDATE|DELETE|ALL|TRUNCATE/
      );
    }
    expect(
      grants
        .filter((grant) => !/^SELECT\s*\(/.test(grant[1]!))
        .map((grant) => grant[1])
    ).toEqual(["SELECT ON awcms_whatsapp_sender_policies"]);
  });

  test("H1: the worker's rows of awcms_channel_secrets are bounded by a RESTRICTIVE policy to the purposes a send resolves", () => {
    const migration = read(
      "sql/324_awcms_whatsapp_sender_routing_hardening.sql"
    );
    const policy =
      /CREATE POLICY (\w+)\s+ON awcms_channel_secrets\s+AS RESTRICTIVE\s+FOR SELECT\s+TO awcms_worker\s+USING \(purpose IN \(([^)]*)\)\);/.exec(
        migration
      );

    expect(policy).not.toBeNull();

    const purposes = policy![2]!
      .split(",")
      .map((purpose) => purpose.trim().replaceAll("'", ""))
      .sort();

    expect(purposes).toEqual([
      "api_token",
      "device_key",
      "provider_access_token"
    ]);
    // Real purpose names, not a typo that would hide a credential or hide too much.
    for (const purpose of purposes) {
      expect(CHANNEL_SECRET_PURPOSES as readonly string[]).toContain(purpose);
    }
    // The credential adapter asks for exactly these and nothing else.
    const adapter = source(
      "src/modules/channel-accounts/application/channel-sender-credential-adapter.ts"
    );
    const asked = [...adapter.matchAll(/"(\w+_(?:token|key))"/g)]
      .map((match) => match[1]!)
      .filter((name) =>
        (CHANNEL_SECRET_PURPOSES as readonly string[]).includes(name)
      );

    expect(new Set(asked)).toEqual(new Set(purposes));
    // The permissive policy of sql/318 is not touched, and the migration says
    // honestly what AES-GCM associated data does not do.
    expect(migration).not.toMatch(/DROP POLICY|ALTER POLICY/);
    expect(migration).toContain("NOT a mitigation");
  });

  test("L2: a policy delete is blocked for every role", () => {
    const migration = read(
      "sql/324_awcms_whatsapp_sender_routing_hardening.sql"
    );

    expect(migration).toContain(
      "BEFORE DELETE ON awcms_whatsapp_sender_policies"
    );
    expect(migration).toContain("SET search_path = public, pg_temp");
  });

  test("the sender-routing surface is seeded, enforced and declared", () => {
    const module = listModules().find((m) => m.key === "whatsapp_delivery")!;

    expect(module.capabilities?.consumes).toContainEqual({
      capability: "channel_account",
      providedBy: "channel_accounts",
      optional: true
    });
    expect(module.dependencies).not.toContain("channel_accounts");
    expect(
      listModules().find((m) => m.key === "channel_accounts")!.capabilities
        ?.provides
    ).toContain("channel_account");

    const routes: Record<string, [string, string]> = {
      "src/pages/api/v1/whatsapp/senders.ts": ["senders", "read"],
      "src/pages/api/v1/whatsapp/sender-policy.ts": [
        "sender_policy",
        "configure"
      ]
    };

    for (const [file, [activity, action]] of Object.entries(routes)) {
      const route = read(file);

      expect(route).toContain(`activityCode: "${activity}"`);
      expect(route).toContain(`action: "${action}"`);
      expect(
        read("sql/323_awcms_whatsapp_sender_routing_permissions.sql")
      ).toContain(`('whatsapp_delivery', '${activity}', '${action}'`);
    }

    const policy = read("src/pages/api/v1/whatsapp/sender-policy.ts");

    expect(policy).toContain("Idempotency-Key");
    expect(policy).toContain('severity: "warning"');
    expect(policy).toContain("recordAuditEvent");
  });

  test("the port is versioned additively and registered", () => {
    expect(
      read("src/modules/_shared/capability-contract-versions.ts")
    ).toContain('whatsapp_delivery: "1.2.0"');
    expect(read("awcms-family-compatibility.yaml")).toContain(
      'whatsapp_delivery: "1.2.0"'
    );
  });

  test("#1233 H1: the worker's secret visibility is provider-aware, adds no grant, and readiness pins it", () => {
    const migration = source(
      "sql/328_awcms_whatsapp_sender_secret_visibility.sql"
    );

    expect(migration).toContain(
      "CREATE POLICY awcms_channel_secrets_worker_dispatch_purposes"
    );
    expect(migration).toMatch(/AS RESTRICTIVE\s+FOR SELECT\s+TO awcms_worker/);
    expect(migration).toContain(
      "a.provider IN ('whatsapp_cloud', 'starsender')"
    );
    expect(migration).toContain("c.provider = 'whatsapp_cloud'");
    expect(migration).toContain("a.secret_id = awcms_channel_secrets.id");
    expect(migration).toContain(
      "c.access_secret_id = awcms_channel_secrets.id"
    );
    // A policy, not a widening: no GRANT, no other role, no write command.
    expect(migration).not.toMatch(/\bGRANT\b/);
    expect(migration).not.toMatch(/FOR (ALL|INSERT|UPDATE|DELETE)/);

    const readiness = source("scripts/security-readiness.ts");

    expect(readiness).toContain(
      "p.polname = 'awcms_channel_secrets_worker_dispatch_purposes'"
    );
    // Issue #1160 audit M3: no longer a substring pin. The exact normalised
    // expression (which names `whatsapp_cloud`) and a behavioural probe.
    expect(readiness).toContain(
      "normalizePolicyExpression(expr) !== WORKER_SECRET_POLICY_EXPRESSION"
    );
    expect(readiness).toContain("a.provider=any(array['whatsapp_cloud'");
    expect(readiness).toContain("probeWorkerSecretVisibility(sql)");
  });

  test("#1233 M1: both sender routes ask channel_accounts, default-deny, and never trust the body's scope", () => {
    const put = source("src/pages/api/v1/whatsapp/sender-policy.ts");
    const list = source("src/pages/api/v1/whatsapp/senders.ts");

    for (const route of [put, list]) {
      expect(route).toContain("loadSenderAccess");
    }

    expect(put).toContain("access.authorizeScope(");
    expect(put).toContain("access.canUseAccount(");
    expect(put).toContain('"ACCESS_DENIED"');
    expect(list).toContain("access.isConfined(");
    expect(list).toContain("access.scopeCovered(");
    expect(list).toContain("canSee(");
  });

  test("the deployment sender's provider resolver is untouched by tenant senders", () => {
    const resolver = source(
      "src/modules/whatsapp-delivery/infrastructure/whatsapp-provider-resolver.ts"
    );

    expect(resolver).toContain("env.WHATSAPP_PROVIDER");
    expect(resolver).not.toMatch(/channel|sender/i);
  });
});

describe("sender hardening (Issue #1231)", () => {
  const strip = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const dispatchSource = strip(
    readFileSync(
      "src/modules/whatsapp-delivery/application/whatsapp-dispatch.ts",
      "utf8"
    )
  );
  const between = (text: string, from: string, to: string) =>
    text.slice(text.indexOf(from), text.indexOf(to));

  test("L1: the revalidation interval has a safe default, takes a configured value, and never goes below 1", () => {
    expect(resolveWhatsappSenderRevalidateEveryRows({})).toBe(10);
    expect(
      resolveWhatsappSenderRevalidateEveryRows({
        WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS: "3"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(3);

    for (const garbage of ["", "nope", "0", "-4", "NaN"]) {
      expect(
        resolveWhatsappSenderRevalidateEveryRows({
          WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS: garbage
        } as unknown as NodeJS.ProcessEnv)
      ).toBe(10);
    }

    expect(
      resolveWhatsappSenderRevalidateEveryRows({
        WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS: "0.4"
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(1);
  });

  test("L1: the gate drops the cached verdicts AND the built provider every N rows, and never clears a provider-rejected credential", () => {
    const gate = between(
      dispatchSource,
      "async function gateRow(",
      "async function processRow("
    );

    expect(gate).toContain("lane.rowsSinceRevalidation >= revalidateEveryRows");
    expect(gate).toContain("lane.verdicts.clear()");
    expect(gate).toContain("lane.provider = null");
    // The refresh sits BEFORE the first use of the cached state.
    expect(gate.indexOf("lane.verdicts.clear()")).toBeLessThan(
      gate.indexOf("resolveLaneSender(")
    );
    expect(gate.indexOf("lane.provider = null")).toBeLessThan(
      gate.indexOf("if (!lane.provider)")
    );
    // A 401 from the provider is a fact about its answer, not a cached verdict.
    expect(gate).not.toMatch(/credentialRejected\s*=\s*false/);
  });

  test("M2: the allowance is computed and claimed in ONE transaction under a per-sender advisory lock", () => {
    const claim = between(
      dispatchSource,
      "async function claimEligibleMessages(",
      "async function finalizeTerminal("
    );

    expect(claim).toContain("pg_advisory_xact_lock");
    expect(claim).toContain("hashtextextended(");
    expect(claim).toContain("senderAllowance(");
    // Lock first, then the allowance, then the claim: the order inside the transaction.
    expect(claim.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      claim.indexOf("senderAllowance(")
    );
    expect(claim.indexOf("senderAllowance(")).toBeLessThan(
      claim.indexOf("FOR UPDATE SKIP LOCKED")
    );
    // The locked scan keeps the due predicate and the lane predicate.
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("sender_account_id = ${laneSenderId}::uuid");
    // The lock is keyed on the sender (and its tenant), one lock per transaction.
    expect(claim.match(/pg_advisory_xact_lock/g)).toHaveLength(1);
    expect(claim).toContain("${tenantId}:${laneSenderId}");
  });

  test("M2: the allowance is no longer read in a separate transaction before the claim", () => {
    const main = between(
      dispatchSource,
      "export async function dispatchWhatsappQueue(",
      "async function senderPort("
    );

    expect(main).not.toContain("senderAllowance(");
    expect(main).toContain("claimEligibleMessages(");
  });

  test("M2: nothing network-bound runs inside the locked claim transaction", () => {
    const claim = between(
      dispatchSource,
      "async function claimEligibleMessages(",
      "async function finalizeTerminal("
    );

    expect(claim).not.toMatch(
      /\.send\(|resolveProvider|fetch\(|resolveLaneSender/
    );
  });

  test("L5: lane discovery splits quota-held lanes from servable ones, and only servable lanes set the fair share", () => {
    const discover = between(
      dispatchSource,
      "async function discoverLanes(",
      "async function claimEligibleMessages("
    );

    expect(discover).toContain("sent_hour");
    expect(discover).toContain("in_flight");
    expect(discover).toContain("WHERE NOT held");
    expect(discover).toContain("WHERE held");
    expect(discover.match(/LIMIT \$\{MAX_LANES_PER_PASS\}/g)).toHaveLength(2);

    const main = between(
      dispatchSource,
      "export async function dispatchWhatsappQueue(",
      "async function senderPort("
    );

    expect(main).toContain("discovered.quotaHeld");
    expect(main).toContain("const lanes = discovered.servable");
    // The share is computed from the servable lanes only.
    expect(main).toMatch(
      /lanes\.filter\(\(lane\) => lane !== null \|\| !breakerOpen\)/
    );
    expect(main).not.toContain("discovered.quotaHeld.length");
  });

  test("L5: the discovery pre-filter counts the way senderAllowance does (sent in the hour and day, plus in flight)", () => {
    const directory = readFileSync(
      "src/modules/whatsapp-delivery/application/whatsapp-sender-directory.ts",
      "utf8"
    );
    const allowance = between(
      directory,
      "export async function senderAllowance(",
      "export function logSenderRefusal("
    );
    const discover = between(
      dispatchSource,
      "async function discoverLanes(",
      "async function claimEligibleMessages("
    );

    for (const fragment of [
      "status = 'sent'",
      "interval '1 hour'",
      "interval '1 day'",
      "status = 'sending'"
    ]) {
      expect(allowance).toContain(fragment);
      expect(discover).toContain(fragment);
    }
  });

  test("L4: the route comment and the OpenAPI text state the real order (prepare first, schema after authorization)", () => {
    const route = readFileSync(
      "src/pages/api/v1/whatsapp/sender-policy.ts",
      "utf8"
    );
    const openapi = readFileSync(
      "openapi/modules/whatsapp-delivery.openapi.yaml",
      "utf8"
    );
    const policyOp = openapi.slice(
      openapi.indexOf("/api/v1/whatsapp/sender-policy:"),
      openapi.indexOf("operationId", openapi.indexOf("sender-policy:") + 400) +
        3000
    );

    expect(route).not.toContain(
      "The body is validated AFTER\n * authorization so an unauthorised token learns nothing about the schema."
    );
    expect(route).toContain("`prepare` runs FIRST");
    expect(route).toContain("before the permission check");
    expect(policyOp).toContain("before the");
    expect(policyOp).toContain("permission check");
    expect(policyOp).not.toContain(
      "The\n        body is validated after authorization."
    );
  });

  test("L6: migration 329 replaces both guards with the WhatsApp shape and the connected-default rule, never editing an applied migration", () => {
    const sql = readFileSync(
      "sql/329_awcms_whatsapp_sender_guard_shape.sql",
      "utf8"
    );

    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION awcms_whatsapp_messages_sender_guard()"
    );
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION awcms_whatsapp_sender_policies_guard()"
    );
    expect(sql).toContain("SET search_path = public, pg_temp");
    // The shape is the one `isWhatsappSenderShape` accepts.
    expect(sql).toContain(
      "v_provider = 'whatsapp_cloud' AND v_kind = 'waba_phone_number'"
    );
    expect(sql).toContain("v_provider = 'starsender' AND v_kind = 'device'");
    expect(isWhatsappSenderShape("whatsapp_cloud", "waba_phone_number")).toBe(
      true
    );
    expect(isWhatsappSenderShape("starsender", "device")).toBe(true);
    expect(isWhatsappSenderShape("whatsapp_cloud", "waba")).toBe(false);
    // The default must be `connected`, and the check is on insert or a changed default.
    expect(sql).toContain("v_status <> 'connected'");
    expect(sql).toContain("TG_OP = 'INSERT'");
    expect(sql).toContain(
      "NEW.default_sender_account_id IS DISTINCT FROM OLD.default_sender_account_id"
    );
    // Forward-only: no trigger or table is dropped or recreated here.
    expect(sql).not.toMatch(/DROP (TRIGGER|TABLE|FUNCTION)/i);
    expect(sql).not.toMatch(/CREATE TRIGGER/i);

    // The immutability and scope checks of `sql/322` survive in the replacement.
    for (const kept of [
      "a WhatsApp message sender snapshot is immutable",
      "a scoped sender account may only send within its own business scope",
      "a WhatsApp sender policy tenant and business scope are immutable",
      "a WhatsApp sender policy version only moves forward",
      "a scoped sender account may only be the default of its own business scope",
      "a WhatsApp message needs a connected sender account of its own tenant"
    ]) {
      expect(sql).toContain(kept);
    }
  });
});
