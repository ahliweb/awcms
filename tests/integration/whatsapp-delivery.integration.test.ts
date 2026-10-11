/**
 * `whatsapp_delivery` against a real PostgreSQL, as the least-privilege runtime
 * role (enqueue, consent) and as `awcms_worker` (dispatch, purge), with FORCE
 * RLS in force (Issue #963, ADR-0133 phase 1).
 *
 * The properties that live in the database and in the claim/send/finalise
 * choreography, and that a mock could not prove:
 *
 *   * NO NETWORK I/O INSIDE A TRANSACTION: the fake provider asks Postgres, from
 *     a separate connection, whether the worker role holds any open transaction
 *     at the instant `send` is called. It must hold none.
 *   * provider failure and retry: retryable -> `retry_wait` with backoff and
 *     attempt rows; terminal -> `failed`; exhausted retries -> `failed`; an
 *     invalid number -> failed AND a hard-failure suppression.
 *   * consent: marketing is refused without an opt-in; a withdrawal cancels the
 *     waiting rows at once; and the dispatcher re-reads consent right before the
 *     send, so a withdrawal that bypassed the cancel still stops the message.
 *   * expiry: expired, never sent late; secrets are cleared at a terminal state.
 *   * idempotency, rate limit, scheduled send, cross-tenant isolation, the
 *     worker's grants, and a purge that never deletes a waiting message.
 *   * the phone number appears in exactly one column, and in no event, audit row
 *     or attempt row.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import {
  getProviderCircuitBreaker,
  resetProviderCircuitBreakersForTests
} from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  createSuppression,
  grantMarketingConsent,
  withdrawMarketingConsent
} from "../../src/modules/whatsapp-delivery/application/whatsapp-consent-directory";
import {
  dispatchWhatsappQueue,
  recordWhatsappDispatchFailure
} from "../../src/modules/whatsapp-delivery/application/whatsapp-dispatch";
import {
  cancelWhatsappByCorrelation,
  enqueueWhatsappMessage,
  getWhatsappStatusByCorrelation,
  whatsappDeliveryPortAdapter
} from "../../src/modules/whatsapp-delivery/application/whatsapp-enqueue";
import { purgeWhatsappQueue } from "../../src/modules/whatsapp-delivery/application/whatsapp-queue-purge";
import { WHATSAPP_CIRCUIT_BREAKER_KEY } from "../../src/modules/whatsapp-delivery/domain/whatsapp-config";
import type {
  WhatsappProvider,
  WhatsappSendRequest,
  WhatsappSendResult
} from "../../src/modules/whatsapp-delivery/domain/whatsapp-provider-contract";
import { registerWhatsappTemplate } from "../../src/modules/whatsapp-delivery/domain/whatsapp-templates";

const TENANT_A = "a9630000-0000-4000-8000-00000000000a";
const TENANT_B = "a9630000-0000-4000-8000-00000000000b";
const PHONE = "+6281234567890";
const OTHER_PHONE = "+6289876543210";
const PHONE_DIGITS = "81234567890";

const KEY_A = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const KEY_B = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 251)
).toString("base64");

const ENV = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_PROVIDER: "log",
  WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${KEY_A}`
} as NodeJS.ProcessEnv;

// The consent and suppression functions read the key ring from the process
// environment (as the routes do); the enqueue and dispatch tests pass `ENV`.
process.env.WHATSAPP_RECIPIENT_HASH_KEYS = `k1:${KEY_A}`;

registerWhatsappTemplate({
  key: "it963.reminder",
  version: 1,
  purpose: "transactional",
  body: "Reminder for {{name}}",
  variables: ["name"]
});
registerWhatsappTemplate({
  key: "it963.otp",
  version: 1,
  purpose: "security",
  body: "Your code is {{code}}",
  variables: ["code"],
  secretVariables: ["code"]
});
registerWhatsappTemplate({
  key: "it963.promo",
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
const nextKey = () => `key-${(sequence += 1)}`;

function enqueue(
  tenantId: string,
  over: Partial<Parameters<typeof enqueueWhatsappMessage>[1]> = {},
  env: NodeJS.ProcessEnv = ENV
) {
  return inTenant(tenantId, (tx) =>
    enqueueWhatsappMessage(
      tx,
      {
        tenantId,
        templateKey: "it963.reminder",
        variables: { name: "Sari" },
        recipient: { kind: "address", phone: PHONE },
        idempotencyKey: nextKey(),
        ...over
      },
      { env }
    )
  );
}

type Fake = WhatsappProvider & {
  requests: WhatsappSendRequest[];
  openWorkerTransactions: number[];
};

/** A fake provider that records what it was given and, at the instant of `send`, how many transactions the WORKER role has open. */
function fakeProvider(
  script: (
    request: WhatsappSendRequest,
    call: number
  ) => WhatsappSendResult | Promise<WhatsappSendResult>
): Fake {
  const requests: WhatsappSendRequest[] = [];
  const openWorkerTransactions: number[] = [];

  return {
    requests,
    openWorkerTransactions,
    async send(request) {
      const rows = (await getAdminSql()`
        SELECT count(*)::int AS open
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND usename = 'awcms_worker'
          AND state LIKE 'idle in transaction%'
      `) as { open: number }[];

      openWorkerTransactions.push(rows[0]!.open);
      requests.push(request);

      return await script(request, requests.length);
    },
    async healthCheck() {
      return { ok: true };
    }
  };
}

const OK: WhatsappSendResult = { ok: true, providerMessageId: "wamid.test" };
const RETRY: WhatsappSendResult = {
  ok: false,
  error: "provider timeout",
  retryable: true,
  failureCode: "provider_error"
};

function dispatch(
  tenantId: string,
  provider: WhatsappProvider,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = ENV
) {
  return dispatchWhatsappQueue(getWorkerRoleSql(), tenantId, {
    resolveProvider: () => provider,
    now,
    env
  });
}

async function message(id: string) {
  const rows = (await getAdminSql()`
    SELECT * FROM awcms_whatsapp_messages WHERE id = ${id}
  `) as Record<string, unknown>[];

  return rows[0]!;
}

async function eventTypes(tenantId: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT event_type FROM awcms_domain_events
    WHERE tenant_id = ${tenantId} ORDER BY event_sequence
  `) as { event_type: string }[];

  return rows.map((row) => row.event_type);
}

async function seedTenants(): Promise<void> {
  const admin = getAdminSql();

  for (const [id, code] of [
    [TENANT_A, "wa963-a"],
    [TENANT_B, "wa963-b"]
  ] as const) {
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }
}

/**
 * `workerRoleActivated` is a live binding that `setupIntegrationDatabase` flips
 * in `beforeAll`, so it must be read when the test RUNS — reading it while the
 * suite is being collected would skip every worker test unconditionally.
 */
function workerTest(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    if (!workerRoleActivated) return;

    await fn();
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("whatsapp_delivery against PostgreSQL", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetProviderCircuitBreakersForTests();
    await seedTenants();
  });

  describe("enqueue", () => {
    test("disabled: refused, and not one row is written", async () => {
      const result = await enqueue(TENANT_A, {}, {} as NodeJS.ProcessEnv);

      expect(result).toEqual({ status: "refused", reason: "DISABLED" });
      expect(
        (
          (await getAdminSql()`SELECT count(*)::int AS n FROM awcms_whatsapp_messages`) as {
            n: number;
          }[]
        )[0]!.n
      ).toBe(0);
    });

    test("queues one row, masks the number, and emits an event with no number in it", async () => {
      const result = await enqueue(TENANT_A, { correlationId: "booking-1" });

      expect(result.status).toBe("queued");
      const row = await message((result as { messageId: string }).messageId);

      expect(row.status).toBe("queued");
      expect(row.recipient).toBe(PHONE);
      expect(row.recipient_masked).toBe("+*********7890");
      expect(String(row.recipient_hash)).toMatch(/^k1:[0-9a-f]{64}$/);
      expect(row.body).toBe("Reminder for Sari");
      expect(await eventTypes(TENANT_A)).toEqual([
        "awcms.whatsapp.message.queued"
      ]);

      const events = JSON.stringify(
        await getAdminSql()`SELECT payload FROM awcms_domain_events WHERE tenant_id = ${TENANT_A}`
      );
      expect(events).not.toContain(PHONE_DIGITS);
      expect(events).not.toContain("Reminder");
    });

    test("an idempotent replay returns the existing message and inserts nothing", async () => {
      const first = await enqueue(TENANT_A, { idempotencyKey: "same" });
      const replay = await enqueue(TENANT_A, { idempotencyKey: "same" });

      expect(replay).toEqual({
        status: "duplicate",
        messageId: (first as { messageId: string }).messageId
      });
      expect(
        (
          (await getAdminSql()`SELECT count(*)::int AS n FROM awcms_whatsapp_messages`) as {
            n: number;
          }[]
        )[0]!.n
      ).toBe(1);
      expect(await eventTypes(TENANT_A)).toHaveLength(1);
    });

    test("an unregistered template, a bad number and a missing expiry are refused", async () => {
      expect(await enqueue(TENANT_A, { templateKey: "nope.missing" })).toEqual({
        status: "refused",
        reason: "TEMPLATE_UNKNOWN"
      });
      expect(
        await enqueue(TENANT_A, { recipient: { kind: "address", phone: "12" } })
      ).toEqual({ status: "refused", reason: "RECIPIENT_INVALID" });
      expect(
        await enqueue(TENANT_A, {
          templateKey: "it963.otp",
          variables: { code: "123456" }
        })
      ).toEqual({ status: "refused", reason: "EXPIRY_REQUIRED" });
    });

    test("a variable that is not on the allow-list never reaches the row", async () => {
      const result = await enqueue(TENANT_A, {
        variables: { name: "Sari", netSalary: "12000000" }
      });
      const row = await message((result as { messageId: string }).messageId);

      expect(JSON.stringify(row.variables)).not.toContain("12000000");
      expect(String(row.body)).not.toContain("12000000");
    });

    test("a profile recipient is resolved inside the module; an unresolvable one is refused", async () => {
      const admin = getAdminSql();
      const profile = (await admin`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${TENANT_A}, 'person', 'P') RETURNING id
      `) as { id: string }[];
      const empty = (await admin`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${TENANT_A}, 'person', 'Q') RETURNING id
      `) as { id: string }[];
      await admin`
        INSERT INTO awcms_profile_identifiers
          (tenant_id, profile_id, identifier_type, normalized_value, value_hash, masked_value)
        VALUES (${TENANT_A}, ${profile[0]!.id}, 'whatsapp', ${PHONE}, 'h', 'm')
      `;

      const resolved = await enqueue(TENANT_A, {
        recipient: { kind: "profile", profileId: profile[0]!.id }
      });
      const row = await message((resolved as { messageId: string }).messageId);

      expect(row.recipient).toBe(PHONE);
      expect(row.profile_id).toBe(profile[0]!.id);
      expect(
        await enqueue(TENANT_A, {
          recipient: { kind: "profile", profileId: empty[0]!.id }
        })
      ).toEqual({ status: "refused", reason: "RECIPIENT_UNRESOLVED" });
    });

    test("a per-recipient rate limit refuses the excess", async () => {
      const env = {
        ...ENV,
        WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR: "2"
      } as NodeJS.ProcessEnv;

      expect((await enqueue(TENANT_A, {}, env)).status).toBe("queued");
      expect((await enqueue(TENANT_A, {}, env)).status).toBe("queued");
      expect(await enqueue(TENANT_A, {}, env)).toEqual({
        status: "refused",
        reason: "RATE_LIMITED"
      });
      // Another recipient is unaffected.
      expect(
        (
          await enqueue(
            TENANT_A,
            { recipient: { kind: "address", phone: OTHER_PHONE } },
            env
          )
        ).status
      ).toBe("queued");
    });

    test("the port reads status back by correlation and cancels by correlation", async () => {
      await enqueue(TENANT_A, { correlationId: "booking-9" });
      await enqueue(TENANT_A, { correlationId: "booking-9" });
      await enqueue(TENANT_A, { correlationId: "other" });

      const statuses = await inTenant(TENANT_A, (tx) =>
        whatsappDeliveryPortAdapter.getStatusByCorrelation(
          tx,
          TENANT_A,
          "booking-9"
        )
      );

      expect(statuses).toHaveLength(2);
      expect(JSON.stringify(statuses)).not.toContain(PHONE_DIGITS);
      expect(statuses[0]).toMatchObject({
        status: "queued",
        recipientMasked: "+*********7890"
      });
      expect(
        await inTenant(TENANT_A, (tx) =>
          cancelWhatsappByCorrelation(tx, TENANT_A, "booking-9")
        )
      ).toBe(2);
      expect(
        (
          await inTenant(TENANT_A, (tx) =>
            getWhatsappStatusByCorrelation(tx, TENANT_A, "booking-9")
          )
        ).map((s) => s.status)
      ).toEqual(["cancelled", "cancelled"]);
      expect(
        await inTenant(TENANT_A, (tx) =>
          cancelWhatsappByCorrelation(tx, TENANT_A, "booking-9")
        )
      ).toBe(0);
    });

    test("a rolled-back caller transaction leaves no message and no event", async () => {
      class Rollback extends Error {}

      try {
        await inTenant(TENANT_A, async (tx) => {
          await enqueueWhatsappMessage(
            tx,
            {
              tenantId: TENANT_A,
              templateKey: "it963.reminder",
              variables: { name: "x" },
              recipient: { kind: "address", phone: PHONE },
              idempotencyKey: "rolled-back"
            },
            { env: ENV }
          );
          throw new Rollback();
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Rollback);
      }

      expect(
        (
          (await getAdminSql()`SELECT count(*)::int AS n FROM awcms_whatsapp_messages`) as {
            n: number;
          }[]
        )[0]!.n
      ).toBe(0);
      expect(await eventTypes(TENANT_A)).toEqual([]);
    });
  });

  describe("dispatch (as awcms_worker)", () => {
    workerTest(
      "sends, records an attempt and the provider id, and holds NO open transaction during the provider call",
      async () => {
        const queued = await enqueue(TENANT_A);
        const provider = fakeProvider(() => OK);
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
        expect(provider.requests[0]!.to).toBe(PHONE);
        expect(provider.requests[0]!.toMasked).toBe("+*********7890");
        expect(provider.openWorkerTransactions).toEqual([0]);

        const row = await message((queued as { messageId: string }).messageId);

        expect(row.status).toBe("sent");
        expect(row.provider_message_id).toBe("wamid.test");
        expect(row.sent_at).not.toBeNull();
        expect(await eventTypes(TENANT_A)).toEqual([
          "awcms.whatsapp.message.queued",
          "awcms.whatsapp.message.sent"
        ]);

        const attempts =
          (await getAdminSql()`SELECT * FROM awcms_whatsapp_delivery_attempts`) as Record<
            string,
            unknown
          >[];

        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({
          outcome: "success",
          attempt_no: 1
        });
        expect(JSON.stringify(attempts)).not.toContain(PHONE_DIGITS);
      }
    );

    workerTest(
      "a retryable provider failure backs off, then succeeds; every attempt is recorded",
      async () => {
        const queued = await enqueue(TENANT_A);
        const id = (queued as { messageId: string }).messageId;
        const provider = fakeProvider((_r, call) => (call === 1 ? RETRY : OK));
        const t0 = new Date();

        expect(await dispatch(TENANT_A, provider, t0)).toMatchObject({
          claimed: 1,
          retried: 1,
          sent: 0
        });

        let row = await message(id);
        expect(row.status).toBe("retry_wait");
        expect(row.retry_count).toBe(1);
        expect(
          new Date(row.next_attempt_at as string).getTime()
        ).toBeGreaterThan(t0.getTime());

        // Not due yet: nothing is claimed.
        expect(await dispatch(TENANT_A, provider, t0)).toMatchObject({
          claimed: 0
        });

        const later = new Date(t0.getTime() + 5 * 60_000);
        expect(await dispatch(TENANT_A, provider, later)).toMatchObject({
          claimed: 1,
          sent: 1
        });
        row = await message(id);
        expect(row.status).toBe("sent");

        const attempts = (await getAdminSql()`
        SELECT attempt_no, outcome FROM awcms_whatsapp_delivery_attempts ORDER BY attempt_no
      `) as { attempt_no: number; outcome: string }[];

        expect(attempts).toEqual([
          { attempt_no: 1, outcome: "failure" },
          { attempt_no: 2, outcome: "success" }
        ]);
      }
    );

    workerTest(
      "retries are exhausted into a terminal `failed` the caller can read",
      async () => {
        const queued = await enqueue(TENANT_A, { correlationId: "c-1" });
        const id = (queued as { messageId: string }).messageId;
        const provider = fakeProvider(() => RETRY);
        const env = {
          ...ENV,
          WHATSAPP_SEND_MAX_RETRIES: "1"
        } as NodeJS.ProcessEnv;
        let now = new Date();

        await dispatch(TENANT_A, provider, now, env);
        now = new Date(now.getTime() + 10 * 60_000);
        expect(await dispatch(TENANT_A, provider, now, env)).toMatchObject({
          failed: 1
        });

        const row = await message(id);
        expect(row.status).toBe("failed");
        expect(row.failure_code).toBe("provider_error");
        expect(await eventTypes(TENANT_A)).toContain(
          "awcms.whatsapp.message.failed"
        );
        expect(
          (
            await inTenant(TENANT_A, (tx) =>
              getWhatsappStatusByCorrelation(tx, TENANT_A, "c-1")
            )
          )[0]
        ).toMatchObject({ status: "failed", failureCode: "provider_error" });
      }
    );

    workerTest("a non-retryable rejection fails at once", async () => {
      const queued = await enqueue(TENANT_A);
      const provider = fakeProvider(() => ({
        ok: false,
        error: "rejected",
        retryable: false,
        failureCode: "rejected"
      }));

      expect(await dispatch(TENANT_A, provider)).toMatchObject({
        failed: 1,
        retried: 0
      });
      expect(
        (await message((queued as { messageId: string }).messageId)).status
      ).toBe("failed");
    });

    workerTest(
      "an invalid number fails the row AND hard-failure suppresses the recipient",
      async () => {
        await enqueue(TENANT_A);
        const provider = fakeProvider(() => ({
          ok: false,
          error: "undeliverable",
          retryable: false,
          failureCode: "recipient_invalid",
          recipientInvalid: true
        }));

        expect(await dispatch(TENANT_A, provider)).toMatchObject({
          failed: 1,
          recipientsSuppressed: 1
        });
        expect(await enqueue(TENANT_A)).toEqual({
          status: "suppressed",
          reason: "hard_failure"
        });
        // A security message honours a hard failure too.
        expect(
          await enqueue(TENANT_A, {
            templateKey: "it963.otp",
            variables: { code: "1" },
            expiresAt: new Date(Date.now() + 60_000)
          })
        ).toEqual({ status: "suppressed", reason: "hard_failure" });
      }
    );

    workerTest(
      "an open circuit breaker claims nothing and spends no retry",
      async () => {
        await enqueue(TENANT_A);
        const breaker = getProviderCircuitBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY);

        for (let i = 0; i < 20; i += 1) breaker.recordFailure(new Date());
        const provider = fakeProvider(() => OK);
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 0, breakerOpen: true });
        expect(provider.requests).toHaveLength(0);
      }
    );

    workerTest(
      "disabled: claims nothing and never touches the provider",
      async () => {
        await enqueue(TENANT_A);
        const provider = fakeProvider(() => OK);

        expect(
          await dispatch(
            TENANT_A,
            provider,
            new Date(),
            {} as NodeJS.ProcessEnv
          )
        ).toMatchObject({ claimed: 0 });
        expect(provider.requests).toHaveLength(0);
      }
    );

    workerTest("a scheduled message waits for notBefore", async () => {
      const due = new Date(Date.now() + 3 * 24 * 60 * 60_000);
      const queued = await enqueue(TENANT_A, { notBefore: due });
      const provider = fakeProvider(() => OK);

      expect(await dispatch(TENANT_A, provider)).toMatchObject({ claimed: 0 });
      expect(
        (await message((queued as { messageId: string }).messageId)).status
      ).toBe("queued");
      expect(
        await dispatch(TENANT_A, provider, new Date(due.getTime() + 1000))
      ).toMatchObject({ sent: 1 });
    });

    workerTest(
      "a security message is expired, not sent late, and its secret is cleared",
      async () => {
        const queued = await enqueue(TENANT_A, {
          templateKey: "it963.otp",
          variables: { code: "987654" },
          expiresAt: new Date(Date.now() + 1000)
        });
        const id = (queued as { messageId: string }).messageId;
        expect(String((await message(id)).body)).toContain("987654");
        const provider = fakeProvider(() => OK);
        const result = await dispatch(
          TENANT_A,
          provider,
          new Date(Date.now() + 60_000)
        );

        expect(result).toMatchObject({ expired: 1, sent: 0 });
        expect(provider.requests).toHaveLength(0);

        const row = await message(id);
        expect(row.status).toBe("expired");
        expect(row.body).toBe("");
        expect(row.variables).toEqual({});
        expect(await eventTypes(TENANT_A)).toContain(
          "awcms.whatsapp.message.expired"
        );
      }
    );

    workerTest(
      "a sent OTP is delivered with its code in memory, then cleared from the row, attempts and events",
      async () => {
        const queued = await enqueue(TENANT_A, {
          templateKey: "it963.otp",
          variables: { code: "246810" },
          expiresAt: new Date(Date.now() + 5 * 60_000)
        });
        const provider = fakeProvider(() => OK);

        await dispatch(TENANT_A, provider);

        expect(provider.requests[0]!.body).toContain("246810");
        expect(provider.requests[0]!.parameters).toEqual(["246810"]);

        const row = await message((queued as { messageId: string }).messageId);
        expect(row.status).toBe("sent");
        expect(row.body).toBe("");
        expect(row.variables).toEqual({});

        const everywhere = JSON.stringify({
          attempts:
            await getAdminSql()`SELECT * FROM awcms_whatsapp_delivery_attempts`,
          events: await getAdminSql()`SELECT payload FROM awcms_domain_events`,
          audit: await getAdminSql()`SELECT * FROM awcms_audit_events`
        });
        expect(everywhere).not.toContain("246810");
      }
    );

    workerTest(
      "a non-secret body survives a terminal state until retention",
      async () => {
        const queued = await enqueue(TENANT_A);

        await dispatch(
          TENANT_A,
          fakeProvider(() => OK)
        );

        expect(
          (await message((queued as { messageId: string }).messageId)).body
        ).toBe("Reminder for Sari");
      }
    );

    workerTest(
      "a template unregistered since enqueue fails terminally",
      async () => {
        const queued = await enqueue(TENANT_A);
        await getAdminSql()`
        UPDATE awcms_whatsapp_messages SET template_key = 'gone.template'
        WHERE id = ${(queued as { messageId: string }).messageId}
      `;
        const provider = fakeProvider(() => OK);

        expect(await dispatch(TENANT_A, provider)).toMatchObject({ failed: 1 });
        expect(provider.requests).toHaveLength(0);
        expect(
          (await message((queued as { messageId: string }).messageId))
            .failure_code
        ).toBe("template_unknown");
      }
    );

    workerTest(
      "a worker that died mid-send is re-claimed once its lease has passed",
      async () => {
        const queued = await enqueue(TENANT_A);
        const id = (queued as { messageId: string }).messageId;
        await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = 'sending', next_attempt_at = now() - interval '1 minute'
        WHERE id = ${id}
      `;

        expect(
          await dispatch(
            TENANT_A,
            fakeProvider(() => OK)
          )
        ).toMatchObject({ claimed: 1, sent: 1 });
      }
    );

    workerTest(
      "two dispatchers never send the same row twice (SKIP LOCKED)",
      async () => {
        for (let i = 0; i < 6; i += 1)
          await enqueue(TENANT_A, {
            recipient: { kind: "address", phone: `+62812000000${i}0` }
          });
        const providerA = fakeProvider(() => OK);
        const providerB = fakeProvider(() => OK);

        await Promise.all([
          dispatch(TENANT_A, providerA),
          dispatch(TENANT_A, providerB)
        ]);

        const sent = [...providerA.requests, ...providerB.requests].map(
          (r) => r.to
        );
        expect(new Set(sent).size).toBe(sent.length);
        expect(sent).toHaveLength(6);
      }
    );

    workerTest(
      "a lease lost mid-batch is NEVER sent twice (audit F2)",
      async () => {
        const first = (await enqueue(TENANT_A)) as { messageId: string };
        const second = (await enqueue(TENANT_A, {
          recipient: { kind: "address", phone: OTHER_PHONE }
        })) as { messageId: string };
        // While the first send is in flight, ANOTHER worker's reclaim is simulated
        // for the second row: its lease is already past when this pass reaches it.
        const provider = fakeProvider(async () => {
          await getAdminSql()`
          UPDATE awcms_whatsapp_messages
          SET next_attempt_at = now() - interval '1 minute'
          WHERE id = ${second.messageId}
        `;

          return OK;
        });
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 2, sent: 1, leaseLost: 1 });
        expect(provider.requests.map((r) => r.to)).toEqual([PHONE]);
        expect((await message(first.messageId)).status).toBe("sent");
        // Left for its new owner: not sent, not failed, not overwritten.
        expect((await message(second.messageId)).status).toBe("sending");
      }
    );

    workerTest(
      "finalisation never overwrites a row another owner took over",
      async () => {
        const queued = (await enqueue(TENANT_A)) as { messageId: string };
        const provider = fakeProvider(async () => {
          await getAdminSql()`
          UPDATE awcms_whatsapp_messages
          SET next_attempt_at = now() + interval '1 hour'
          WHERE id = ${queued.messageId}
        `;

          return OK;
        });

        await dispatch(TENANT_A, provider);

        // The lease value was changed by "another owner": our finalise matched
        // nothing, so the row is exactly as that owner left it.
        expect((await message(queued.messageId)).status).toBe("sending");
      }
    );

    workerTest(
      "one row that throws fails THAT row, not the pass (audit F4)",
      async () => {
        const bad = (await enqueue(TENANT_A)) as { messageId: string };
        const good = (await enqueue(TENANT_A, {
          recipient: { kind: "address", phone: OTHER_PHONE }
        })) as { messageId: string };
        const provider = fakeProvider((_request, call) => {
          if (call === 1) throw new Error("boom");

          return OK;
        });
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
        expect((await message(bad.messageId)).status).toBe("failed");
        expect((await message(bad.messageId)).failure_code).toBe(
          "dispatch_error"
        );
        expect((await message(good.messageId)).status).toBe("sent");
      }
    );

    workerTest(
      "a poison pill that keeps being re-claimed reaches `failed` (audit F4)",
      async () => {
        const queued = (await enqueue(TENANT_A)) as { messageId: string };
        const id = queued.messageId;
        const provider = fakeProvider(() => OK);

        // Three prior claims that never finished (the default cap is 3 retries).
        await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = 'sending', retry_count = 3,
            next_attempt_at = now() - interval '1 minute'
        WHERE id = ${id}
      `;
        const result = await dispatch(TENANT_A, provider);

        expect(result).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
        expect(provider.requests).toHaveLength(0);
        expect((await message(id)).failure_code).toBe("retry_exhausted");
      }
    );

    workerTest(
      "a re-claim of an expired lease counts as an attempt",
      async () => {
        const queued = (await enqueue(TENANT_A)) as { messageId: string };
        await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = 'sending', next_attempt_at = now() - interval '1 minute'
        WHERE id = ${queued.messageId}
      `;

        await dispatch(
          TENANT_A,
          fakeProvider(() => OK)
        );

        // Sent on attempt 2: the abandoned claim was attempt 1.
        const attempts = (await getAdminSql()`
        SELECT attempt_no FROM awcms_whatsapp_delivery_attempts
      `) as { attempt_no: number }[];

        expect(attempts.map((a) => a.attempt_no)).toEqual([2]);
      }
    );

    workerTest(
      "provider error text never carries a secret or the body (audit F6)",
      async () => {
        const otp = (await enqueue(TENANT_A, {
          templateKey: "it963.otp",
          variables: { code: "246810" },
          expiresAt: new Date(Date.now() + 5 * 60_000)
        })) as { messageId: string };
        const plain = (await enqueue(TENANT_A, {
          variables: { name: "Sari Wulandari" },
          recipient: { kind: "address", phone: OTHER_PHONE }
        })) as { messageId: string };
        const provider = fakeProvider((request) => ({
          ok: false,
          error: `rejected: "${request.body}" (code ${request.parameters[0]})`,
          retryable: false,
          failureCode: "rejected"
        }));

        await dispatch(TENANT_A, provider);

        const everything = JSON.stringify({
          messages:
            await getAdminSql()`SELECT last_error, failure_code FROM awcms_whatsapp_messages`,
          attempts:
            await getAdminSql()`SELECT * FROM awcms_whatsapp_delivery_attempts`,
          events: await getAdminSql()`SELECT payload FROM awcms_domain_events`
        });

        expect(everything).not.toContain("246810");
        expect(everything).not.toContain("Sari Wulandari");
        expect((await message(otp.messageId)).last_error).toBe(
          "Provider reported rejected."
        );
        expect((await message(plain.messageId)).status).toBe("failed");
      }
    );

    workerTest(
      "an unusable key ring claims nothing (fail closed)",
      async () => {
        await enqueue(TENANT_A);
        const provider = fakeProvider(() => OK);
        const env = {
          WHATSAPP_ENABLED: "true",
          WHATSAPP_PROVIDER: "log"
        } as NodeJS.ProcessEnv;

        expect(
          await dispatch(TENANT_A, provider, new Date(), env)
        ).toMatchObject({ claimed: 0 });
        expect(provider.requests).toHaveLength(0);
      }
    );

    workerTest(
      "a pass that throws as a whole is observable as a dispatch.failed event",
      async () => {
        await recordWhatsappDispatchFailure(
          getWorkerRoleSql(),
          TENANT_A,
          "dispatch_error"
        );

        expect(await eventTypes(TENANT_A)).toEqual([
          "awcms.whatsapp.dispatch.failed"
        ]);
      }
    );
  });

  describe("consent and suppression", () => {
    const promo = (
      over: Partial<Parameters<typeof enqueueWhatsappMessage>[1]> = {}
    ) => enqueue(TENANT_A, { templateKey: "it963.promo", ...over });

    test("marketing without a recorded opt-in is REFUSED, not silently skipped", async () => {
      expect(await promo()).toEqual({
        status: "refused",
        reason: "CONSENT_REQUIRED"
      });
      expect(
        (
          (await getAdminSql()`SELECT count(*)::int AS n FROM awcms_whatsapp_messages`) as {
            n: number;
          }[]
        )[0]!.n
      ).toBe(0);
    });

    test("consent is per recipient: another number is still refused", async () => {
      await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "form"
        })
      );

      expect((await promo()).status).toBe("queued");
      expect(
        await promo({ recipient: { kind: "address", phone: OTHER_PHONE } })
      ).toEqual({
        status: "refused",
        reason: "CONSENT_REQUIRED"
      });
    });

    test("consent stores a hash and a masked form, never the number, and is idempotent", async () => {
      const first = await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "form"
        })
      );
      const again = await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "admin"
        })
      );

      expect(first.outcome).toBe("granted");
      expect(again.outcome === "granted" && again.entry.id).toBe(
        first.outcome === "granted" ? first.entry.id : ""
      );
      const rows =
        (await getAdminSql()`SELECT * FROM awcms_whatsapp_consents`) as Record<
          string,
          unknown
        >[];

      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(PHONE_DIGITS);
      expect(rows[0]).toMatchObject({
        status: "granted",
        source: "admin",
        recipient_masked: "+*********7890"
      });
      expect(await eventTypes(TENANT_A)).toEqual([
        "awcms.whatsapp.consent.granted",
        "awcms.whatsapp.consent.granted"
      ]);
    });

    test("withdrawal cancels the waiting marketing messages at once and blocks new ones", async () => {
      const granted = await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "form"
        })
      );
      const queuedPromo = await promo();
      const queuedReminder = await enqueue(TENANT_A);
      const consentId = granted.outcome === "granted" ? granted.entry.id : "";

      const withdrawn = await inTenant(TENANT_A, (tx) =>
        withdrawMarketingConsent(tx, TENANT_A, null, consentId)
      );

      expect(withdrawn).toMatchObject({
        outcome: "withdrawn",
        cancelledMessages: 1
      });
      expect(
        (await message((queuedPromo as { messageId: string }).messageId)).status
      ).toBe("cancelled");
      // A marketing opt-out never hides a transactional message.
      expect(
        (await message((queuedReminder as { messageId: string }).messageId))
          .status
      ).toBe("queued");
      expect(await promo()).toEqual({
        status: "suppressed",
        reason: "opt_out"
      });
      expect((await enqueue(TENANT_A)).status).toBe("queued");
    });

    workerTest(
      "the dispatcher re-checks consent right before sending, even if the cancel was bypassed",
      async () => {
        await inTenant(TENANT_A, (tx) =>
          grantMarketingConsent(tx, TENANT_A, null, {
            phone: PHONE,
            source: "form"
          })
        );
        const queued = await promo();
        // A withdrawal that did NOT go through `withdrawMarketingConsent`.
        await getAdminSql()`
          UPDATE awcms_whatsapp_consents
          SET status = 'withdrawn', withdrawn_at = now() WHERE tenant_id = ${TENANT_A}
        `;
        const provider = fakeProvider(() => OK);

        expect(await dispatch(TENANT_A, provider)).toMatchObject({
          claimed: 1,
          cancelled: 1,
          sent: 0
        });
        expect(provider.requests).toHaveLength(0);

        const row = await message((queued as { messageId: string }).messageId);
        expect(row.status).toBe("cancelled");
        expect(row.failure_code).toBe("consent_withdrawn");
      }
    );

    test("being in a segment is not consent: nothing but the consent row opens the gate", async () => {
      // A would-be segment/audience table is not consulted anywhere; the only
      // way through is the consent row, which this recipient does not have.
      await getAdminSql().unsafe(
        `CREATE TABLE IF NOT EXISTS it963_segment_members (tenant_id uuid, phone text)`
      );
      await getAdminSql().unsafe(
        `INSERT INTO it963_segment_members VALUES ('${TENANT_A}', '${PHONE}')`
      );

      expect(await promo()).toEqual({
        status: "refused",
        reason: "CONSENT_REQUIRED"
      });
      await getAdminSql().unsafe(`DROP TABLE it963_segment_members`);
    });

    test("a manual suppression cancels waiting transactional mail but never a security message", async () => {
      const reminder = await enqueue(TENANT_A);
      const otp = await enqueue(TENANT_A, {
        templateKey: "it963.otp",
        variables: { code: "1" },
        expiresAt: new Date(Date.now() + 60_000)
      });

      const result = await inTenant(TENANT_A, (tx) =>
        createSuppression(tx, TENANT_A, null, {
          phone: PHONE,
          reason: "manual"
        })
      );

      expect(result).toMatchObject({
        outcome: "created",
        cancelledMessages: 1
      });
      expect(
        (await message((reminder as { messageId: string }).messageId)).status
      ).toBe("cancelled");
      expect(
        (await message((otp as { messageId: string }).messageId)).status
      ).toBe("queued");
      expect(await enqueue(TENANT_A)).toEqual({
        status: "suppressed",
        reason: "opt_out"
      });
      expect(
        (
          await enqueue(TENANT_A, {
            templateKey: "it963.otp",
            variables: { code: "2" },
            expiresAt: new Date(Date.now() + 60_000)
          })
        ).status
      ).toBe("queued");
    });

    test("suppressing an already suppressed number is a safe no-op", async () => {
      await inTenant(TENANT_A, (tx) =>
        createSuppression(tx, TENANT_A, null, {
          phone: PHONE,
          reason: "manual"
        })
      );
      const again = await inTenant(TENANT_A, (tx) =>
        createSuppression(tx, TENANT_A, null, {
          phone: PHONE,
          reason: "stop_reply"
        })
      );

      expect(again.outcome).toBe("already_suppressed");
      expect(
        (
          (await getAdminSql()`SELECT count(*)::int AS n FROM awcms_whatsapp_suppressions`) as {
            n: number;
          }[]
        )[0]!.n
      ).toBe(1);
    });
  });

  describe("recipient hash key ring (audit F1)", () => {
    test("a missing ring refuses enqueue, consent and suppression", async () => {
      const noRing = { WHATSAPP_ENABLED: "true" } as NodeJS.ProcessEnv;

      expect(await enqueue(TENANT_A, {}, noRing)).toEqual({
        status: "refused",
        reason: "MISCONFIGURED"
      });
      expect(
        await inTenant(TENANT_A, (tx) =>
          grantMarketingConsent(
            tx,
            TENANT_A,
            null,
            { phone: PHONE, source: "form" },
            { env: noRing }
          )
        )
      ).toMatchObject({ outcome: "misconfigured" });
      expect(
        await inTenant(TENANT_A, (tx) =>
          createSuppression(
            tx,
            TENANT_A,
            null,
            { phone: PHONE, reason: "manual" },
            { env: noRing }
          )
        )
      ).toMatchObject({ outcome: "misconfigured" });
    });

    test("rows written under an old key are still found after the ring rotates", async () => {
      const ringOld = ENV;
      const ringNew = {
        ...ENV,
        WHATSAPP_RECIPIENT_HASH_KEYS: `k2:${KEY_B},k1:${KEY_A}`
      } as NodeJS.ProcessEnv;

      await inTenant(TENANT_A, (tx) =>
        createSuppression(
          tx,
          TENANT_A,
          null,
          { phone: PHONE, reason: "manual" },
          { env: ringOld }
        )
      );
      await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(
          tx,
          TENANT_A,
          null,
          { phone: OTHER_PHONE, source: "form" },
          { env: ringOld }
        )
      );

      // Under the NEW ring the old suppression still wins, and the old consent
      // still counts, and new rows are written under the new key.
      expect(await enqueue(TENANT_A, {}, ringNew)).toEqual({
        status: "suppressed",
        reason: "opt_out"
      });
      expect(
        (
          await enqueue(
            TENANT_A,
            {
              templateKey: "it963.promo",
              recipient: { kind: "address", phone: OTHER_PHONE }
            },
            ringNew
          )
        ).status
      ).toBe("queued");
      const written = (await enqueue(
        TENANT_A,
        { recipient: { kind: "address", phone: "+6281111111111" } },
        ringNew
      )) as { messageId: string };

      expect(
        String((await message(written.messageId)).recipient_hash).startsWith(
          "k2:"
        )
      ).toBe(true);
      // Suppressing again under the new ring finds the old row, adds none.
      const again = await inTenant(TENANT_A, (tx) =>
        createSuppression(
          tx,
          TENANT_A,
          null,
          { phone: PHONE, reason: "manual" },
          { env: ringNew }
        )
      );

      expect(again.outcome).toBe("already_suppressed");
    });

    test("the stored hash cannot be reproduced without the key", async () => {
      await enqueue(TENANT_A);
      const row = (
        (await getAdminSql()`SELECT recipient_hash FROM awcms_whatsapp_messages`) as {
          recipient_hash: string;
        }[]
      )[0]!;
      const { createHash } = await import("node:crypto");
      const weak = createHash("sha256")
        .update(`whatsapp:v1:${TENANT_A}:${PHONE}`)
        .digest("hex");

      expect(row.recipient_hash).not.toContain(weak);
      expect(row.recipient_hash).not.toContain(PHONE_DIGITS);
    });
  });

  describe("re-granting over an opt-out (audit F3)", () => {
    const grant = (over: Record<string, unknown> = {}) =>
      inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "form",
          ...over
        } as never)
      );

    async function optedOut() {
      const granted = await grant();
      const id = granted.outcome === "granted" ? granted.entry.id : "";

      await inTenant(TENANT_A, (tx) =>
        withdrawMarketingConsent(tx, TENANT_A, null, id)
      );

      return id;
    }

    test("a plain grant over a withdrawn consent is REFUSED and changes nothing", async () => {
      const id = await optedOut();

      expect(await grant()).toEqual({
        outcome: "withdrawn_requires_reinstatement"
      });
      expect(
        (
          (await getAdminSql()`SELECT status FROM awcms_whatsapp_consents WHERE id = ${id}`) as {
            status: string;
          }[]
        )[0]!.status
      ).toBe("withdrawn");
      expect(await enqueue(TENANT_A, { templateKey: "it963.promo" })).toEqual({
        status: "suppressed",
        reason: "opt_out"
      });
    });

    test("reinstating needs the flag AND evidence, and is refused for an import", async () => {
      await optedOut();

      expect(await grant({ reinstateWithdrawn: true })).toEqual({
        outcome: "reinstatement_refused",
        reason: "evidence_required"
      });
      expect(
        await grant({ reinstateWithdrawn: true, evidenceRef: "   " })
      ).toEqual({
        outcome: "reinstatement_refused",
        reason: "evidence_required"
      });
      expect(
        await grant({
          reinstateWithdrawn: true,
          evidenceRef: "ticket-1",
          source: "import"
        })
      ).toEqual({
        outcome: "reinstatement_refused",
        reason: "import_source"
      });
    });

    test("an evidenced reinstatement works and the withdrawal stays on the record", async () => {
      const id = await optedOut();
      const result = await grant({
        reinstateWithdrawn: true,
        evidenceRef: "ticket-42"
      });

      expect(result).toMatchObject({ outcome: "granted", reinstated: true });
      const row = (
        (await getAdminSql()`SELECT status, withdrawn_at, withdrawal_history FROM awcms_whatsapp_consents WHERE id = ${id}`) as {
          status: string;
          withdrawn_at: unknown;
          withdrawal_history: Record<string, unknown>[];
        }[]
      )[0]!;

      expect(row.status).toBe("granted");
      expect(row.withdrawn_at).toBeNull();
      expect(row.withdrawal_history).toHaveLength(1);
      expect(row.withdrawal_history[0]).toMatchObject({
        evidenceRef: "ticket-42",
        source: "form"
      });
      expect(row.withdrawal_history[0]!.withdrawnAt).toBeTruthy();
      expect(
        (await enqueue(TENANT_A, { templateKey: "it963.promo" })).status
      ).toBe("queued");
    });

    test("an ordinary re-grant of a GRANTED consent stays idempotent", async () => {
      const first = await grant();
      const again = await grant({ source: "admin" });

      expect(
        first.outcome === "granted" &&
          again.outcome === "granted" &&
          first.entry.id === again.entry.id
      ).toBe(true);
      expect(again.outcome === "granted" && again.reinstated).toBe(false);
    });
  });

  describe("OTP rate bucket (audit F8)", () => {
    test("security and other messages are counted separately per recipient", async () => {
      const env = {
        ...ENV,
        WHATSAPP_RATE_PER_RECIPIENT_PER_HOUR: "1",
        WHATSAPP_RATE_SECURITY_PER_RECIPIENT_PER_HOUR: "1"
      } as NodeJS.ProcessEnv;
      const otp = () =>
        enqueue(
          TENANT_A,
          {
            templateKey: "it963.otp",
            variables: { code: "1" },
            expiresAt: new Date(Date.now() + 60_000)
          },
          env
        );

      expect((await enqueue(TENANT_A, {}, env)).status).toBe("queued");
      // The notice used up the ordinary bucket; the OTP bucket is untouched.
      expect((await otp()).status).toBe("queued");
      expect(await otp()).toEqual({
        status: "refused",
        reason: "RATE_LIMITED"
      });
      expect(await enqueue(TENANT_A, {}, env)).toEqual({
        status: "refused",
        reason: "RATE_LIMITED"
      });
    });
  });

  describe("isolation and privileges", () => {
    test("RLS: one tenant cannot read another tenant's queue, consent or suppression", async () => {
      await enqueue(TENANT_A);
      await inTenant(TENANT_A, (tx) =>
        grantMarketingConsent(tx, TENANT_A, null, {
          phone: PHONE,
          source: "form"
        })
      );
      await inTenant(TENANT_A, (tx) =>
        createSuppression(tx, TENANT_A, null, {
          phone: OTHER_PHONE,
          reason: "manual"
        })
      );

      for (const table of ["messages", "consents", "suppressions"]) {
        const rows = await inTenant(TENANT_B, (tx) =>
          tx.unsafe(`SELECT id FROM awcms_whatsapp_${table}`)
        );

        expect(rows).toHaveLength(0);
      }
    });

    test("the same number in two tenants hashes differently and the same key can be used in both", async () => {
      const a = await enqueue(TENANT_A, { idempotencyKey: "shared" });
      const b = await enqueue(TENANT_B, { idempotencyKey: "shared" });

      expect(a.status).toBe("queued");
      expect(b.status).toBe("queued");
      const hashes =
        (await getAdminSql()`SELECT DISTINCT recipient_hash FROM awcms_whatsapp_messages`) as unknown[];

      expect(hashes).toHaveLength(2);
    });

    test("a security message without an expiry is not representable in the table", async () => {
      const error = await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_whatsapp_messages
            (tenant_id, idempotency_key, template_key, purpose, recipient,
             recipient_hash, recipient_masked, body)
          VALUES (${TENANT_A}, 'k', 'a.b', 'security', 'x', 'h', 'm', 'b')
        `,
        "a security row with no expiry"
      );

      expect(
        String((error as { errno?: unknown }).errno ?? error.message)
      ).toMatch(/23514|security_expiry/);
    });

    workerTest(
      "awcms_worker can dispatch and purge but can never delete a consent or a suppression",
      async () => {
        const worker = getWorkerRoleSql();

        await withTenantOrThrow(worker, TENANT_A, async (tx) => {
          await tx`SELECT 1 FROM awcms_whatsapp_consents LIMIT 1`;
        });
        for (const table of ["consents", "suppressions"]) {
          const error = await assertRejected(
            withTenantOrThrow(worker, TENANT_A, (tx) =>
              tx.unsafe(`DELETE FROM awcms_whatsapp_${table}`)
            ),
            `DELETE on ${table}`
          );

          expect(
            String((error as { errno?: unknown }).errno ?? error.message)
          ).toMatch(/42501|permission denied/);
          resetProviderCircuitBreakersForTests();
        }
      }
    );
  });

  describe("retention", () => {
    const guard = { isDescriptorHeld: async () => false };
    const heldGuard = { isDescriptorHeld: async () => true };

    async function age(id: string, status: string, days: number) {
      await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET status = ${status}, updated_at = now() - ${`${days} days`}::interval
        WHERE id = ${id}
      `;
    }

    workerTest(
      "the purge removes OLD TERMINAL rows and never a waiting message, however old",
      async () => {
        const ids: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          ids.push(
            (
              (await enqueue(TENANT_A, {
                recipient: { kind: "address", phone: `+62811000000${i}0` }
              })) as { messageId: string }
            ).messageId
          );
        }
        await age(ids[0]!, "sent", 90);
        await age(ids[1]!, "failed", 90);
        await age(ids[2]!, "queued", 400);
        await age(ids[3]!, "retry_wait", 400);
        await age(ids[4]!, "sent", 1);

        const result = await purgeWhatsappQueue(
          getWorkerRoleSql(),
          TENANT_A,
          guard
        );
        const left = (
          (await getAdminSql()`SELECT id FROM awcms_whatsapp_messages`) as {
            id: string;
          }[]
        )
          .map((r) => r.id)
          .sort();

        expect(result.purgedMessages).toBe(2);
        expect(left).toEqual([ids[2]!, ids[3]!, ids[4]!].sort());
      }
    );

    workerTest(
      "the purge EXPIRES stale non-terminal rows and clears the OTP, with the flag off (audit F5)",
      async () => {
        const otp = (await enqueue(TENANT_A, {
          templateKey: "it963.otp",
          variables: { code: "864209" },
          expiresAt: new Date(Date.now() + 60_000)
        })) as { messageId: string };
        const retrying = (await enqueue(TENANT_A, {
          templateKey: "it963.otp",
          variables: { code: "111222" },
          expiresAt: new Date(Date.now() + 60_000),
          recipient: { kind: "address", phone: OTHER_PHONE }
        })) as { messageId: string };
        const fresh = (await enqueue(TENANT_A, {
          templateKey: "it963.otp",
          variables: { code: "333444" },
          expiresAt: new Date(Date.now() + 60 * 60_000),
          recipient: { kind: "address", phone: "+6281111111111" }
        })) as { messageId: string };

        await getAdminSql()`
        UPDATE awcms_whatsapp_messages SET expires_at = now() - interval '1 minute'
        WHERE id = ${otp.messageId}
      `;
        await getAdminSql()`
        UPDATE awcms_whatsapp_messages
        SET expires_at = now() - interval '1 minute', status = 'retry_wait'
        WHERE id = ${retrying.messageId}
      `;

        // No dispatcher, no flag, no provider: only the purge job runs.
        const result = await purgeWhatsappQueue(
          getWorkerRoleSql(),
          TENANT_A,
          guard
        );

        expect(result).toMatchObject({ expiredMessages: 2, purgedMessages: 0 });
        for (const id of [otp.messageId, retrying.messageId]) {
          const row = await message(id);

          expect(row.status).toBe("expired");
          expect(row.body).toBe("");
          expect(row.variables).toEqual({});
        }
        // A message that has not expired is untouched, and still holds its code.
        expect((await message(fresh.messageId)).status).toBe("queued");
        expect(String((await message(fresh.messageId)).body)).toContain(
          "333444"
        );
        expect(await eventTypes(TENANT_A)).toContain(
          "awcms.whatsapp.message.expired"
        );
        expect(
          JSON.stringify(
            await getAdminSql()`SELECT payload FROM awcms_domain_events`
          )
        ).not.toContain("864209");
      }
    );

    workerTest(
      "a legal hold stops the purge, and attempts go before their message",
      async () => {
        const queued = (await enqueue(TENANT_A)) as { messageId: string };
        await dispatch(
          TENANT_A,
          fakeProvider(() => OK)
        );
        await getAdminSql()`UPDATE awcms_whatsapp_delivery_attempts SET created_at = now() - interval '90 days'`;
        await age(queued.messageId, "sent", 90);

        expect(
          await purgeWhatsappQueue(getWorkerRoleSql(), TENANT_A, heldGuard)
        ).toEqual({
          purgedAttempts: 0,
          purgedMessages: 0,
          expiredMessages: 0
        });
        expect(
          await purgeWhatsappQueue(getWorkerRoleSql(), TENANT_A, guard)
        ).toEqual({
          purgedAttempts: 1,
          purgedMessages: 1,
          expiredMessages: 0
        });
      }
    );
  });
});
