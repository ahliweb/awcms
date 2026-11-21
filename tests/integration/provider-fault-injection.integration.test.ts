/**
 * Provider-failure fault injection (Issue #1411) for the outbox/worker adapters
 * that ALREADY exist: sync-storage object queue (R2), email (Mailketing v2),
 * WhatsApp (StarSender) and push (Web Push). Fake providers, a real disposable
 * PostgreSQL with real migrations/RLS, no external secret.
 *
 * WHAT THIS FILE ADDS. Per-owner suites already prove the happy path and the
 * common failures (`email-dispatch-mailketing-v2`, `whatsapp-delivery`,
 * `push-operator-matrix`, `object-storage-uploader`). This file fills the gaps
 * the issue lists and, above all, keeps ONE table of failure mode -> persisted
 * state -> provider call count (see the PR body / docs). Cases that are already
 * proved elsewhere are NOT duplicated; the table names their file.
 *
 * WHAT IT DOES NOT CLAIM.
 *   - No test asserts exactly-once external delivery. Where the provider gives no
 *     idempotency guarantee, the assertion is "the outcome is unknown and the row
 *     says so", or "at-least-once; a duplicate is possible and bounded".
 *   - The providers are fixtures built from the documented contract, not the
 *     real services.
 *   - Half-open single-flight is PER PROCESS (circuit-breaker.ts). Nothing here
 *     says anything about N replicas.
 *
 * KNOWN DEFECTS PROVED HERE are `test.todo` (bun skips the body; run with
 * `--todo` to see them fail). They are findings for separate atomic follow-ups,
 * not fixed in this PR (Issue #1411: "test first, fix only proven failures").
 *
 * Gated on `DATABASE_URL` (harness section Gating). Clock: breaker and retry
 * assertions use injected/pinned clocks; the only real waits are two
 * sub-second provider timeouts.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
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
import { dispatchEmailQueue } from "../../src/modules/email/application/email-dispatch";
import {
  createMailketingV2Provider,
  type MailketingV2TransportResult
} from "../../src/modules/email/infrastructure/mailketing-v2-provider";
import { dispatchObjectSyncQueue } from "../../src/modules/sync-storage/application/object-dispatch";
import {
  createR2ObjectUploader,
  resolveObjectUploader
} from "../../src/modules/sync-storage/infrastructure/object-storage-uploader";
import { dispatchWhatsappQueue } from "../../src/modules/whatsapp-delivery/application/whatsapp-dispatch";
import { enqueueWhatsappMessage } from "../../src/modules/whatsapp-delivery/application/whatsapp-enqueue";
import { WHATSAPP_CIRCUIT_BREAKER_KEY } from "../../src/modules/whatsapp-delivery/domain/whatsapp-config";
import { registerWhatsappTemplate } from "../../src/modules/whatsapp-delivery/domain/whatsapp-templates";
import { createStarsenderWhatsappProvider } from "../../src/modules/whatsapp-delivery/infrastructure/starsender-provider";
import type {
  WhatsappHttpClient,
  WhatsappHttpResult
} from "../../src/modules/whatsapp-delivery/infrastructure/whatsapp-http-client";
import { dispatchPushQueue } from "../../src/modules/push-delivery/application/push-dispatch";
import { enqueuePushToRecipients } from "../../src/modules/push-delivery/application/push-enqueue";
import { registerPushSubscription } from "../../src/modules/push-delivery/application/subscription-directory";
import { resolvePushAuthSecretRing } from "../../src/modules/push-delivery/domain/push-auth-secret";
import { PUSH_CIRCUIT_BREAKER_KEY } from "../../src/modules/push-delivery/domain/push-config";
import type {
  PushHttpClient,
  PushHttpRequest
} from "../../src/modules/push-delivery/infrastructure/push-http-client";
import { clearVapidTokenCache } from "../../src/modules/push-delivery/infrastructure/vapid-jwt";
import { createWebPushProvider } from "../../src/modules/push-delivery/infrastructure/web-push-provider";

const suite = integrationEnabled ? describe : describe.skip;

// Fresh tenants/users per test instead of a TRUNCATE of every table per test:
// the queues are per-tenant and the process-wide breakers are reset in each
// `beforeEach`, so tests stay isolated while the suite stays inside the CI
// time budget (a full reset costs ~2s per test).
let T_A = "";
let T_B = "";
let USER_A = "";
let USER_B = "";

function freshIds(): void {
  T_A = crypto.randomUUID();
  T_B = crypto.randomUUID();
  USER_A = crypto.randomUUID();
  USER_B = crypto.randomUUID();
}
const NOW = new Date("2026-11-22T10:00:00.000Z");
const PAST = () => new Date(Date.now() - 120_000);

/** Wait (microtask/timer turns, no wall-clock budget) until `predicate` holds. */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 2000; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`condition never held: ${label}`);
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { promise, open };
}

/** Opens the breaker "two minutes ago": by the wall clock it is now half-open (30s window). */
function tripToHalfOpen(key: string): void {
  const breaker = getProviderCircuitBreaker(key);

  for (let i = 0; i < 5; i += 1) breaker.recordFailure(PAST());
}

async function seedTenant(
  tenantId: string,
  code: string,
  userId?: string
): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${tenantId}, ${`${code}-${tenantId.slice(0, 8)}`}, ${code}, ${code}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;

  if (!userId) return;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${code}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${code}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
  `;
}

const workerSql = () =>
  workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql();

suite("provider fault injection (#1411)", () => {
  // ONE ephemeral database for all four owners: setup applies every migration,
  // and paying it four times is what would blow the CI-time budget.
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await resetDatabase();
  }, 120000);
  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  // ===========================================================================
  // 1. Sync-storage object queue -> R2 (real Bun.S3Client against a loopback fake)
  // ===========================================================================

  type S3Mode =
    "ok" | "rate_limited" | "unavailable" | "store_then_hang" | "hang";

  describe("R2 object queue under provider faults (#1411)", () => {
    let tmp: string;
    let server: ReturnType<typeof Bun.serve>;
    let mode: S3Mode = "ok";
    let held = gate();
    let puts: string[] = [];
    const stored = new Map<string, number>();
    let nodeA: string;
    let nodeB: string;
    let seq = 0;

    const uploader = (timeoutMs = 5000) =>
      createR2ObjectUploader({
        accountId: "acct",
        accessKeyId: "AKIAFAKEFAKEFAKE",
        secretAccessKey: "fake-secret-fake-secret",
        bucket: "bkt",
        endpoint: `http://127.0.0.1:${server.port}`,
        timeoutMs
      });

    async function seedObject(
      tenantId: string,
      node: string,
      over: {
        requiresUpload?: boolean;
        status?: string;
        retryCount?: number;
        nextRetryAt?: Date | null;
        missingFile?: boolean;
      } = {}
    ): Promise<string> {
      seq += 1;
      const file = `obj-${seq}.bin`;
      const content = `payload-${seq}`;
      const hasher = new Bun.CryptoHasher("sha256");

      hasher.update(content);
      if (!over.missingFile) await writeFile(path.join(tmp, file), content);

      const rows = (await getAdminSql()`
      INSERT INTO awcms_object_sync_queue
        (tenant_id, node_id, object_key, local_path, checksum_sha256, byte_size,
         requires_upload, status, retry_count, next_retry_at)
      VALUES (${tenantId}, ${node}, ${`k/${seq}`}, ${file}, ${hasher.digest("hex")},
              ${content.length}, ${over.requiresUpload ?? true},
              ${over.status ?? "pending"}, ${over.retryCount ?? 0},
              ${over.nextRetryAt ?? null})
      RETURNING id
    `) as { id: string }[];

      return rows[0]!.id;
    }

    async function row(id: string) {
      return (
        (await getAdminSql()`
      SELECT status, retry_count, next_retry_at, last_error, uploaded_at
      FROM awcms_object_sync_queue WHERE id = ${id}
    `) as {
          status: string;
          retry_count: number;
          next_retry_at: Date | null;
          last_error: string | null;
          uploaded_at: Date | null;
        }[]
      )[0]!;
    }

    const run = (
      tenantId: string,
      resolveUploader: Parameters<
        typeof dispatchObjectSyncQueue
      >[2] extends infer O
        ? O extends { resolveUploader?: infer R }
          ? R
          : never
        : never,
      now: Date = NOW
    ) =>
      dispatchObjectSyncQueue(workerSql(), tenantId, { now, resolveUploader });

    beforeEach(async () => {
      freshIds();
      resetProviderCircuitBreakersForTests();
      tmp = await mkdtemp(path.join(tmpdir(), "awcms-fi-r2-"));
      process.env.OBJECT_SYNC_LOCAL_ROOT_PATH = tmp;
      mode = "ok";
      held = gate();
      puts = [];
      stored.clear();
      server = Bun.serve({
        port: 0,
        async fetch(request) {
          const key = new URL(request.url).pathname;

          puts.push(key);
          if (mode === "rate_limited") {
            return new Response("SlowDown", {
              status: 429,
              headers: { "Retry-After": "3600" }
            });
          }
          if (mode === "unavailable") {
            return new Response("down", { status: 503 });
          }
          const bytes = await request.arrayBuffer();

          if (mode === "hang") await held.promise;
          stored.set(key, bytes.byteLength);
          if (mode === "store_then_hang") await held.promise;

          return new Response("", { status: 200 });
        }
      });
      await seedTenant(T_A, "fi-r2-a");
      await seedTenant(T_B, "fi-r2-b");
      const nodes = (await getAdminSql()`
      INSERT INTO awcms_sync_nodes (tenant_id, node_code, node_name)
      VALUES (${T_A}, 'n-a', 'n-a'), (${T_B}, 'n-b', 'n-b')
      RETURNING id, tenant_id
    `) as { id: string; tenant_id: string }[];

      nodeA = nodes.find((n) => n.tenant_id === T_A)!.id;
      nodeB = nodes.find((n) => n.tenant_id === T_B)!.id;
    }, 30000);

    afterEach(async () => {
      held.open();
      server.stop(true);
      await rm(tmp, { recursive: true, force: true });
      delete process.env.OBJECT_SYNC_LOCAL_ROOT_PATH;
      resetProviderCircuitBreakersForTests();
    });

    test("503 and 429: the row returns to pending with a bounded exponential backoff, one retry spent, last_error set; Retry-After is NOT consulted (fixed backoff)", async () => {
      for (const next of ["unavailable", "rate_limited"] as const) {
        resetProviderCircuitBreakersForTests();
        mode = next;
        const id = await seedObject(T_A, nodeA);

        expect(await run(T_A, () => uploader())).toMatchObject({
          claimed: 1,
          sent: 0,
          retried: 1,
          failed: 0
        });

        const r = await row(id);

        expect(r.status).toBe("pending");
        expect(Number(r.retry_count)).toBe(1);
        // First backoff is 2^0 = 1 minute, NOT the 3600s the provider asked for.
        expect(r.next_retry_at!.getTime()).toBe(NOW.getTime() + 60_000);
        expect(r.last_error).toBeTruthy();
        expect(puts.length).toBeGreaterThanOrEqual(1);

        // Not due: a second pass at the same instant claims nothing and calls nothing.
        const before = puts.length;

        expect(await run(T_A, () => uploader())).toMatchObject({ claimed: 0 });
        expect(puts.length).toBe(before);
      }
    });

    test("lost ACK (provider stored the object, we timed out): row stays pending (outcome unknown to us); the retry re-PUTs the same key — idempotent overwrite, ONE object, NOT an exactly-once claim", async () => {
      mode = "store_then_hang";
      const id = await seedObject(T_A, nodeA);

      expect(await run(T_A, () => uploader(150))).toMatchObject({
        retried: 1,
        sent: 0
      });
      expect((await row(id)).status).toBe("pending");
      expect(stored.size).toBe(1);

      held.open();
      mode = "ok";
      resetProviderCircuitBreakersForTests();
      const later = new Date(NOW.getTime() + 61_000);

      expect(await run(T_A, () => uploader(), later)).toMatchObject({
        sent: 1
      });
      expect((await row(id)).status).toBe("sent");
      // Same destination key written twice; the store holds one object.
      expect(stored.size).toBe(1);
      expect(new Set(puts).size).toBe(1);
      expect(puts.length).toBeGreaterThanOrEqual(2);
    });

    test("failure BEFORE send (unreachable endpoint): provider is never reached, row is retried", async () => {
      const dead = createR2ObjectUploader({
        accountId: "acct",
        accessKeyId: "AKIAFAKEFAKEFAKE",
        secretAccessKey: "fake-secret-fake-secret",
        bucket: "bkt",
        endpoint: "http://127.0.0.1:1",
        timeoutMs: 2000
      });
      const id = await seedObject(T_A, nodeA);

      expect(await run(T_A, () => dead)).toMatchObject({ retried: 1 });
      expect((await row(id)).status).toBe("pending");
      expect(puts).toHaveLength(0);
    });

    test("crash between CLAIM and FINALIZE: an expired 'sending' lease is re-claimed and uploaded; a live lease is not touched", async () => {
      const stale = await seedObject(T_A, nodeA, {
        status: "sending",
        nextRetryAt: new Date(NOW.getTime() - 60_000)
      });
      const live = await seedObject(T_A, nodeA, {
        status: "sending",
        nextRetryAt: new Date(NOW.getTime() + 60_000)
      });

      expect(await run(T_A, () => uploader())).toMatchObject({
        claimed: 1,
        sent: 1
      });
      expect((await row(stale)).status).toBe("sent");
      expect((await row(live)).status).toBe("sending");
      expect(puts).toHaveLength(1);
    });

    test("dead letter: the last allowed retry ends in terminal 'failed' and the row is never claimed again", async () => {
      mode = "unavailable";
      const id = await seedObject(T_A, nodeA, { retryCount: 5 });

      expect(await run(T_A, () => uploader())).toMatchObject({
        claimed: 1,
        failed: 1,
        retried: 0
      });
      expect((await row(id)).status).toBe("failed");

      const before = puts.length;

      expect(
        await run(T_A, () => uploader(), new Date(NOW.getTime() + 86_400_000))
      ).toMatchObject({ claimed: 0 });
      expect(puts.length).toBe(before);
    });

    test("provider down (breaker open): R2 rows are NOT claimed and spend no retry, local-only rows still complete (an outage never blocks unrelated work)", async () => {
      const r2 = await seedObject(T_A, nodeA);
      const local = await seedObject(T_A, nodeA, { requiresUpload: false });

      for (let i = 0; i < 5; i += 1) {
        getProviderCircuitBreaker("object-storage").recordFailure(new Date());
      }

      const result = await dispatchObjectSyncQueue(workerSql(), T_A, {
        now: new Date(),
        resolveUploader: (requiresUpload) =>
          requiresUpload ? uploader() : resolveObjectUploader(false)
      });

      expect(result).toMatchObject({
        claimed: 1,
        sent: 1,
        uploadBreakerOpen: true
      });
      expect((await row(local)).status).toBe("sent");
      expect(await row(r2)).toMatchObject({
        status: "pending",
        retry_count: 0
      });
      expect(puts).toHaveLength(0);
    });

    test("provider misconfigured (no credentials): the R2 row fails softly into retry, the pass does not throw, local-only rows are unaffected", async () => {
      for (const k of [
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET"
      ]) {
        delete process.env[k];
      }
      const r2 = await seedObject(T_A, nodeA);
      const local = await seedObject(T_A, nodeA, { requiresUpload: false });

      const result = await dispatchObjectSyncQueue(workerSql(), T_A, {
        now: NOW,
        resolveUploader: resolveObjectUploader
      });

      expect(result).toMatchObject({ claimed: 2, sent: 1, retried: 1 });
      expect((await row(local)).status).toBe("sent");
      expect((await row(r2)).last_error).toContain("R2 credentials");
    });

    test("two tenants + least privilege: the worker role dispatches tenant A only; tenant B's rows are neither claimed nor changed", async () => {
      const a = await seedObject(T_A, nodeA);
      const b = await seedObject(T_B, nodeB);

      expect(await run(T_A, () => uploader())).toMatchObject({ sent: 1 });
      expect((await row(a)).status).toBe("sent");
      expect(await row(b)).toMatchObject({ status: "pending", retry_count: 0 });
      expect(puts).toHaveLength(1);
      // Key is tenant-namespaced at PUT time.
      expect(puts[0]).toContain(T_A);
    });

    test("half-open, concurrent passes (two tenants, one real adapter): exactly ONE PUT reaches the provider while the probe is in flight", async () => {
      tripToHalfOpen("object-storage");
      mode = "hang";
      const a = await seedObject(T_A, nodeA);
      const b = await seedObject(T_B, nodeB);

      const passA = run(T_A, () => uploader());

      await until(() => puts.length === 1, "probe PUT in flight");

      // Tenant B's pass starts while the probe is held. It must not reach R2.
      const resultB = await run(T_B, () => uploader());

      expect(puts).toHaveLength(1);
      expect(resultB.sent).toBe(0);
      expect((await row(b)).status).not.toBe("sent");

      held.open();
      expect(await passA).toMatchObject({ sent: 1 });
      expect((await row(a)).status).toBe("sent");
    });

    test.todo(
      "FINDING F1 (object-storage): a refused half-open/open attempt (breaker skipped) spends a retry like a real failure (no `skipped` outcome in ObjectUploader, unlike email/WhatsApp/push after #1409) — held rows must keep retry_count 0",
      async () => {
        tripToHalfOpen("object-storage");
        mode = "unavailable";
        const ids = [
          await seedObject(T_A, nodeA),
          await seedObject(T_A, nodeA),
          await seedObject(T_A, nodeA)
        ];

        await run(T_A, () => uploader());

        // Row 1 probed (and failed, reopening the breaker). Rows 2-3 never
        // reached the provider, so no retry may be charged to them.
        expect(Number((await row(ids[1]!)).retry_count)).toBe(0);
        expect(Number((await row(ids[2]!)).retry_count)).toBe(0);
      }
    );

    test.todo(
      "FINDING F2 (object-storage): a LOCAL problem (missing file) records a failure on the shared provider breaker — five bad local rows open the breaker for every tenant although the provider is healthy",
      async () => {
        for (let i = 0; i < 6; i += 1) {
          await seedObject(T_A, nodeA, { missingFile: true });
        }

        await run(T_A, () => uploader());

        expect(
          getProviderCircuitBreaker("object-storage").getState(new Date())
        ).toBe("closed");
      }
    );
  });

  // ===========================================================================
  // 2. Email (Mailketing v2 adapter, scripted transport, injected clock)
  // ===========================================================================

  describe("email provider faults (#1411)", () => {
    const TOKEN = "CANARY-token-0123456789abcdef";
    const ENV = {
      EMAIL_ENABLED: "true",
      EMAIL_PROVIDER: "mailketing",
      EMAIL_FROM_ADDRESS: "noreply@example.com",
      EMAIL_FROM_NAME: "AWCMS"
    } as unknown as NodeJS.ProcessEnv;
    const okBody = JSON.stringify({
      success: true,
      data: { message_id: "m1" }
    });
    const OK: MailketingV2TransportResult = {
      ok: true,
      status: 200,
      retryAfter: null,
      body: okBody
    };

    function adapter(
      script: (
        call: number
      ) => MailketingV2TransportResult | Promise<MailketingV2TransportResult>,
      calls: string[]
    ) {
      return () =>
        createMailketingV2Provider({
          apiToken: TOKEN,
          now: () => NOW,
          transport: async (request) => {
            calls.push(request.url);

            return script(calls.length);
          }
        });
    }

    async function seedTemplate(tenantId: string) {
      const actor = crypto.randomUUID();

      await getAdminSql()`
      INSERT INTO awcms_email_templates
        (tenant_id, template_key, name, subject_template, text_body_template, created_by, updated_by)
      VALUES (${tenantId}, 'system.announcement', 'Announcement',
              ${{ en: "Hello" }}::jsonb, ${{ en: "Body" }}::jsonb, ${actor}, ${actor})
    `;
    }

    async function seedMessage(tenantId: string, address: string) {
      const id = crypto.randomUUID();

      await getAdminSql()`
      INSERT INTO awcms_email_messages
        (id, tenant_id, category, template_key, status, to_address, to_address_hash,
         to_address_masked, subject, variables)
      VALUES (${id}, ${tenantId}, 'system.announcement', 'system.announcement', 'queued',
              ${address}, ${`hash-${id}`}, 'p***@example.com', 'Hello', ${{}}::jsonb)
    `;

      return id;
    }

    async function row(id: string) {
      return (
        (await getAdminSql()`
      SELECT status, retry_count, next_attempt_at, last_error FROM awcms_email_messages WHERE id = ${id}
    `) as {
          status: string;
          retry_count: number;
          next_attempt_at: Date | null;
          last_error: string | null;
        }[]
      )[0]!;
    }

    async function attempts(id: string) {
      return (await getAdminSql()`
      SELECT outcome FROM awcms_email_delivery_attempts WHERE message_id = ${id}
    `) as { outcome: string }[];
    }

    const run = (
      tenantId: string,
      make: () => ReturnType<typeof createMailketingV2Provider>
    ) =>
      dispatchEmailQueue(getRuntimeSql(), tenantId, {
        now: NOW,
        env: ENV,
        resolveProvider: make
      });

    beforeEach(async () => {
      freshIds();
      resetProviderCircuitBreakersForTests();
      await seedTenant(T_A, "fi-em-a");
      await seedTenant(T_B, "fi-em-b");
      await seedTemplate(T_A);
      await seedTemplate(T_B);
    }, 30000);
    afterEach(() => resetProviderCircuitBreakersForTests());

    test("timeout / network error (provider may or may not have accepted): retry_wait, retry spent, then a SECOND send happens — email is at-least-once, a duplicate is possible and bounded by max retries (ADR-0151 table: timeout is retryable)", async () => {
      const calls: string[] = [];
      const id = await seedMessage(T_A, "a@example.com");
      const timeout = adapter(() => ({ ok: false, reason: "timeout" }), calls);

      expect(await run(T_A, timeout)).toMatchObject({ retried: 1, sent: 0 });
      expect(await row(id)).toMatchObject({
        status: "retry_wait",
        retry_count: 1
      });
      expect(calls).toHaveLength(1);
      expect(await attempts(id)).toEqual([{ outcome: "failure" }]);

      // Recovered, backoff elapsed: sent again. NOT exactly-once.
      resetProviderCircuitBreakersForTests();
      const later = await dispatchEmailQueue(getRuntimeSql(), T_A, {
        now: new Date(NOW.getTime() + 10 * 60_000),
        env: ENV,
        resolveProvider: adapter(() => OK, calls)
      });

      expect(later).toMatchObject({ sent: 1 });
      expect(calls).toHaveLength(2);
    });

    test("dead letter: retries exhausted ends in terminal failed and is never re-sent", async () => {
      const calls: string[] = [];
      const id = await seedMessage(T_A, "dl@example.com");
      let now = NOW;

      for (let i = 0; i < 12; i += 1) {
        resetProviderCircuitBreakersForTests();
        await dispatchEmailQueue(getRuntimeSql(), T_A, {
          now,
          env: ENV,
          resolveProvider: adapter(
            () => ({ ok: true, status: 503, retryAfter: null, body: "" }),
            calls
          )
        });
        now = new Date(now.getTime() + 24 * 3_600_000);
      }

      const r = await row(id);

      expect(r.status).toBe("failed");

      const sent = calls.length;

      await dispatchEmailQueue(getRuntimeSql(), T_A, {
        now,
        env: ENV,
        resolveProvider: adapter(() => OK, calls)
      });
      expect(calls.length).toBe(sent);
    });

    test("half-open, concurrent passes (two tenants, one real adapter): ONE transport call; the refused message is parked with no attempt and no retry spent", async () => {
      const calls: string[] = [];
      const held = gate();
      const a = await seedMessage(T_A, "ha@example.com");
      const b = await seedMessage(T_B, "hb@example.com");
      const make = adapter(async () => {
        await held.promise;

        return OK;
      }, calls);

      // The adapter's clock is pinned at NOW: open the breaker 120s before it, so
      // by that clock the 30s window has elapsed and the breaker is half-open.
      const breaker = getProviderCircuitBreaker("email-mailketing");

      for (let i = 0; i < 5; i += 1) {
        breaker.recordFailure(new Date(NOW.getTime() - 120_000));
      }

      const passA = run(T_A, make);

      await until(() => calls.length === 1, "probe in flight");
      const resultB = await run(T_B, make);

      expect(calls).toHaveLength(1);
      expect(resultB.sent).toBe(0);
      expect(await row(b)).toMatchObject({ retry_count: 0 });
      expect(await attempts(b)).toEqual([]);

      held.open();
      expect(await passA).toMatchObject({ sent: 1 });
      expect((await row(a)).status).toBe("sent");
    });

    test("two tenants: a provider fault while dispatching tenant A leaves tenant B's queue byte-for-byte untouched", async () => {
      const calls: string[] = [];
      await seedMessage(T_A, "x@example.com");
      const other = await seedMessage(T_B, "y@example.com");
      const before = await row(other);

      await run(
        T_A,
        adapter(
          () => ({ ok: true, status: 500, retryAfter: null, body: "" }),
          calls
        )
      );

      expect(await row(other)).toEqual(before);
    });
  });

  // ===========================================================================
  // 3. WhatsApp (real StarSender adapter, scripted HTTP, injected clock)
  // ===========================================================================

  describe("WhatsApp provider faults (#1411)", () => {
    const KEY = Buffer.from(
      Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
    ).toString("base64");
    const ENV = {
      WHATSAPP_ENABLED: "true",
      WHATSAPP_PROVIDER: "log",
      WHATSAPP_RECIPIENT_HASH_KEYS: `k1:${KEY}`
    } as NodeJS.ProcessEnv;
    const DEVICE_KEY = "DEVICEKEY-fault-injection-1";
    let phoneSeq = 0;

    registerWhatsappTemplate({
      key: "it1411.reminder",
      version: 1,
      purpose: "transactional",
      body: "Reminder for {{name}}",
      variables: ["name"]
    });

    function http(
      script: (
        call: number
      ) => WhatsappHttpResult | Promise<WhatsappHttpResult>,
      calls: string[]
    ): WhatsappHttpClient {
      return async () => {
        calls.push("POST");

        return script(calls.length);
      };
    }

    function provider(client: WhatsappHttpClient) {
      const p = createStarsenderWhatsappProvider({
        deviceKey: DEVICE_KEY,
        timeoutMs: 1000,
        http: client,
        now: () => new Date()
      });

      if (!p) throw new Error("adapter refused its own fixture key");

      return p;
    }

    async function enqueue(tenantId: string): Promise<string> {
      phoneSeq += 1;
      const phone = `+62812345${String(10000 + phoneSeq)}`;
      const result = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
        enqueueWhatsappMessage(
          tx,
          {
            tenantId,
            templateKey: "it1411.reminder",
            variables: { name: "Sari" },
            recipient: { kind: "address", phone },
            idempotencyKey: `k-${phoneSeq}-${crypto.randomUUID()}`
          },
          { env: ENV }
        )
      );

      return (result as { messageId: string }).messageId;
    }

    async function row(id: string) {
      return (
        (await getAdminSql()`
      SELECT status, retry_count, failure_code, next_attempt_at
      FROM awcms_whatsapp_messages WHERE id = ${id}
    `) as {
          status: string;
          retry_count: number;
          failure_code: string | null;
          next_attempt_at: Date | null;
        }[]
      )[0]!;
    }

    async function attempts(id: string) {
      return (await getAdminSql()`
      SELECT outcome FROM awcms_whatsapp_delivery_attempts WHERE message_id = ${id}
    `) as { outcome: string }[];
    }

    const dispatch = (
      tenantId: string,
      p: ReturnType<typeof provider>,
      now: Date = new Date()
    ) =>
      dispatchWhatsappQueue(getWorkerRoleSql(), tenantId, {
        resolveProvider: () => p,
        now,
        env: ENV
      });

    const reply = (status: number, body: string): WhatsappHttpResult => ({
      ok: true,
      status,
      body
    });

    function workerTest(name: string, fn: () => Promise<void>) {
      test(name, async () => {
        if (!workerRoleActivated) return;
        await fn();
      });
    }

    beforeAll(async () => {
      process.env.WHATSAPP_RECIPIENT_HASH_KEYS = `k1:${KEY}`;
    });
    beforeEach(async () => {
      freshIds();
      resetProviderCircuitBreakersForTests();
      await seedTenant(T_A, "fi-wa-a");
      await seedTenant(T_B, "fi-wa-b");
    }, 30000);
    afterEach(() => resetProviderCircuitBreakersForTests());

    workerTest(
      "429: retry_wait, one retry spent, one provider call, one failure attempt",
      async () => {
        const calls: string[] = [];
        const id = await enqueue(T_A);

        expect(
          await dispatch(
            T_A,
            provider(http(() => reply(429, '{"success":false}'), calls))
          )
        ).toMatchObject({ retried: 1, sent: 0 });
        expect(await row(id)).toMatchObject({
          status: "retry_wait",
          retry_count: 1,
          failure_code: "rate_limited"
        });
        expect(calls).toHaveLength(1);
        expect(await attempts(id)).toEqual([{ outcome: "failure" }]);
      }
    );

    workerTest(
      "HTTP 200 with success:false (semantic refusal) is NOT a success: terminal failed/rejected, one call, never retried",
      async () => {
        const calls: string[] = [];
        const id = await enqueue(T_A);
        const p = provider(
          http(() => reply(200, '{"success":false,"message":"invalid"}'), calls)
        );

        expect(await dispatch(T_A, p)).toMatchObject({ failed: 1, sent: 0 });
        expect(await row(id)).toMatchObject({
          status: "failed",
          failure_code: "rejected"
        });

        await dispatch(T_A, p, new Date(Date.now() + 86_400_000));
        expect(calls).toHaveLength(1);
      }
    );

    workerTest(
      "HTTP 200 with a malformed body: terminal failed/malformed_response, one call, no retry (the provider may have accepted)",
      async () => {
        const calls: string[] = [];
        const id = await enqueue(T_A);

        expect(
          await dispatch(
            T_A,
            provider(http(() => reply(200, "<html>gateway</html>"), calls))
          )
        ).toMatchObject({ failed: 1 });
        expect(await row(id)).toMatchObject({
          status: "failed",
          failure_code: "malformed_response"
        });
        expect(calls).toHaveLength(1);
      }
    );

    workerTest(
      "5xx and a transport timeout AFTER the request left (lost ACK): stored as terminal failed/outcome_unknown, NEVER re-sent (no idempotency key at the provider), later passes make zero calls",
      async () => {
        for (const script of [
          () => reply(503, ""),
          (): WhatsappHttpResult => ({
            ok: false,
            reason: "outbound request refused: request_failed"
          })
        ]) {
          resetProviderCircuitBreakersForTests();
          const calls: string[] = [];
          const id = await enqueue(T_A);
          const p = provider(http(script, calls));

          expect(await dispatch(T_A, p)).toMatchObject({
            failed: 1,
            retried: 0
          });
          expect(await row(id)).toMatchObject({
            status: "failed",
            failure_code: "outcome_unknown"
          });
          await dispatch(T_A, p, new Date(Date.now() + 86_400_000));
          expect(calls).toHaveLength(1);
        }
      }
    );

    workerTest(
      "failure BEFORE send (DNS cannot resolve): proves the request never left, so it IS retried with backoff",
      async () => {
        const calls: string[] = [];
        const id = await enqueue(T_A);

        expect(
          await dispatch(
            T_A,
            provider(
              http(
                () => ({
                  ok: false,
                  reason: "outbound request refused: dns_resolution_failed"
                }),
                calls
              )
            )
          )
        ).toMatchObject({ retried: 1 });
        expect(await row(id)).toMatchObject({
          status: "retry_wait",
          failure_code: "network_error"
        });
      }
    );

    workerTest(
      "half-open, concurrent passes (two tenants, one real adapter): ONE provider call; the refused row spends no retry and records no attempt",
      async () => {
        tripToHalfOpen(WHATSAPP_CIRCUIT_BREAKER_KEY);
        const calls: string[] = [];
        const held = gate();
        const a = await enqueue(T_A);
        const b = await enqueue(T_B);
        const p = provider(
          http(async () => {
            await held.promise;

            return reply(200, '{"success":true}');
          }, calls)
        );

        const passA = dispatch(T_A, p);

        await until(() => calls.length === 1, "probe in flight");
        const resultB = await dispatch(T_B, p);

        expect(calls).toHaveLength(1);
        expect(resultB.sent).toBe(0);
        expect(await row(b)).toMatchObject({ retry_count: 0 });
        expect(await attempts(b)).toEqual([]);

        held.open();
        expect(await passA).toMatchObject({ sent: 1 });
        expect((await row(a)).status).toBe("sent");
      }
    );

    workerTest(
      "two tenants: tenant B's failing provider answer never changes tenant A's row",
      async () => {
        const calls: string[] = [];
        const a = await enqueue(T_A);

        await enqueue(T_B);
        await dispatch(T_B, provider(http(() => reply(429, "{}"), calls)));
        expect(await row(a)).toMatchObject({
          status: "queued",
          retry_count: 0
        });
      }
    );
  });

  // ===========================================================================
  // 4. Push (real Web Push adapter, scripted HTTP)
  // ===========================================================================

  describe("push provider faults (#1411)", () => {
    const KEY = Buffer.from(
      Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
    ).toString("base64");
    const ENV = {
      PUSH_ENABLED: "true",
      PUSH_PROVIDER: "web_push",
      PUSH_AUTH_SECRET_ENCRYPTION_KEYS: `k1:${KEY}`
    } as unknown as NodeJS.ProcessEnv;
    const RING = (() => {
      const ring = resolvePushAuthSecretRing(ENV);

      if (!ring.ok) throw new Error(ring.reason);

      return ring;
    })();
    let ua: { p256dh: string; auth: string };
    let vapid: { publicKey: string; privateKey: string; subject: string };

    type Answer =
      | { ok: true; status: number; body: string }
      | { ok: false; reason: string };

    function service(answer: (call: number) => Answer | Promise<Answer>) {
      const calls: { url: string; request: PushHttpRequest }[] = [];
      const client: PushHttpClient = async (url, request) => {
        calls.push({ url, request });

        return answer(calls.length);
      };

      return { calls, client };
    }

    const provider = (client: PushHttpClient) =>
      createWebPushProvider({
        vapid,
        timeoutMs: 5000,
        http: client,
        payloadFormat: "legacy",
        publicOrigin: "https://admin.example.test"
      });

    async function subscribe(tenantId: string, userId: string, n: number) {
      await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
        registerPushSubscription(
          tx,
          tenantId,
          {
            tenantUserId: userId,
            transport: "web_push",
            endpoint: `https://push.example.test/send/${tenantId.slice(0, 8)}-${n}`,
            p256dhKey: ua.p256dh,
            authSecret: ua.auth
          },
          RING
        )
      );
    }

    async function enqueue(tenantId: string, userId: string): Promise<string> {
      const queued = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
        enqueuePushToRecipients(tx, tenantId, [userId], {
          category: "approval.pending",
          title: "Satu approval menunggu",
          body: "Buka konsol approval.",
          targetPath: "/admin/approvals",
          data: { k: "v" }
        })
      );

      return queued.messageIds[0]!;
    }

    async function row(id: string) {
      return (
        (await getAdminSql()`
      SELECT status, retry_count, next_attempt_at FROM awcms_push_messages WHERE id = ${id}
    `) as {
          status: string;
          retry_count: number;
          next_attempt_at: Date | null;
        }[]
      )[0]!;
    }

    async function attempts(id: string) {
      return (await getAdminSql()`
      SELECT outcome FROM awcms_push_delivery_attempts WHERE message_id = ${id}
    `) as { outcome: string }[];
    }

    const dispatch = (
      tenantId: string,
      p: ReturnType<typeof provider>,
      now?: Date
    ) =>
      dispatchPushQueue(workerSql(), tenantId, {
        env: ENV,
        ...(now ? { now } : {}),
        resolveProvider: () => p
      });

    beforeAll(async () => {
      const pair = (await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
      )) as CryptoKeyPair;

      ua = {
        p256dh: Buffer.from(
          await crypto.subtle.exportKey("raw", pair.publicKey)
        ).toString("base64url"),
        auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
          "base64url"
        )
      };
      const v = (await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      )) as CryptoKeyPair;
      const jwk = (await crypto.subtle.exportKey("jwk", v.privateKey)) as {
        d: string;
      };

      vapid = {
        publicKey: Buffer.from(
          await crypto.subtle.exportKey("raw", v.publicKey)
        ).toString("base64url"),
        privateKey: jwk.d,
        subject: "mailto:ops@example.test"
      };
    });
    beforeEach(async () => {
      freshIds();
      resetProviderCircuitBreakersForTests();
      clearVapidTokenCache();
      await seedTenant(T_A, "fi-push-a", USER_A);
      await seedTenant(T_B, "fi-push-b", USER_B);
    }, 30000);
    afterEach(() => resetProviderCircuitBreakersForTests());

    test("half-open, concurrent passes (two tenants, one real adapter): ONE push-service call; the refused message is deferred with no attempt and no retry spent", async () => {
      tripToHalfOpen(PUSH_CIRCUIT_BREAKER_KEY);
      const held = gate();
      const svc = service(async () => {
        await held.promise;

        return { ok: true, status: 201, body: "" };
      });
      const p = provider(svc.client);

      await subscribe(T_A, USER_A, 1);
      await subscribe(T_B, USER_B, 1);
      const a = await enqueue(T_A, USER_A);
      const b = await enqueue(T_B, USER_B);

      const passA = dispatch(T_A, p);

      await until(() => svc.calls.length === 1, "probe in flight");
      const resultB = await dispatch(T_B, p);

      expect(svc.calls).toHaveLength(1);
      expect(resultB.sent).toBe(0);
      expect(Number((await row(b)).retry_count)).toBe(0);
      expect(await attempts(b)).toEqual([]);

      held.open();
      expect(await passA).toMatchObject({ sent: 1 });
      expect((await row(a)).status).toBe("sent");
    });

    test("HTTP 200-class oddities are not acceptance: a 500 with a HTML body is a retryable service fault (retry_wait, one call), never 'sent'", async () => {
      await subscribe(T_A, USER_A, 1);
      const id = await enqueue(T_A, USER_A);
      const svc = service(() => ({
        ok: true,
        status: 500,
        body: "<html>oops</html>"
      }));

      expect(await dispatch(T_A, provider(svc.client), NOW)).toMatchObject({
        retried: 1,
        sent: 0
      });
      expect((await row(id)).status).toBe("retry_wait");
      expect(svc.calls).toHaveLength(1);
      expect(await attempts(id)).toEqual([{ outcome: "failure" }]);
    });

    test("provider fault in tenant A never touches tenant B's queue", async () => {
      await subscribe(T_A, USER_A, 1);
      await subscribe(T_B, USER_B, 1);
      await enqueue(T_A, USER_A);
      const other = await enqueue(T_B, USER_B);
      const before = await row(other);
      const svc = service(() => ({ ok: true, status: 503, body: "" }));

      await dispatch(T_A, provider(svc.client), NOW);
      expect(await row(other)).toEqual(before);
    });
  });
});
