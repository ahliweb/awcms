/**
 * `email:dispatch` outbox against a real PostgreSQL with real migrations and
 * real RLS, driven by a FAKE Mailketing v2 provider (Issue #1159, ADR-0151).
 *
 * The outbox itself was touched (re-claim classification, 402 hold, 429
 * Retry-After), so the fake-`Bun.SQL` unit tests are not enough: what must be
 * proved is the persisted state — status, retry_count, next_attempt_at,
 * last_error, the attempt ledger — and that none of it contains a token or a
 * recipient.
 *
 * NOT proved here: any behaviour of the real Mailketing service. The provider
 * is a fixture built from the documented contract.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { resetProviderCircuitBreakersForTests } from "../../src/lib/database/circuit-breaker";
import { dispatchEmailQueue } from "../../src/modules/email/application/email-dispatch";
import type { EmailProvider } from "../../src/modules/email/domain/email-provider-contract";
import {
  createMailketingV2Provider,
  type MailketingV2TransportResult
} from "../../src/modules/email/infrastructure/mailketing-v2-provider";
import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const TOKEN = "CANARY-token-0123456789abcdef";
const NOW = new Date("2026-11-02T10:00:00.000Z");
const ENV = {
  EMAIL_ENABLED: "true",
  EMAIL_PROVIDER: "mailketing",
  EMAIL_FROM_ADDRESS: "noreply@example.com",
  EMAIL_FROM_NAME: "AWCMS"
} as unknown as NodeJS.ProcessEnv;

type MessageRow = {
  status: string;
  retry_count: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  provider_message_id: string | null;
  sent_at: Date | null;
};

function provider(script: MailketingV2TransportResult, calls?: string[]) {
  return () =>
    createMailketingV2Provider({
      apiToken: TOKEN,
      now: () => NOW,
      transport: async (request) => {
        calls?.push(request.url);
        return script;
      }
    });
}

const ok = (messageId = "mk_it_1"): MailketingV2TransportResult => ({
  ok: true,
  status: 200,
  retryAfter: null,
  body: JSON.stringify({ success: true, data: { message_id: messageId } })
});
const http = (
  status: number,
  retryAfter: string | null = null
): MailketingV2TransportResult => ({
  ok: true,
  status,
  retryAfter,
  body: `{"success":false,"detail":"${TOKEN} user-${status}@example.com"}`
});

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedTemplate(tenantId: string): Promise<void> {
  const actor = crypto.randomUUID();

  await getAdminSql()`
    INSERT INTO awcms_email_templates
      (tenant_id, template_key, name, subject_template, text_body_template,
       created_by, updated_by)
    VALUES (
      ${tenantId}, 'system.announcement', 'Announcement',
      ${{ en: "Hello" }}::jsonb, ${{ en: "Body {{userName}}" }}::jsonb,
      ${actor}, ${actor}
    )
  `;
}

async function seedMessage(
  tenantId: string,
  overrides: {
    status?: string;
    nextAttemptAt?: Date | null;
    address?: string;
  } = {}
): Promise<string> {
  const id = crypto.randomUUID();
  const address = overrides.address ?? "person@example.com";

  await getAdminSql()`
    INSERT INTO awcms_email_messages
      (id, tenant_id, category, template_key, status, to_address,
       to_address_hash, to_address_masked, subject, variables, next_attempt_at)
    VALUES (
      ${id}, ${tenantId}, 'system.announcement', 'system.announcement',
      ${overrides.status ?? "queued"}, ${address}, ${`hash-${id}`}, 'p***@example.com',
      'Hello', ${{ userName: "Person" }}::jsonb, ${overrides.nextAttemptAt ?? null}
    )
  `;

  return id;
}

async function rowOf(id: string): Promise<MessageRow> {
  const rows = (await getAdminSql()`
    SELECT status, retry_count, next_attempt_at, last_error, provider_message_id, sent_at
    FROM awcms_email_messages WHERE id = ${id}
  `) as MessageRow[];

  return rows[0]!;
}

async function attemptsOf(
  id: string
): Promise<{ attempt_no: number; outcome: string }[]> {
  return (await getAdminSql()`
    SELECT attempt_no, outcome FROM awcms_email_delivery_attempts
    WHERE message_id = ${id} ORDER BY attempt_no
  `) as { attempt_no: number; outcome: string }[];
}

function run(tenantId: string, makeProvider: () => EmailProvider) {
  return dispatchEmailQueue(getRuntimeSql(), tenantId, {
    now: NOW,
    env: ENV,
    resolveProvider: makeProvider
  });
}

suite("email dispatch + Mailketing v2 fake (Issue #1159)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    resetProviderCircuitBreakersForTests();
    await seedTenant(TENANT_A, "tenant-a");
    await seedTenant(TENANT_B, "tenant-b");
    await seedTemplate(TENANT_A);
    await seedTemplate(TENANT_B);
  }, 30000);

  test("200 success:true: stored as sent (accepted, not delivered) with the provider message id and one success attempt", async () => {
    const id = await seedMessage(TENANT_A);
    const result = await run(TENANT_A, provider(ok("mk_it_1")));

    expect(result).toMatchObject({ claimed: 1, sent: 1, uncertain: 0 });

    const row = await rowOf(id);
    expect(row.status).toBe("sent");
    expect(row.provider_message_id).toBe("mk_it_1");
    expect(row.last_error).toBeNull();
    expect(await attemptsOf(id)).toEqual([
      { attempt_no: 1, outcome: "success" }
    ]);
  });

  test("crash after acceptance: an expired 'sending' lease is re-claimed, sent once more, and classified UNCERTAIN (not silent)", async () => {
    const id = await seedMessage(TENANT_A, {
      status: "sending",
      nextAttemptAt: new Date(NOW.getTime() - 60_000)
    });
    const calls: string[] = [];
    const result = await run(TENANT_A, provider(ok("mk_it_2"), calls));

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ claimed: 1, sent: 1, uncertain: 1 });

    const row = await rowOf(id);
    expect(row.status).toBe("sent");
    expect(row.last_error).toContain("Uncertain delivery");
    // The ledger is idempotent per (message, attempt_no): still one row.
    expect(await attemptsOf(id)).toHaveLength(1);
  });

  test("a live (unexpired) lease is NOT re-claimed — no second send while another worker holds it", async () => {
    const id = await seedMessage(TENANT_A, {
      status: "sending",
      nextAttemptAt: new Date(NOW.getTime() + 60_000)
    });
    const calls: string[] = [];
    const result = await run(TENANT_A, provider(ok(), calls));

    expect(result.claimed).toBe(0);
    expect(calls).toHaveLength(0);
    expect((await rowOf(id)).status).toBe("sending");
  });

  test("402: held in 'queued' with a future next_attempt_at, retry_count untouched, no attempt row", async () => {
    const id = await seedMessage(TENANT_A);
    const result = await run(TENANT_A, provider(http(402)));

    expect(result.deferred).toBe(1);

    const row = await rowOf(id);
    expect(row.status).toBe("queued");
    expect(row.retry_count).toBe(0);
    expect(row.next_attempt_at!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(await attemptsOf(id)).toEqual([]);

    // Not due again on the very next pass: the credit hold is respected.
    const calls: string[] = [];
    const second = await run(TENANT_A, provider(ok(), calls));
    expect(second.claimed).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test("429 Retry-After: retry_wait no sooner than the provider asked, one retry spent", async () => {
    const id = await seedMessage(TENANT_A);
    const result = await run(TENANT_A, provider(http(429, "600")));

    expect(result.retried).toBe(1);

    const row = await rowOf(id);
    expect(row.status).toBe("retry_wait");
    expect(row.retry_count).toBe(1);
    expect(row.next_attempt_at!.getTime()).toBe(NOW.getTime() + 600_000);
    expect(await attemptsOf(id)).toEqual([
      { attempt_no: 1, outcome: "failure" }
    ]);
  });

  test("500 retries with backoff; 422 and 403 go terminal; 401 goes terminal", async () => {
    const retry = await seedMessage(TENANT_A, { address: "a1@example.com" });
    await run(TENANT_A, provider(http(500)));
    expect((await rowOf(retry)).status).toBe("retry_wait");

    for (const status of [422, 403, 401]) {
      resetProviderCircuitBreakersForTests();
      const id = await seedMessage(TENANT_A, {
        address: `a${status}@example.com`
      });
      await run(TENANT_A, provider(http(status)));
      const row = await rowOf(id);
      expect(row.status).toBe("failed");
      expect(row.retry_count).toBe(1);
    }
  });

  test("nothing persisted — message row, attempt ledger — contains the token or the recipient", async () => {
    const ids: string[] = [];

    for (const status of [401, 402, 403, 422, 429, 500]) {
      resetProviderCircuitBreakersForTests();
      ids.push(
        await seedMessage(TENANT_A, { address: `user-${status}@example.com` })
      );
      await run(TENANT_A, provider(http(status)));
    }

    const messages = JSON.stringify(
      await getAdminSql()`SELECT last_error, provider_message_id FROM awcms_email_messages`
    );
    const ledger = JSON.stringify(
      await getAdminSql()`SELECT error_message, provider_response_snippet FROM awcms_email_delivery_attempts`
    );

    for (const blob of [messages, ledger]) {
      expect(blob).not.toContain(TOKEN);
      expect(blob).not.toMatch(/user-\d{3}@example\.com/);
    }
  });

  test("tenant isolation holds: dispatching tenant A never touches tenant B's queue", async () => {
    await seedMessage(TENANT_A);
    const other = await seedMessage(TENANT_B);

    await run(TENANT_A, provider(ok()));

    expect((await rowOf(other)).status).toBe("queued");
  });

  test("EMAIL_ENABLED off: nothing is claimed and the provider is never called", async () => {
    const id = await seedMessage(TENANT_A);
    const calls: string[] = [];
    const result = await dispatchEmailQueue(getRuntimeSql(), TENANT_A, {
      now: NOW,
      env: { ...ENV, EMAIL_ENABLED: "false" } as unknown as NodeJS.ProcessEnv,
      resolveProvider: provider(ok(), calls)
    });

    expect(result.claimed).toBe(0);
    expect(calls).toHaveLength(0);
    expect((await rowOf(id)).status).toBe("queued");
  });

  test("L4: the database is reachable — a set-but-unreachable DATABASE_URL fails here, loudly, instead of skipping", async () => {
    const rows = (await getAdminSql()`SELECT 1 AS one`) as { one: number }[];
    expect(rows[0]!.one).toBe(1);
  });

  test("L4: the real claim SQL marks ONLY the expired-lease row as reclaimed in a mixed batch (fresh claim vs reclaim)", async () => {
    const fresh = await seedMessage(TENANT_A, { address: "fresh@example.com" });
    const stale = await seedMessage(TENANT_A, {
      address: "stale@example.com",
      status: "sending",
      nextAttemptAt: new Date(NOW.getTime() - 60_000)
    });
    const result = await run(TENANT_A, provider(ok("mk_mixed")));

    expect(result).toMatchObject({ claimed: 2, sent: 2, uncertain: 1 });
    expect((await rowOf(fresh)).last_error).toBeNull();
    expect((await rowOf(stale)).last_error).toContain("Uncertain delivery");
  });

  test("M1: a misconfigured run keeps every queued message (none failed, no attempts) and they send once the config is fixed", async () => {
    const { resolveEmailProvider } =
      await import("../../src/modules/email/infrastructure/email-provider-resolver");
    const ids = [
      await seedMessage(TENANT_A, { address: "a@example.com" }),
      await seedMessage(TENANT_A, { address: "b@example.com" })
    ];

    const broken = await run(TENANT_A, () =>
      resolveEmailProvider({
        EMAIL_PROVIDER: "mailketing",
        EMAIL_MAILKETING_API_VERSION: "V2",
        EMAIL_MAILKETING_API_TOKEN: TOKEN
      } as unknown as NodeJS.ProcessEnv)
    );

    expect(broken).toMatchObject({
      claimed: 2,
      deferred: 2,
      misconfigured: 2,
      failed: 0
    });

    for (const id of ids) {
      const row = await rowOf(id);
      expect(row.status).toBe("queued");
      expect(row.retry_count).toBe(0);
      expect(row.next_attempt_at!.getTime()).toBeGreaterThan(NOW.getTime());
      expect(await attemptsOf(id)).toEqual([]);
    }

    // Config fixed, hold elapsed: the very same rows are sent.
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const fixed = await dispatchEmailQueue(getRuntimeSql(), TENANT_A, {
      now: later,
      env: ENV,
      resolveProvider: provider(ok("mk_fixed"))
    });

    expect(fixed).toMatchObject({ claimed: 2, sent: 2 });
    for (const id of ids) {
      expect((await rowOf(id)).status).toBe("sent");
    }
  });

  test("M2a: a malformed 200 is terminal and sent exactly once (no duplicate copies), counted uncertain", async () => {
    const calls: string[] = [];
    const id = await seedMessage(TENANT_A);
    const result = await run(
      TENANT_A,
      provider(
        {
          ok: true,
          status: 200,
          retryAfter: null,
          body: "<html>gateway</html>"
        },
        calls
      )
    );

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ failed: 1, retried: 0, uncertain: 1 });

    const row = await rowOf(id);
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("UNCERTAIN_MALFORMED_RESPONSE");

    const again = await run(TENANT_A, provider(ok(), calls));
    expect(again.claimed).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test("L1: a message held for credit past the budget fails with a named reason; a young one stays held", async () => {
    const young = await seedMessage(TENANT_A, { address: "young@example.com" });
    const old = await seedMessage(TENANT_A, { address: "old@example.com" });
    await getAdminSql()`
      UPDATE awcms_email_messages SET created_at = ${new Date(NOW.getTime() - 2 * 3_600_000)}
      WHERE id = ${old}
    `;
    await getAdminSql()`
      UPDATE awcms_email_messages SET created_at = ${new Date(NOW.getTime() - 60_000)}
      WHERE id = ${young}
    `;

    const result = await run(TENANT_A, provider(http(402)));

    expect(result).toMatchObject({ deferred: 1, failed: 1 });
    expect((await rowOf(young)).status).toBe("queued");

    const failed = await rowOf(old);
    expect(failed.status).toBe("failed");
    expect(failed.last_error).toContain("CREDIT_HOLD_BUDGET_EXCEEDED");
    expect(failed.last_error).not.toContain("example.com");
  });

  test("L2: a reclaimed row that is deferred carries the note and is not counted uncertain", async () => {
    const id = await seedMessage(TENANT_A, {
      status: "sending",
      nextAttemptAt: new Date(NOW.getTime() - 60_000)
    });
    const result = await run(TENANT_A, provider(http(402)));

    expect(result).toMatchObject({ deferred: 1, uncertain: 0 });
    const row = await rowOf(id);
    expect(row.status).toBe("queued");
    expect(row.last_error).toContain("uncertain");
  });
});
