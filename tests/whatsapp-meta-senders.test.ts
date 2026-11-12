/**
 * Pure rules of the Meta Cloud API multi-WABA sender binding (Issue #1143).
 * The database half is `tests/integration/whatsapp-meta-senders.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { requiresAuthenticatedCallerBeforeBody } from "../src/lib/security/api-body-auth-boundary";
import {
  hashChannelCallbackToken,
  mintChannelCallbackToken,
  parseChannelCallbackToken
} from "../src/modules/_shared/channel-webhook-token";
import { computeMetaSignature } from "../src/modules/channel-accounts/application/webhook-subscription-directory";
import { validateCreateWebhookSubscription } from "../src/modules/channel-accounts/domain/channel-accounts-validation";
import {
  classifyMetaAccountUpdate,
  decideMetaSend,
  isServiceWindowOpen,
  metaCategoryForPurpose,
  nextProviderStatus,
  parseMetaWebhook,
  templateChangeWins
} from "../src/modules/whatsapp-delivery/domain/meta-cloud-policy";
import { validateMetaTemplateRecord } from "../src/modules/whatsapp-delivery/domain/whatsapp-validation";
import { createMetaCloudWhatsappProvider } from "../src/modules/whatsapp-delivery/infrastructure/meta-cloud-provider";
import {
  WORKER_PURGE_POLICIES,
  evaluateWorkerPurgePolicies
} from "../scripts/security-readiness";

const TENANT = "a1143000-0000-4000-8000-00000000000a";
const SUB = "b1143000-0000-4000-8000-00000000000b";

describe("the callback token", () => {
  test("is minted with 256 random bits, parses back to its tenant and subscription, and only its hash is stored", () => {
    const token = mintChannelCallbackToken(TENANT, SUB);
    const parsed = parseChannelCallbackToken(token);

    expect(parsed).toEqual({
      tenantId: TENANT,
      subscriptionId: SUB,
      raw: token
    });
    expect(token).not.toBe(mintChannelCallbackToken(TENANT, SUB));
    expect(hashChannelCallbackToken(token)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashChannelCallbackToken(token)).not.toContain(token);
  });

  test("anything that is not exactly the shape is refused", () => {
    const token = mintChannelCallbackToken(TENANT, SUB);

    for (const bad of [
      "",
      token.toUpperCase(),
      `${token}x`,
      token.replace("wcb1.", "wcb2."),
      token.slice(0, -1),
      `${TENANT}.${SUB}`,
      null,
      42,
      "x".repeat(500)
    ]) {
      expect(parseChannelCallbackToken(bad)).toBeNull();
    }
  });
});

describe("the public route is declared, and only it", () => {
  test("the middleware lets the Meta webhook reach its own verification; neighbouring paths still need a session", () => {
    const token = mintChannelCallbackToken(TENANT, SUB);

    expect(
      requiresAuthenticatedCallerBeforeBody(
        "POST",
        `/api/v1/whatsapp/webhooks/meta/${token}`
      )
    ).toBe(false);
    expect(
      requiresAuthenticatedCallerBeforeBody(
        "POST",
        `/api/v1/whatsapp/webhooks/meta/${token}/`
      )
    ).toBe(false);

    for (const path of [
      "/api/v1/whatsapp/webhooks/meta",
      `/api/v1/whatsapp/webhooks/meta/${token}/extra`,
      `/api/v1/whatsapp/webhooks/starsender/${token}`,
      "/api/v1/whatsapp/meta-templates"
    ]) {
      expect(requiresAuthenticatedCallerBeforeBody("POST", path), path).toBe(
        true
      );
    }

    expect(
      requiresAuthenticatedCallerBeforeBody(
        "PUT",
        `/api/v1/whatsapp/webhooks/meta/${token}`
      )
    ).toBe(true);
  });
});

describe("Meta send rules", () => {
  const approved = {
    status: "APPROVED" as const,
    category: "UTILITY" as const
  };

  test("a template message needs a sendable approval of the purpose's category", () => {
    expect(
      decideMetaSend({
        purpose: "transactional",
        hasProviderTemplate: true,
        approval: approved,
        windowOpen: false
      })
    ).toEqual({ ok: true, mode: "template" });

    for (const approval of [
      null,
      { status: "PENDING" as const, category: "UTILITY" as const },
      { status: "PAUSED" as const, category: "UTILITY" as const },
      { status: "FLAGGED" as const, category: "UTILITY" as const },
      { status: "REJECTED" as const, category: "UTILITY" as const },
      { status: "APPROVED" as const, category: "MARKETING" as const }
    ]) {
      expect(
        decideMetaSend({
          purpose: "transactional",
          hasProviderTemplate: true,
          approval,
          windowOpen: true
        })
      ).toEqual({ ok: false, reason: "TEMPLATE_NOT_APPROVED" });
    }

    expect(metaCategoryForPurpose("marketing")).toBe("MARKETING");
    expect(metaCategoryForPurpose("security")).toBe("AUTHENTICATION");
  });

  test("free text only inside the window, and never for marketing", () => {
    const base = {
      hasProviderTemplate: false,
      approval: null
    } as const;

    expect(
      decideMetaSend({ ...base, purpose: "transactional", windowOpen: true })
    ).toEqual({ ok: true, mode: "session" });
    expect(
      decideMetaSend({ ...base, purpose: "transactional", windowOpen: false })
    ).toEqual({ ok: false, reason: "OUTSIDE_SERVICE_WINDOW" });
    expect(
      decideMetaSend({ ...base, purpose: "marketing", windowOpen: true })
    ).toEqual({ ok: false, reason: "TEMPLATE_NOT_APPROVED" });
  });

  test("the window is 24 hours from the last inbound message, and a future timestamp opens nothing", () => {
    const now = new Date("2026-11-11T12:00:00Z");

    expect(isServiceWindowOpen(null, now)).toBe(false);
    expect(isServiceWindowOpen(new Date("2026-11-10T12:00:01Z"), now)).toBe(
      true
    );
    expect(isServiceWindowOpen(new Date("2026-11-10T12:00:00Z"), now)).toBe(
      false
    );
    expect(isServiceWindowOpen(new Date("2026-11-11T13:00:00Z"), now)).toBe(
      false
    );
  });

  test("a template status change wins only when newer; on a tie the not-sendable one wins", () => {
    const t = new Date("2026-11-11T00:00:00Z");
    const later = new Date("2026-11-11T00:00:01Z");

    expect(
      templateChangeWins({
        current: { status: "APPROVED", eventAt: later },
        incoming: { status: "PAUSED", eventAt: t }
      })
    ).toBe(false);
    expect(
      templateChangeWins({
        current: { status: "APPROVED", eventAt: t },
        incoming: { status: "PAUSED", eventAt: t }
      })
    ).toBe(true);
    expect(
      templateChangeWins({
        current: { status: "PAUSED", eventAt: t },
        incoming: { status: "APPROVED", eventAt: t }
      })
    ).toBe(false);
  });
});

describe("provider status is forward-only", () => {
  test("repeats, late older statuses and anything after failed change nothing", () => {
    expect(nextProviderStatus(null, "sent")).toBe("sent");
    expect(nextProviderStatus("sent", "delivered")).toBe("delivered");
    expect(nextProviderStatus("delivered", "delivered")).toBeNull();
    expect(nextProviderStatus("read", "delivered")).toBeNull();
    expect(nextProviderStatus("sent", "failed")).toBe("failed");
    expect(nextProviderStatus("delivered", "failed")).toBeNull();
    expect(nextProviderStatus("failed", "read")).toBeNull();
  });
});

describe("WABA account events", () => {
  test("restrictive events restrict, the documented reversals clear only their own reason, unknown ban states restrict", () => {
    expect(classifyMetaAccountUpdate({ event: "ACCOUNT_DELETED" })).toEqual({
      kind: "restrict",
      reason: "ACCOUNT_DELETED"
    });
    expect(
      classifyMetaAccountUpdate({
        event: "DISABLED_UPDATE",
        ban_info: { waba_ban_state: "REINSTATE" }
      })
    ).toEqual({ kind: "clear", reason: "DISABLED" });
    expect(
      classifyMetaAccountUpdate({
        event: "DISABLED_UPDATE",
        ban_info: { waba_ban_state: "SOMETHING_NEW" }
      })
    ).toEqual({ kind: "restrict", reason: "DISABLED" });
    expect(classifyMetaAccountUpdate({ event: "ACCOUNT_RECONNECTED" })).toEqual(
      { kind: "clear", reason: "OFFBOARDED" }
    );
    expect(
      classifyMetaAccountUpdate({ event: "VOLUME_BASED_PRICING_TIER_UPDATE" })
    ).toEqual({ kind: "ignore" });
  });
});

describe("the webhook payload is read within the token's binding", () => {
  const binding = { wabaId: "222", phoneNumberId: "111" };
  const now = new Date("2026-11-11T12:00:00Z");

  test("another WABA or phone number id is dropped and counted, never applied", () => {
    const parsed = parseMetaWebhook(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "999",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "111" },
                  statuses: [{ id: "w1", status: "read" }]
                }
              }
            ]
          },
          {
            id: "222",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "333" },
                  statuses: [{ id: "w2", status: "read" }]
                }
              },
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "111" },
                  statuses: [
                    { id: "w3", status: "read", recipient_id: "6281234567890" }
                  ]
                }
              }
            ]
          }
        ]
      },
      binding,
      now
    );

    expect(parsed.bindingMismatches).toBe(2);
    expect(parsed.actions).toEqual([
      {
        kind: "status",
        providerMessageId: "w3",
        status: "read",
        recipientDigits: "6281234567890",
        failureCode: null
      }
    ]);
  });

  test("inbound messages carry only the sender's digits and a clamped time, never content", () => {
    const parsed = parseMetaWebhook(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "222",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "111" },
                  messages: [
                    {
                      from: "6281234567890",
                      timestamp: "9999999999",
                      text: { body: "secret words" }
                    }
                  ]
                }
              }
            ]
          }
        ]
      },
      binding,
      now
    );

    expect(parsed.actions).toEqual([
      { kind: "inbound", fromDigits: "6281234567890", at: now }
    ]);
    expect(JSON.stringify(parsed)).not.toContain("secret words");
  });

  test("a payload that is not a WhatsApp business account object is ignored", () => {
    expect(
      parseMetaWebhook({ object: "page", entry: [] }, binding, now)
    ).toEqual({ actions: [], bindingMismatches: 0, ignored: 1 });
  });

  // #1267 audit M3: `entry.time` orders template, limit and account events.
  // A future one would win against every genuine later event (state frozen
  // until 2100); a finite but out-of-range one was an `Invalid Date`, a 503,
  // and Meta retrying the delivery for a week.
  // An inbound message timestamp past the Date range is unreadable: the
  // message is ignored, never an `Invalid Date` window.
  test.each([
    ["the year 2100", 4102444800, ["account", "inbound", "template"]],
    ["1e300", 1e300, ["account", "template"]],
    [
      "a twelve-digit string far in the future",
      "999999999999",
      ["account", "inbound", "template"]
    ]
  ] as const)(
    "an entry.time of %s is clamped to the moment the webhook arrived",
    (_label, time, kinds) => {
      const parsed = parseMetaWebhook(
        {
          object: "whatsapp_business_account",
          entry: [
            {
              id: "222",
              time,
              changes: [
                {
                  field: "message_template_status_update",
                  value: {
                    event: "APPROVED",
                    message_template_category: "MARKETING",
                    message_template_name: "promo",
                    message_template_language: "en_US"
                  }
                },
                {
                  field: "account_update",
                  value: { event: "DISABLED_UPDATE" }
                },
                {
                  field: "messages",
                  value: {
                    metadata: { phone_number_id: "111" },
                    messages: [{ from: "6281234567890", timestamp: time }]
                  }
                }
              ]
            }
          ]
        },
        binding,
        now
      );
      const stamped = parsed.actions.flatMap((action) =>
        "eventAt" in action
          ? [action.eventAt]
          : action.kind === "inbound"
            ? [action.at]
            : []
      );

      expect(parsed.actions.map((action) => action.kind).sort()).toEqual([
        ...kinds
      ]);
      for (const at of stamped) expect(at.getTime()).toBe(now.getTime());
    }
  );

  test("a past entry.time is kept as Meta stated it", () => {
    const parsed = parseMetaWebhook(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "222",
            time: Math.floor(now.getTime() / 1000) - 3600,
            changes: [
              {
                field: "account_update",
                value: { event: "DISABLED_UPDATE" }
              }
            ]
          }
        ]
      },
      binding,
      now
    );
    const account = parsed.actions[0] as { eventAt: Date };

    expect(account.eventAt.getTime()).toBe(now.getTime() - 3_600_000);
  });
});

describe("validation and the adapter", () => {
  test("an operator approval needs evidence; the app secret is shape-checked and never echoed", () => {
    const base = {
      containerAccountId: SUB,
      name: "order_update",
      language: "id",
      category: "UTILITY",
      status: "APPROVED"
    };

    expect(validateMetaTemplateRecord(base).valid).toBe(false);
    expect(
      validateMetaTemplateRecord({ ...base, evidenceRef: "WM-123" }).valid
    ).toBe(true);
    expect(
      validateMetaTemplateRecord({ ...base, status: "PAUSED" }).valid
    ).toBe(true);
    expect(
      validateMetaTemplateRecord({
        ...base,
        evidenceRef: "x",
        phoneNumberId: "1"
      }).valid
    ).toBe(false);

    const refused = validateCreateWebhookSubscription({ appSecret: "short" });

    expect(refused.valid).toBe(false);
    expect(JSON.stringify(refused)).not.toContain("short");
    expect(
      validateCreateWebhookSubscription({
        appSecret: "0123456789abcdef0123456789abcdef"
      }).valid
    ).toBe(true);
  });

  test("X-Hub-Signature-256 is the HMAC-SHA256 of the exact bytes", () => {
    expect(computeMetaSignature("secret", "{}")).toBe(
      new Bun.CryptoHasher("sha256", "secret").update("{}").digest("hex")
    );
    expect(computeMetaSignature("secret", "{ }")).not.toBe(
      computeMetaSignature("secret", "{}")
    );
  });

  test("the Meta adapter sends free text ONLY when the dispatcher verified the window, otherwise templates only", async () => {
    const bodies: Record<string, unknown>[] = [];
    const provider = createMetaCloudWhatsappProvider({
      accessToken: "token",
      phoneNumberId: "1110000000001",
      apiVersion: "v21.0",
      timeoutMs: 1000,
      breakerKey: "it1143-test",
      http: async (_url, request) => {
        bodies.push(JSON.parse(request.body));

        return {
          ok: true,
          status: 200,
          body: '{"messages":[{"id":"wamid.X"}]}'
        };
      }
    });
    const request = {
      to: "+6281234567890",
      toMasked: "masked",
      body: "Hello",
      templateKey: "x.y",
      parameters: []
    };

    expect(await provider.send(request)).toMatchObject({
      ok: false,
      failureCode: "template_not_approved"
    });
    expect(bodies).toHaveLength(0);
    expect(
      await provider.send({ ...request, serviceWindowOpen: true })
    ).toMatchObject({ ok: true, providerMessageId: "wamid.X" });
    expect(bodies[0]).toMatchObject({
      type: "text",
      text: { body: "Hello", preview_url: false }
    });
    // A provider template always wins: the window never turns a template into text.
    await provider.send({
      ...request,
      serviceWindowOpen: true,
      providerTemplate: { name: "t", language: "id" }
    });
    expect(bodies[1]).toMatchObject({ type: "template" });
  });
});

describe("security:readiness pins the worker's purge-only DELETE (review L-2)", () => {
  const exact = Object.entries(WORKER_PURGE_POLICIES).map(
    ([name, expression]) => ({
      name,
      restrictive: true,
      command: "d",
      worker_only: true,
      expression
    })
  );

  test("the exact policies pass", () => {
    expect(evaluateWorkerPurgePolicies(exact)).toEqual([]);
  });

  test("every widening, weakening or loss is a finding (mutations go red)", () => {
    const mutations: ((rows: typeof exact) => typeof exact)[] = [
      (rows) => rows.slice(1),
      (rows) => [{ ...rows[0]!, restrictive: false }, rows[1]!],
      (rows) => [{ ...rows[0]!, command: "*" }, rows[1]!],
      (rows) => [{ ...rows[0]!, worker_only: false }, rows[1]!],
      (rows) => [
        {
          ...rows[0]!,
          expression: "(last_inbound_at < (now() - '00:00:00'::interval))"
        },
        rows[1]!
      ],
      (rows) => [rows[0]!, { ...rows[1]!, expression: "true" }]
    ];

    for (const mutate of mutations) {
      expect(evaluateWorkerPurgePolicies(mutate(exact)).length).toBe(1);
    }
  });
});
