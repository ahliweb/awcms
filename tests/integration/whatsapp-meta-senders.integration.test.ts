/**
 * Meta Cloud API multi-WABA, multi-number sender binding against PostgreSQL
 * (Issue #1143, ADR-0148 section 4 and I9).
 *
 * The world: tenant A owns two Meta numbers on two different WABAs, tenant B
 * owns a third. Everything that reaches "Meta" is a fake HTTP client that
 * records the URL (the phone_number_id), the bearer token and the body; the
 * real Meta adapter builds them. Webhooks are signed with each number's own app
 * secret and go through the real verifier (`channel_accounts`) and the real
 * handler, in the tenant transaction the CALLBACK TOKEN names.
 *
 * Business evidence (a Meta app, business verification, WABA ownership) is a
 * HUMAN step and is not simulated as real here: every id, token and secret
 * below is a fixture.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { createHmac } from "node:crypto";

import {
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  reassertRuntimeRoleLogins,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import {
  resetDatabaseCircuitBreakerForTests,
  resetProviderCircuitBreakersForTests
} from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { parseChannelCallbackToken } from "../../src/modules/_shared/channel-webhook-token";
import { createChannelAccountPortAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import {
  createChannelWebhookVerifierAdapter,
  createMetaWebhookSubscription
} from "../../src/modules/channel-accounts/application/webhook-subscription-directory";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import { dispatchWhatsappQueue } from "../../src/modules/whatsapp-delivery/application/whatsapp-dispatch";
import { enqueueWhatsappMessage } from "../../src/modules/whatsapp-delivery/application/whatsapp-enqueue";
import {
  clearMetaRestriction,
  recordMetaTemplate
} from "../../src/modules/whatsapp-delivery/application/whatsapp-meta-directory";
import { handleMetaWebhook } from "../../src/modules/whatsapp-delivery/application/whatsapp-meta-webhook";
import {
  buildRecipientHashes,
  parseRecipientHashKeys
} from "../../src/modules/whatsapp-delivery/domain/whatsapp-recipient";
import { registerWhatsappTemplate } from "../../src/modules/whatsapp-delivery/domain/whatsapp-templates";
import type { WhatsappHttpClient } from "../../src/modules/whatsapp-delivery/infrastructure/whatsapp-http-client";
import { buildWhatsappSenderProvider } from "../../src/modules/whatsapp-delivery/infrastructure/whatsapp-sender-providers";

const TENANT_A = "a1143000-0000-4000-8000-00000000000a";
const TENANT_B = "a1143000-0000-4000-8000-00000000000b";
const PHONE = "+6281234567890";
const PHONE_DIGITS = "6281234567890";
const OTHER_DIGITS = "6289876543210";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 5) % 251)
  ).toString("base64");
const HASH_KEY = bytes(13);
const SECRET_KEY = bytes(17);

const secretRing = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${SECRET_KEY}`
} as unknown as NodeJS.ProcessEnv);

if (!secretRing.ok) throw new Error(secretRing.reason);

const store = createKeyRingSecretStore(() => secretRing);
const ENV = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "log",
  WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${HASH_KEY}`,
  WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR: "1000",
  WHATSAPP_RATE_PER_TENANT_PER_HOUR: "100000"
} as unknown as NodeJS.ProcessEnv;
const CA_ENV = {
  CHANNEL_ACCOUNTS_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;
const recipientRing = parseRecipientHashKeys(ENV);

if (!recipientRing.ok) throw new Error("recipient ring");

const senders = createChannelAccountPortAdapter({ env: CA_ENV });
const credentials = createChannelSenderCredentialAdapter({
  store,
  env: CA_ENV
});
const verifier = createChannelWebhookVerifierAdapter({ store, env: CA_ENV });

registerWhatsappTemplate({
  key: "it1143.reminder",
  version: 1,
  purpose: "transactional",
  body: "Reminder for {{name}}",
  variables: ["name"],
  providerTemplate: { name: "it1143_reminder", language: "id" }
});
registerWhatsappTemplate({
  key: "it1143.reply",
  version: 1,
  purpose: "transactional",
  body: "Thanks {{name}}, we got your message",
  variables: ["name"]
});
registerWhatsappTemplate({
  key: "it1143.promo_text",
  version: 1,
  purpose: "marketing",
  body: "Sale for {{name}}",
  variables: ["name"]
});

const runtime = () => getRuntimeSql();
const inTenant = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(runtime(), tenantId, fn);

let sequence = 0;
const nextKey = () => `k1143-${(sequence += 1)}`;

type MetaNumber = {
  id: string;
  phoneNumberId: string;
  wabaAccountId: string | null;
  wabaId: string | null;
  token: string;
};

async function seedActor(tenantId: string): Promise<string> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', 'it1143') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`it1143-${crypto.randomUUID()}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

async function seedWaba(tenantId: string, wabaId: string): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status)
    VALUES (${tenantId}, 'whatsapp_cloud', 'waba', ${wabaId}, 'waba',
            'api_token', 'connected')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function approve(
  tenantId: string,
  wabaId: string,
  name = "it1143_reminder",
  category = "UTILITY"
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_whatsapp_meta_templates
      (tenant_id, waba_external_id, template_name, language, category,
       provider_status, evidence_ref, source, last_event_at)
    VALUES (${tenantId}, ${wabaId}, ${name}, 'id', ${category},
            'APPROVED', 'fixture', 'operator', now() - interval '1 hour')
  `;
}

/** A connected Meta number with its own API token; `wabaId: null` seeds it WITHOUT a WABA parent. */
async function seedNumber(
  tenantId: string,
  phoneNumberId: string,
  wabaId: string | null
): Promise<MetaNumber> {
  const admin = getAdminSql();
  const wabaAccountId = wabaId ? await seedWaba(tenantId, wabaId) : null;
  const rows = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, parent_account_id)
    VALUES (${tenantId}, 'whatsapp_cloud', 'waba_phone_number',
            ${phoneNumberId}, ${`n-${phoneNumberId}`}, 'api_token',
            'connected', ${wabaAccountId})
    RETURNING id
  `) as { id: string }[];
  const id = rows[0]!.id;

  for (const capability of ["dm", "reply", "broadcast"]) {
    await admin`
      INSERT INTO awcms_channel_account_capabilities
        (tenant_id, account_id, capability, state, evidence_kind,
         evidence_ref, matrix_version, verified_at)
      VALUES (${tenantId}, ${id}, ${capability}, 'granted',
              'app_review_reference', 'evidence-1', ${PROVIDER_MATRIX_VERSION},
              now())
    `;
  }

  const token = `TOKEN-${phoneNumberId}`;
  const ref = await inTenant(tenantId, (tx) =>
    store.put(tx, {
      tenantId,
      purpose: "api_token",
      plaintext: token,
      createdBy: null
    })
  );

  await admin`
    UPDATE awcms_channel_accounts SET secret_id = ${ref.secretId}
    WHERE id = ${id}
  `;

  return { id, phoneNumberId, wabaAccountId, wabaId, token };
}

function enqueue(
  tenantId: string,
  over: Partial<Parameters<typeof enqueueWhatsappMessage>[1]> = {}
) {
  return inTenant(tenantId, (tx) =>
    enqueueWhatsappMessage(
      tx,
      {
        tenantId,
        templateKey: "it1143.reminder",
        variables: { name: "Sari" },
        recipient: { kind: "address", phone: PHONE },
        idempotencyKey: nextKey(),
        ...over
      },
      { env: ENV, senders }
    )
  );
}

type Call = { url: string; token: string; body: Record<string, unknown> };

/** The real Meta adapter over a fake network that answers a wamid per call. */
function metaNetwork(
  answer: (call: Call, n: number) => { status: number; body: string } = (
    _call,
    n
  ) => ({
    status: 200,
    body: JSON.stringify({ messages: [{ id: `wamid.T${n}` }] })
  })
) {
  const calls: Call[] = [];
  const http: WhatsappHttpClient = async (url, request) => {
    const call = {
      url,
      token: request.headers.Authorization!.replace(/^Bearer /, ""),
      body: JSON.parse(request.body) as Record<string, unknown>
    };

    calls.push(call);

    return { ok: true, ...answer(call, calls.length) };
  };

  return { calls, http };
}

function dispatch(tenantId: string, http: WhatsappHttpClient) {
  return dispatchWhatsappQueue(getWorkerRoleSql(), tenantId, {
    env: ENV,
    senders,
    credentials,
    now: new Date(Date.now() + 1000),
    buildSenderProvider: (input) =>
      buildWhatsappSenderProvider({ ...input, http })
  });
}

async function row(id: string) {
  return (
    (await getAdminSql()`
      SELECT * FROM awcms_whatsapp_messages WHERE id = ${id}
    `) as Record<string, unknown>[]
  )[0]!;
}

const messageId = (result: { status: string }) =>
  (result as unknown as { messageId: string }).messageId;

async function subscribe(
  tenantId: string,
  actor: string,
  number: MetaNumber,
  appSecret: string
): Promise<string> {
  const created = await inTenant(tenantId, (tx) =>
    createMetaWebhookSubscription(
      tx,
      store,
      tenantId,
      actor,
      number.id,
      appSecret
    )
  );

  if (created.outcome !== "created") throw new Error(created.outcome);

  return created.callbackToken;
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function deliver(token: string, body: string, signature: string | null) {
  const parsed = parseChannelCallbackToken(token);

  if (!parsed) throw new Error("token shape");

  return handleMetaWebhook(
    runtime(),
    parsed,
    { rawBody: body, signatureHeader: signature },
    {
      verifier,
      ring: recipientRing as Extract<typeof recipientRing, { ok: true }>
    }
  );
}

function statusPayload(
  wabaId: string,
  phoneNumberId: string,
  statuses: { id: string; status: string; recipient_id?: string }[],
  time = Math.floor(Date.now() / 1000)
): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        time,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550000000",
                phone_number_id: phoneNumberId
              },
              statuses: statuses.map((s) => ({
                recipient_id: PHONE_DIGITS,
                timestamp: String(time),
                ...s
              }))
            }
          }
        ]
      }
    ]
  });
}

function inboundPayload(
  wabaId: string,
  phoneNumberId: string,
  from: string
): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              messages: [
                {
                  from,
                  id: `wamid.in-${crypto.randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000) - 60),
                  type: "text",
                  text: { body: "THIS CONTENT IS NEVER STORED" }
                }
              ]
            }
          }
        ]
      }
    ]
  });
}

function wabaEvent(
  wabaId: string,
  field: string,
  value: Record<string, unknown>,
  time: number
): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: wabaId, time, changes: [{ field, value }] }]
  });
}

async function requireWorkerRole(): Promise<void> {
  await reassertRuntimeRoleLogins();

  if (!workerRoleActivated) {
    throw new Error(
      "awcms_worker is not provisioned or cannot log in: the worker-role assertions cannot run."
    );
  }
}

function workerTest(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    await requireWorkerRole();
    await fn();
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "whatsapp_delivery Meta multi-WABA senders against PostgreSQL (#1143)",
  () => {
    let actorA: string;
    let actorB: string;
    let a1: MetaNumber;
    let a2: MetaNumber;
    let b1: MetaNumber;

    // Explicit hook budgets: the per-test reset truncates every table and seeds
    // three numbers on three WABAs, which exceeds the 5 s default on a loaded
    // machine and would fail as an "(unnamed)" hook timeout, not as a finding.
    beforeAll(async () => {
      await setupIntegrationDatabase();
    }, 60_000);

    afterAll(async () => {
      await teardownIntegrationDatabase();
    }, 60_000);

    beforeEach(async () => {
      await resetDatabase();
      resetProviderCircuitBreakersForTests();

      for (const [id, code] of [
        [TENANT_A, "wa1143-a"],
        [TENANT_B, "wa1143-b"]
      ] as const) {
        await getAdminSql()`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${id}, ${code}, ${code})
      `;
      }

      actorA = await seedActor(TENANT_A);
      actorB = await seedActor(TENANT_B);
      a1 = await seedNumber(TENANT_A, "1110000000001", "2220000000001");
      a2 = await seedNumber(TENANT_A, "1110000000002", "2220000000002");
      b1 = await seedNumber(TENANT_B, "1110000000003", "2220000000003");

      for (const [tenant, number] of [
        [TENANT_A, a1],
        [TENANT_A, a2],
        [TENANT_B, b1]
      ] as const) {
        await approve(tenant, number.wabaId!);
      }
    }, 30_000);

    describe("outbound: each message leaves through ITS number, WABA and token", () => {
      workerTest(
        "two numbers in one tenant and one in another map to their own phone_number_id and credential",
        async () => {
          const qa1 = await enqueue(TENANT_A, { senderAccountId: a1.id });
          const qa2 = await enqueue(TENANT_A, { senderAccountId: a2.id });
          const qb1 = await enqueue(TENANT_B, { senderAccountId: b1.id });

          for (const [queued, number] of [
            [qa1, a1],
            [qa2, a2],
            [qb1, b1]
          ] as const) {
            expect(queued.status).toBe("queued");

            const message = await row(messageId(queued));

            expect(message.sender_external_id).toBe(number.phoneNumberId);
            expect(message.sender_container_external_id).toBe(number.wabaId);
          }

          const network = metaNetwork();

          await dispatch(TENANT_A, network.http);
          await dispatch(TENANT_B, network.http);

          expect(network.calls).toHaveLength(3);

          for (const number of [a1, a2, b1]) {
            const call = network.calls.find((c) =>
              c.url.includes(`/${number.phoneNumberId}/messages`)
            );

            expect(call, number.phoneNumberId).toBeDefined();
            // Its OWN token: never another number's, never the other tenant's.
            expect(call!.token).toBe(number.token);
            expect(call!.body.type).toBe("template");
          }

          expect((await row(messageId(qa1))).status).toBe("sent");
          expect((await row(messageId(qb1))).status).toBe("sent");
        }
      );
    });

    describe("invalid WABA binding fails closed", () => {
      test("a Meta number with no WABA container is refused at enqueue, never sent through another number", async () => {
        const orphan = await seedNumber(TENANT_A, "1110000000009", null);

        expect(await enqueue(TENANT_A, { senderAccountId: orphan.id })).toEqual(
          {
            status: "refused",
            reason: "SENDER_UNAVAILABLE"
          }
        );
        expect(
          (
            (await getAdminSql()`
            SELECT count(*)::int AS n FROM awcms_whatsapp_messages
          `) as { n: number }[]
          )[0]!.n
        ).toBe(0);
      });

      test("the database refuses a row whose number has no WABA, or whose snapshot names another number or WABA", async () => {
        const orphan = await seedNumber(TENANT_A, "1110000000009", null);
        const insert = (
          sender: string,
          externalId: string | null,
          containerId: string | null
        ) =>
          getAdminSql()`
          INSERT INTO awcms_whatsapp_messages
            (tenant_id, idempotency_key, template_key, purpose, recipient,
             recipient_hash, recipient_masked, body, sender_account_id,
             sender_selection, sender_external_id, sender_container_external_id)
          VALUES (${TENANT_A}, ${nextKey()}, 'it1143.reminder', 'transactional',
                  ${PHONE}, 'k1:x', 'masked', 'b', ${sender}, 'explicit',
                  ${externalId}, ${containerId})
        `;

        for (const [what, attempt] of [
          ["no WABA", insert(orphan.id, null, null)],
          ["another number", insert(a1.id, a2.phoneNumberId, null)],
          ["another WABA", insert(a1.id, null, a2.wabaId)]
        ] as const) {
          const error = (await assertRejected(attempt, what)) as {
            errno?: string;
          };

          resetDatabaseCircuitBreakerForTests();
          expect(String(error.errno), what).toBe("23514");
        }
      });

      workerTest(
        "a number re-parented under another WABA after enqueue is not sent from the new binding",
        async () => {
          const queued = await enqueue(TENANT_A, { senderAccountId: a1.id });

          await getAdminSql()`
          UPDATE awcms_channel_accounts SET parent_account_id = ${a2.wabaAccountId}
          WHERE id = ${a1.id}
        `;

          const network = metaNetwork();

          await dispatch(TENANT_A, network.http);

          expect(network.calls).toHaveLength(0);

          const message = await row(messageId(queued));

          expect(message.status).toBe("failed");
          expect(message.failure_code).toBe("sender_unavailable");
          expect(String(message.last_error)).toContain(
            "SENDER_BINDING_CHANGED"
          );
        }
      );
    });

    describe("templates are approved per WABA, and the window is per number", () => {
      test("a template approved on WABA 1 authorises nothing on WABA 2", async () => {
        await getAdminSql()`
        DELETE FROM awcms_whatsapp_meta_templates
        WHERE waba_external_id = ${a2.wabaId}
      `;

        expect(
          (await enqueue(TENANT_A, { senderAccountId: a1.id })).status
        ).toBe("queued");
        expect(await enqueue(TENANT_A, { senderAccountId: a2.id })).toEqual({
          status: "refused",
          reason: "TEMPLATE_NOT_APPROVED"
        });
      });

      test("a pending, paused or wrong-category template is not approved; an operator approval needs evidence", async () => {
        for (const [status, category] of [
          ["PENDING", "UTILITY"],
          ["PAUSED", "UTILITY"],
          ["FLAGGED", "UTILITY"],
          ["APPROVED", "MARKETING"]
        ] as const) {
          await getAdminSql()`
          UPDATE awcms_whatsapp_meta_templates
          SET provider_status = ${status}, category = ${category}
          WHERE waba_external_id = ${a1.wabaId}
        `;

          expect(
            await enqueue(TENANT_A, { senderAccountId: a1.id }),
            `${status}/${category}`
          ).toEqual({ status: "refused", reason: "TEMPLATE_NOT_APPROVED" });
        }

        const error = (await assertRejected(
          getAdminSql()`
          INSERT INTO awcms_whatsapp_meta_templates
            (tenant_id, waba_external_id, template_name, language,
             category, provider_status, source, last_event_at)
          VALUES (${TENANT_A}, ${a1.wabaId}, 'no_evidence', 'id',
                  'UTILITY', 'APPROVED', 'operator', now())
        `,
          "approval without evidence"
        )) as { errno?: string };

        resetDatabaseCircuitBreakerForTests();
        expect(String(error.errno)).toBe("23514");
      });

      test("an operator cannot record a template on another tenant's WABA", async () => {
        expect(
          await inTenant(TENANT_A, (tx) =>
            recordMetaTemplate(tx, TENANT_A, actorA, {
              containerAccountId: b1.wabaAccountId!,
              name: "x",
              language: "id",
              category: "UTILITY",
              status: "APPROVED",
              evidenceRef: "ref"
            })
          )
        ).toEqual({ outcome: "container_not_found" });
      });

      workerTest(
        "free text goes only inside the window the recipient opened with THAT number; marketing is never free text",
        async () => {
          expect(
            await enqueue(TENANT_A, {
              senderAccountId: a1.id,
              templateKey: "it1143.reply"
            })
          ).toEqual({ status: "refused", reason: "OUTSIDE_SERVICE_WINDOW" });

          const secretA1 = "appsecretA1appsecretA1appsecret1";
          const tokenA1 = await subscribe(TENANT_A, actorA, a1, secretA1);
          const body = inboundPayload(
            a1.wabaId!,
            a1.phoneNumberId,
            PHONE_DIGITS
          );
          const outcome = await deliver(tokenA1, body, sign(secretA1, body));

          expect(outcome.kind).toBe("accepted");

          // Opened for a1 only: a2 (same tenant, same recipient) is still closed.
          expect(
            await enqueue(TENANT_A, {
              senderAccountId: a2.id,
              templateKey: "it1143.reply"
            })
          ).toEqual({ status: "refused", reason: "OUTSIDE_SERVICE_WINDOW" });

          // Marketing with a recorded opt-in, inside the window: still refused,
          // because marketing content must be an approved marketing template.
          await getAdminSql()`
          INSERT INTO awcms_whatsapp_consents
            (tenant_id, recipient_hash, recipient_masked, purpose, status,
             source, unscoped_granted)
          VALUES (${TENANT_A},
                  ${buildRecipientHashes(TENANT_A, PHONE, recipientRing as Extract<typeof recipientRing, { ok: true }>).primary},
                  'masked', 'marketing', 'granted', 'admin', true)
        `;
          expect(
            await enqueue(TENANT_A, {
              senderAccountId: a1.id,
              templateKey: "it1143.promo_text"
            })
          ).toEqual({ status: "refused", reason: "TEMPLATE_NOT_APPROVED" });

          const queued = await enqueue(TENANT_A, {
            senderAccountId: a1.id,
            templateKey: "it1143.reply"
          });

          expect(queued.status).toBe("queued");

          const network = metaNetwork();

          await dispatch(TENANT_A, network.http);

          expect(network.calls).toHaveLength(1);
          expect(network.calls[0]!.body.type).toBe("text");

          // No content was stored anywhere.
          const windows = JSON.stringify(
            await getAdminSql()`SELECT * FROM awcms_whatsapp_service_windows`
          );

          expect(windows).not.toContain("NEVER STORED");
          expect(windows).not.toContain(PHONE_DIGITS);
        }
      );

      workerTest(
        "a template paused by a signed webhook after enqueue is not sent (terminal, not free text)",
        async () => {
          const queued = await enqueue(TENANT_A, { senderAccountId: a1.id });
          const secret = "appsecretA1appsecretA1appsecret1";
          const token = await subscribe(TENANT_A, actorA, a1, secret);
          const body = wabaEvent(
            a1.wabaId!,
            "message_template_status_update",
            {
              event: "PAUSED",
              message_template_id: 1,
              message_template_name: "it1143_reminder",
              message_template_language: "id",
              message_template_category: "UTILITY",
              reason: "NONE"
            },
            Math.floor(Date.now() / 1000)
          );

          expect((await deliver(token, body, sign(secret, body))).kind).toBe(
            "accepted"
          );

          const network = metaNetwork();

          await dispatch(TENANT_A, network.http);

          expect(network.calls).toHaveLength(0);
          expect((await row(messageId(queued))).failure_code).toBe(
            "template_not_approved"
          );
        }
      );
    });

    describe("webhooks: tenant and account come from the token, never the payload", () => {
      test("a spoofed signature, a wrong token, another tenant's subscription id and a rotated token are all refused", async () => {
        const secret = "appsecretA1appsecretA1appsecret1";
        const token = await subscribe(TENANT_A, actorA, a1, secret);
        const tokenB = await subscribe(
          TENANT_B,
          actorB,
          b1,
          "appsecretB1appsecretB1appsecret1"
        );
        const body = statusPayload(a1.wabaId!, a1.phoneNumberId, [
          { id: "wamid.any", status: "delivered" }
        ]);

        expect(await deliver(token, body, null)).toEqual({
          kind: "refused",
          reason: "SIGNATURE_INVALID"
        });
        expect(await deliver(token, body, sign("wrong-secret", body))).toEqual({
          kind: "refused",
          reason: "SIGNATURE_INVALID"
        });
        // Signed for a body that is not this one (a tampered payload).
        expect(
          await deliver(
            token,
            body.replace("delivered", "read"),
            sign(secret, body)
          )
        ).toEqual({ kind: "refused", reason: "SIGNATURE_INVALID" });

        // The right tenant and subscription with another secret part.
        const forged = `${token.slice(0, token.lastIndexOf(".") + 1)}${"A".repeat(43)}`;

        expect(await deliver(forged, body, sign(secret, body))).toEqual({
          kind: "refused",
          reason: "TOKEN_INVALID"
        });

        // Tenant A's tenant id with tenant B's subscription id and secret.
        const parsedB = parseChannelCallbackToken(tokenB)!;
        const crossed = tokenB.replace(parsedB.tenantId, TENANT_A);

        expect(await deliver(crossed, body, sign(secret, body))).toEqual({
          kind: "refused",
          reason: "TOKEN_INVALID"
        });

        // Rotation: the old token stops verifying at once (its subscription is
        // revoked and its app-secret ciphertext erased).
        const rotated = await subscribe(TENANT_A, actorA, a1, secret);

        expect(await deliver(token, body, sign(secret, body))).toEqual({
          kind: "refused",
          reason: "SUBSCRIPTION_INACTIVE"
        });
        expect((await deliver(rotated, body, sign(secret, body))).kind).toBe(
          "accepted"
        );

        // Only the hash of the token is stored, never the token or the secret.
        const stored = JSON.stringify(
          await getAdminSql()`SELECT * FROM awcms_channel_webhook_subscriptions`
        );

        expect(stored).not.toContain(rotated);
        expect(stored).not.toContain(secret);
      });

      test("the Meta handshake answers only with the callback token as verify token", async () => {
        const token = await subscribe(
          TENANT_A,
          actorA,
          a1,
          "appsecretA1appsecretA1appsecret1"
        );
        const parsed = parseChannelCallbackToken(token)!;
        const handshake = (verifyToken: string | null) =>
          inTenant(TENANT_A, (tx) =>
            verifier.verifyMetaHandshake(tx, {
              tenantId: TENANT_A,
              subscriptionId: parsed.subscriptionId,
              token,
              verifyToken
            })
          );

        expect(await handshake(token)).toBe(true);
        expect(await handshake(null)).toBe(false);
        expect(await handshake("something-else")).toBe(false);
      });

      workerTest(
        "statuses reconcile only the bound sender's row; replays and repeats change nothing; order is forward-only",
        async () => {
          const qa1 = await enqueue(TENANT_A, { senderAccountId: a1.id });
          const qa2 = await enqueue(TENANT_A, { senderAccountId: a2.id });
          const qb1 = await enqueue(TENANT_B, { senderAccountId: b1.id });
          const network = metaNetwork((call) => ({
            status: 200,
            body: JSON.stringify({
              messages: [
                {
                  id: `wamid.${String(call.url.match(/\/(\d+)\/messages/)![1])}`
                }
              ]
            })
          }));

          await dispatch(TENANT_A, network.http);
          await dispatch(TENANT_B, network.http);

          const wamid = (n: MetaNumber) => `wamid.${n.phoneNumberId}`;
          const secretA1 = "appsecretA1appsecretA1appsecret1";
          const tokenA1 = await subscribe(TENANT_A, actorA, a1, secretA1);
          const send = (body: string) =>
            deliver(tokenA1, body, sign(secretA1, body));

          // a1's subscription naming a2's and b1's messages: matches nothing.
          const foreign = statusPayload(a1.wabaId!, a1.phoneNumberId, [
            { id: wamid(a2), status: "delivered" },
            { id: wamid(b1), status: "delivered" }
          ]);
          const foreignOutcome = await send(foreign);

          expect(foreignOutcome).toMatchObject({
            kind: "accepted",
            result: { statusesApplied: 0, statusesUnmatched: 2 }
          });

          // A payload naming a2's phone number id or WABA on a1's token: dropped.
          const misbound = statusPayload(a1.wabaId!, a2.phoneNumberId, [
            { id: wamid(a1), status: "delivered" }
          ]);
          const otherWaba = statusPayload(a2.wabaId!, a1.phoneNumberId, [
            { id: wamid(a1), status: "delivered" }
          ]);

          expect(await send(misbound)).toMatchObject({
            result: { statusesApplied: 0, bindingMismatches: 1 }
          });
          expect(await send(otherWaba)).toMatchObject({
            result: { statusesApplied: 0, bindingMismatches: 1 }
          });

          // A status whose recipient is not the row's: not this message.
          const wrongRecipient = statusPayload(a1.wabaId!, a1.phoneNumberId, [
            { id: wamid(a1), status: "delivered", recipient_id: OTHER_DIGITS }
          ]);

          expect(await send(wrongRecipient)).toMatchObject({
            result: { statusesApplied: 0, statusesUnmatched: 1 }
          });

          for (const message of [qa2, qb1]) {
            expect((await row(messageId(message))).provider_status).toBeNull();
          }

          // The real one, then a replay of the exact body, then a repeat.
          const read = statusPayload(a1.wabaId!, a1.phoneNumberId, [
            { id: wamid(a1), status: "read" }
          ]);

          expect(await send(read)).toMatchObject({
            result: { statusesApplied: 1, duplicate: false }
          });
          expect(await send(read)).toMatchObject({
            result: { duplicate: true, statusesApplied: 0 }
          });

          const lateDelivered = statusPayload(
            a1.wabaId!,
            a1.phoneNumberId,
            [{ id: wamid(a1), status: "delivered" }],
            Math.floor(Date.now() / 1000) + 1
          );
          const lateFailed = statusPayload(
            a1.wabaId!,
            a1.phoneNumberId,
            [{ id: wamid(a1), status: "failed" }],
            Math.floor(Date.now() / 1000) + 2
          );

          expect(await send(lateDelivered)).toMatchObject({
            result: { statusesApplied: 0 }
          });
          expect(await send(lateFailed)).toMatchObject({
            result: { statusesApplied: 0 }
          });

          const message = await row(messageId(qa1));

          expect(message.provider_status).toBe("read");
          expect(message.status).toBe("sent");

          const events = (await getAdminSql()`
          SELECT payload FROM awcms_domain_events
          WHERE event_type = 'awcms.whatsapp.message.provider_status_changed'
        `) as { payload: Record<string, unknown> }[];

          expect(events).toHaveLength(1);
          expect(events[0]!.payload).toMatchObject({
            messageId: messageId(qa1),
            senderAccountId: a1.id,
            providerStatus: "read"
          });
          expect(JSON.stringify(events)).not.toContain(PHONE_DIGITS);
        }
      );

      test("a WABA restriction refuses its numbers, a newer reinstatement clears only that restriction, and an older one is ignored", async () => {
        const secret = "appsecretA1appsecretA1appsecret1";
        const token = await subscribe(TENANT_A, actorA, a1, secret);
        const now = Math.floor(Date.now() / 1000);
        const send = (body: string) => deliver(token, body, sign(secret, body));

        await send(
          wabaEvent(
            a1.wabaId!,
            "account_update",
            {
              event: "DISABLED_UPDATE",
              ban_info: { waba_ban_state: "DISABLE" }
            },
            now
          )
        );

        expect(await enqueue(TENANT_A, { senderAccountId: a1.id })).toEqual({
          status: "refused",
          reason: "SENDER_UNAVAILABLE"
        });
        // Another WABA of the same tenant is not affected, and nothing reroutes.
        expect(
          (await enqueue(TENANT_A, { senderAccountId: a2.id })).status
        ).toBe("queued");

        // An OLDER reinstatement (a late retry) does not lift a newer ban.
        await send(
          wabaEvent(
            a1.wabaId!,
            "account_update",
            {
              event: "DISABLED_UPDATE",
              ban_info: { waba_ban_state: "REINSTATE" }
            },
            now - 60
          )
        );
        expect(
          (await enqueue(TENANT_A, { senderAccountId: a1.id })).status
        ).toBe("refused");

        await send(
          wabaEvent(
            a1.wabaId!,
            "account_update",
            {
              event: "DISABLED_UPDATE",
              ban_info: { waba_ban_state: "REINSTATE" }
            },
            now + 60
          )
        );
        expect(
          (await enqueue(TENANT_A, { senderAccountId: a1.id })).status
        ).toBe("queued");

        // A restriction no documented event reverses is cleared by an operator.
        await send(
          wabaEvent(
            a1.wabaId!,
            "account_update",
            { event: "ACCOUNT_RESTRICTION" },
            now + 120
          )
        );
        expect(
          (await enqueue(TENANT_A, { senderAccountId: a1.id })).status
        ).toBe("refused");
        expect(
          await inTenant(TENANT_A, (tx) =>
            clearMetaRestriction(tx, TENANT_A, actorA, a1.wabaId!)
          )
        ).toEqual({
          outcome: "cleared",
          previousReason: "ACCOUNT_RESTRICTION"
        });
        expect(
          (await enqueue(TENANT_A, { senderAccountId: a1.id })).status
        ).toBe("queued");
      });
    });

    describe("tenant isolation", () => {
      workerTest(
        "RLS keeps every new table to its tenant, and the worker cannot write approvals or signals",
        async () => {
          const secret = "appsecretA1appsecretA1appsecret1";
          const token = await subscribe(TENANT_A, actorA, a1, secret);
          const inbound = inboundPayload(
            a1.wabaId!,
            a1.phoneNumberId,
            PHONE_DIGITS
          );

          await deliver(token, inbound, sign(secret, inbound));

          for (const table of [
            "awcms_whatsapp_meta_templates",
            "awcms_whatsapp_service_windows",
            "awcms_whatsapp_webhook_receipts"
          ]) {
            const fromA = (await inTenant(TENANT_A, (tx) =>
              tx.unsafe(`SELECT tenant_id FROM ${table}`)
            )) as { tenant_id: string }[];
            const fromB = (await inTenant(TENANT_B, (tx) =>
              tx.unsafe(`SELECT tenant_id FROM ${table}`)
            )) as { tenant_id: string }[];

            expect(fromA.length, table).toBeGreaterThan(0);
            expect(
              fromA.every((r) => r.tenant_id === TENANT_A),
              table
            ).toBe(true);
            expect(
              fromB.every((r) => r.tenant_id === TENANT_B),
              table
            ).toBe(true);
          }

          for (const [what, probe] of [
            [
              "worker writes an approval",
              (tx: Bun.SQL) => tx`
              UPDATE awcms_whatsapp_meta_templates SET provider_status = 'APPROVED'
            `
            ],
            [
              "worker writes a signal",
              (tx: Bun.SQL) => tx`
              INSERT INTO awcms_whatsapp_meta_sender_signals
                (tenant_id, waba_external_id)
              VALUES (${TENANT_A}, ${a1.wabaId})
            `
            ],
            [
              "worker reads a webhook signing secret",
              (tx: Bun.SQL) => tx`
              SELECT 1 FROM awcms_channel_secrets
              WHERE purpose = 'webhook_signing_secret'
              HAVING count(*) = 0
            `
            ]
          ] as const) {
            const attempt = withTenantOrThrow(
              getWorkerRoleSql(),
              TENANT_A,
              (tx) => probe(tx)
            );

            if (what === "worker reads a webhook signing secret") {
              // The RESTRICTIVE policy of sql/328 hides every webhook secret
              // from the worker: the count it sees is zero.
              expect(((await attempt) as unknown[]).length, what).toBe(1);
            } else {
              const error = (await assertRejected(attempt, what)) as {
                errno?: string;
              };

              resetDatabaseCircuitBreakerForTests();
              expect(String(error.errno), what).toBe("42501");
            }
          }
        }
      );
    });

    describe("security review fixes", () => {
      test("M-1 b: every WABA-level change a webhook makes is audited, with ids and codes only", async () => {
        const secret = "appsecretA1appsecretA1appsecret1";
        const token = await subscribe(TENANT_A, actorA, a1, secret);
        const now = Math.floor(Date.now() / 1000);
        const send = (body: string) => deliver(token, body, sign(secret, body));

        await send(
          wabaEvent(
            a1.wabaId!,
            "message_template_status_update",
            {
              event: "APPROVED",
              message_template_name: "it1143_new",
              message_template_language: "id",
              message_template_category: "MARKETING"
            },
            now
          )
        );
        await send(
          wabaEvent(
            a1.wabaId!,
            "account_update",
            { event: "ACCOUNT_DELETED" },
            now
          )
        );
        await send(
          wabaEvent(
            a1.wabaId!,
            "account_update",
            {
              event: "DISABLED_UPDATE",
              ban_info: { waba_ban_state: "REINSTATE" }
            },
            now + 10
          )
        );
        await send(inboundPayload(a1.wabaId!, a1.phoneNumberId, PHONE_DIGITS));

        const audits = (await getAdminSql()`
          SELECT action, severity, attributes FROM awcms_audit_events
          WHERE tenant_id = ${TENANT_A}
            AND action LIKE 'whatsapp_meta_webhook.%'
          ORDER BY created_at
        `) as {
          action: string;
          severity: string;
          attributes: Record<string, unknown>;
        }[];

        expect(audits.map((a) => a.action)).toEqual([
          "whatsapp_meta_webhook.template_status",
          "whatsapp_meta_webhook.restriction_set",
          "whatsapp_meta_webhook.window_opened"
        ]);
        // A REINSTATE does not lift ACCOUNT_DELETED, so nothing was cleared.
        expect(audits[0]!.severity).toBe("warning");
        expect(audits[0]!.attributes).toMatchObject({
          source: "meta_webhook",
          senderAccountId: a1.id,
          providerStatus: "APPROVED"
        });

        const text = JSON.stringify(audits);

        expect(text).not.toContain(PHONE_DIGITS);
        expect(text).not.toContain(secret);
        expect(text).not.toContain(token);
      });

      test("M-2: 300 random tenants from ONE address hit a 429 before any database work", async () => {
        const { POST } =
          await import("../../src/pages/api/v1/whatsapp/webhooks/meta/[token]");
        const previous = process.env.WHATSAPP_ENABLED;
        const previousKeys = process.env.WHATSAPP_RECIPIENT_HASH_KEYS;

        process.env.WHATSAPP_ENABLED = "true";
        process.env.WHATSAPP_RECIPIENT_HASH_KEYS =
          ENV.WHATSAPP_RECIPIENT_HASH_KEYS;

        try {
          const statuses: number[] = [];

          for (let i = 0; i < 300; i += 1) {
            const forged = `wcb1.${crypto.randomUUID()}.${crypto.randomUUID()}.${"B".repeat(43)}`;
            const response = await POST({
              request: new Request(
                `https://budget.example/api/v1/whatsapp/webhooks/meta/${forged}`,
                {
                  method: "POST",
                  headers: {
                    "x-hub-signature-256": `sha256=${"0".repeat(64)}`
                  },
                  body: "{}"
                }
              ),
              params: { token: forged },
              clientAddress: "203.0.113.7"
            } as never);

            statuses.push(response.status);
          }

          const refused401 = statuses.filter((s) => s === 401).length;
          const limited429 = statuses.filter((s) => s === 429).length;

          expect(limited429).toBeGreaterThan(0);
          // At most the per-address allowance ever reached the database.
          expect(refused401).toBeLessThanOrEqual(120);
          expect(refused401 + limited429).toBe(300);
        } finally {
          if (previous === undefined) delete process.env.WHATSAPP_ENABLED;
          else process.env.WHATSAPP_ENABLED = previous;
          if (previousKeys === undefined) {
            delete process.env.WHATSAPP_RECIPIENT_HASH_KEYS;
          } else process.env.WHATSAPP_RECIPIENT_HASH_KEYS = previousKeys;
        }
      });

      test("M-3 (T5): disconnecting a number erases its webhook app-secret ciphertext", async () => {
        const { disconnectAccount } =
          await import("../../src/modules/channel-accounts/application/account-directory");

        await subscribe(
          TENANT_A,
          actorA,
          a1,
          "appsecretA1appsecretA1appsecret1"
        );

        const ciphertexts = async () =>
          (
            (await getAdminSql()`
              SELECT count(*)::int AS n FROM awcms_channel_secrets
              WHERE tenant_id = ${TENANT_A} AND purpose = 'webhook_signing_secret'
            `) as { n: number }[]
          )[0]!.n;

        expect(await ciphertexts()).toBe(1);

        await inTenant(TENANT_A, (tx) =>
          disconnectAccount(tx, store, TENANT_A, actorA, a1.id)
        );

        expect(await ciphertexts()).toBe(0);
        expect(
          (await getAdminSql()`
            SELECT status, signing_secret_id FROM awcms_channel_webhook_subscriptions
            WHERE tenant_id = ${TENANT_A}
          `) as unknown[]
        ).toEqual([{ status: "revoked", signing_secret_id: null }]);
      });

      workerTest(
        "L-2: the worker may delete only windows and receipts past the purge's retention",
        async () => {
          const secret = "appsecretA1appsecretA1appsecret1";
          const token = await subscribe(TENANT_A, actorA, a1, secret);
          const inbound = inboundPayload(
            a1.wabaId!,
            a1.phoneNumberId,
            PHONE_DIGITS
          );

          await deliver(token, inbound, sign(secret, inbound));

          const workerDelete = (table: string) =>
            withTenantOrThrow(getWorkerRoleSql(), TENANT_A, (tx) =>
              tx.unsafe(`DELETE FROM ${table} RETURNING tenant_id`)
            ) as Promise<unknown[]>;

          // Fresh rows: invisible to the worker's DELETE (no error, nothing gone).
          expect(
            await workerDelete("awcms_whatsapp_service_windows")
          ).toHaveLength(0);
          expect(
            await workerDelete("awcms_whatsapp_webhook_receipts")
          ).toHaveLength(0);

          await getAdminSql()`
            UPDATE awcms_whatsapp_service_windows
            SET last_inbound_at = now() - interval '3 days'
          `;
          await getAdminSql()`
            UPDATE awcms_whatsapp_webhook_receipts
            SET received_at = now() - interval '9 days'
          `;

          expect(
            await workerDelete("awcms_whatsapp_service_windows")
          ).toHaveLength(1);
          expect(
            await workerDelete("awcms_whatsapp_webhook_receipts")
          ).toHaveLength(1);
        }
      );

      test("L-3: a restriction survives the WABA container being deleted and re-registered", async () => {
        const secret = "appsecretA1appsecretA1appsecret1";
        const token = await subscribe(TENANT_A, actorA, a1, secret);
        const body = wabaEvent(
          a1.wabaId!,
          "account_update",
          { event: "ACCOUNT_RESTRICTION" },
          Math.floor(Date.now() / 1000)
        );

        await deliver(token, body, sign(secret, body));

        // Re-onboarding: the old container record goes, a new one with the
        // SAME WABA id arrives, and the number is re-parented under it.
        await getAdminSql()`
          UPDATE awcms_channel_accounts
          SET status = 'deleted', deleted_at = now()
          WHERE id = ${a1.wabaAccountId}
        `;

        const fresh = await seedWaba(TENANT_A, a1.wabaId!);

        await getAdminSql()`
          UPDATE awcms_channel_accounts SET parent_account_id = ${fresh}
          WHERE id = ${a1.id}
        `;

        expect(await enqueue(TENANT_A, { senderAccountId: a1.id })).toEqual({
          status: "refused",
          reason: "SENDER_UNAVAILABLE"
        });
      });

      test("L-5: the HMAC is over the raw bytes, and a signed body that is not UTF-8 is malformed, not refused", async () => {
        const secret = "appsecretA1appsecretA1appsecret1";
        const token = await subscribe(TENANT_A, actorA, a1, secret);
        const bytes = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]);
        const signature = `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;
        const parsed = parseChannelCallbackToken(token)!;
        const outcome = await handleMetaWebhook(
          runtime(),
          parsed,
          { rawBody: bytes, signatureHeader: signature },
          {
            verifier,
            ring: recipientRing as Extract<typeof recipientRing, { ok: true }>
          }
        );

        expect(outcome).toMatchObject({
          kind: "accepted",
          result: { malformed: true }
        });

        // The same bytes decoded and re-encoded are NOT what was signed.
        const lossy = new TextDecoder().decode(bytes);

        expect(
          await handleMetaWebhook(
            runtime(),
            parsed,
            { rawBody: lossy, signatureHeader: signature },
            {
              verifier,
              ring: recipientRing as Extract<typeof recipientRing, { ok: true }>
            }
          )
        ).toEqual({ kind: "refused", reason: "SIGNATURE_INVALID" });
      });
    });
  }
);
