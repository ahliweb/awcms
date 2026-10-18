/**
 * Push delivery operator matrix, automated half (Issue #1107), against a real
 * database. The manual half (real devices) is in
 * `docs/awcms/push-notifications-test-matrix.md`.
 *
 * WHAT "DELIVERED" MEANS HERE. Every assertion below is about the SERVER side:
 * a push service answered 2xx ("provider accepted"), which the queue records as
 * `status = 'sent'`. None of these tests, and nothing in the product, can know
 * that a device SHOWED the notification; that is only ever observed by a human
 * on a device. Do not rename `sent` to "delivered to device" in a test title.
 *
 * Reuses the REAL web-push adapter with a scripted HTTP client, so provider
 * answers (201, 410, 429, 5xx, transport timeout) travel the production
 * mapping rather than a hand-written `{ ok: false }`. Existing coverage is not
 * repeated (see the matrix doc): recipient-bound dispatch, transfer, re-key and
 * "disable cancels queued" live in `push-rekey-takeover`, encryption at rest in
 * `push-auth-secret-at-rest`, the adapter/payload shapes in the unit files.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
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
import { resetProviderCircuitBreakersForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { dispatchPushQueue } from "../../src/modules/push-delivery/application/push-dispatch";
import { enqueuePushToRecipients } from "../../src/modules/push-delivery/application/push-enqueue";
import {
  registerPushSubscription,
  revokeOwnPushSubscription
} from "../../src/modules/push-delivery/application/subscription-directory";
import { resolvePushAuthSecretRing } from "../../src/modules/push-delivery/domain/push-auth-secret";
import type { PushProvider } from "../../src/modules/push-delivery/domain/push-provider-contract";
import type { PushPayloadFormat } from "../../src/modules/push-delivery/domain/push-payload-format";
import type {
  PushHttpClient,
  PushHttpRequest
} from "../../src/modules/push-delivery/infrastructure/push-http-client";
import { clearVapidTokenCache } from "../../src/modules/push-delivery/infrastructure/vapid-jwt";
import { createWebPushProvider } from "../../src/modules/push-delivery/infrastructure/web-push-provider";

const T_A = "f1107000-0000-4000-8000-00000000000a";
const T_B = "f1107000-0000-4000-8000-00000000000b";
const USER_A = "f1107000-0000-4000-8000-0000000000a1";
const USER_B = "f1107000-0000-4000-8000-0000000000b1";

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

// A fresh user-agent key and auth secret per run: a valid P-256 point so the
// REAL adapter can encrypt to it, and no key literal for secret scanners.
async function generateUserAgentKeys() {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;

  return {
    p256dh: Buffer.from(
      await crypto.subtle.exportKey("raw", pair.publicKey)
    ).toString("base64url"),
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
      "base64url"
    )
  };
}

const UA_KEYS = await generateUserAgentKeys();
const UA_PUBLIC = UA_KEYS.p256dh;
const UA_AUTH = UA_KEYS.auth;

/** Generated at run time, never committed (a committed key pair trips secret scanners). */
async function generateVapid() {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const pub = Buffer.from(
    await crypto.subtle.exportKey("raw", pair.publicKey)
  ).toString("base64url");
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as {
    d: string;
  };

  return {
    publicKey: pub,
    privateKey: jwk.d,
    subject: "mailto:ops@example.test"
  };
}

const VAPID = await generateVapid();

type HttpAnswer =
  { ok: true; status: number; body: string } | { ok: false; reason: string };

/** Scripted push service: answers by endpoint, records every request. */
function pushService(answer: (endpoint: string) => HttpAnswer) {
  const calls: { url: string; request: PushHttpRequest }[] = [];
  const http: PushHttpClient = async (url, request) => {
    calls.push({ url, request });

    return answer(url);
  };

  return { calls, http };
}

function realProvider(http: PushHttpClient, format: PushPayloadFormat) {
  return createWebPushProvider({
    vapid: VAPID,
    timeoutMs: 5000,
    http,
    payloadFormat: format,
    publicOrigin: "https://admin.example.test"
  });
}

const endpointOf = (tenant: string, n: number) =>
  `https://push.example.test/send/${tenant.slice(-1)}-${n}`;

async function seedTenant(
  tenantId: string,
  code: string,
  userId: string
): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${code})
  `;

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

function register(tenantId: string, userId: string, n: number) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    registerPushSubscription(
      tx,
      tenantId,
      {
        tenantUserId: userId,
        transport: "web_push",
        endpoint: endpointOf(tenantId, n),
        p256dhKey: UA_PUBLIC,
        authSecret: UA_AUTH
      },
      RING
    )
  );
}

function enqueue(tenantId: string, userId: string, category: string) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    enqueuePushToRecipients(tx, tenantId, [userId], {
      category,
      title: "Satu approval menunggu",
      body: "Buka konsol approval.",
      targetPath: "/admin/approvals",
      data: { k: "v" }
    })
  );
}

function dispatch(
  tenantId: string,
  provider: PushProvider,
  options: { now?: Date; env?: NodeJS.ProcessEnv } = {}
) {
  const sql = workerRoleActivated ? getWorkerRoleSql() : getRuntimeSql();

  return dispatchPushQueue(sql, tenantId, {
    env: options.env ?? ENV,
    ...(options.now ? { now: options.now } : {}),
    resolveProvider: () => provider
  });
}

async function messageRow(id: string) {
  const rows = (await getAdminSql()`
    SELECT status, retry_count, next_attempt_at, last_error, sent_at, provider_name
    FROM awcms_push_messages WHERE id = ${id}
  `) as {
    status: string;
    retry_count: number;
    next_attempt_at: Date | null;
    last_error: string | null;
    sent_at: Date | null;
    provider_name: string | null;
  }[];

  return rows[0]!;
}

async function attemptsOf(id: string) {
  return (await getAdminSql()`
    SELECT attempt_no, outcome FROM awcms_push_delivery_attempts
    WHERE message_id = ${id} ORDER BY attempt_no
  `) as { attempt_no: number; outcome: string }[];
}

function recorder(seen: string[]): PushProvider {
  return {
    supportedTransports: ["web_push", "fcm"],
    async send(target) {
      seen.push(target.endpoint);

      return { ok: true };
    },
    async healthCheck() {
      return { ok: true };
    }
  };
}

const suite = integrationEnabled ? describe : describe.skip;

suite("push operator matrix, automated half (#1107)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetProviderCircuitBreakersForTests();
    clearVapidTokenCache();
    await seedTenant(T_A, "push-mx-a", USER_A);
    await seedTenant(T_B, "push-mx-b", USER_B);
  });

  afterEach(() => {
    resetProviderCircuitBreakersForTests();
  });

  test.each<PushPayloadFormat>(["legacy", "declarative"])(
    "enqueue -> dispatch -> provider accepted (201) -> sent, payload format %s",
    async (format) => {
      const sub = await register(T_A, USER_A, 1);
      const queued = await enqueue(T_A, USER_A, "approval.pending");
      const service = pushService(() => ({ ok: true, status: 201, body: "" }));

      const result = await dispatch(T_A, realProvider(service.http, format));

      expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
      expect(service.calls).toHaveLength(1);
      expect(service.calls[0]!.url).toBe(endpointOf(T_A, 1));
      // The wire body is encrypted; only its framing is observable here.
      expect(service.calls[0]!.request.headers["Content-Encoding"]).toBe(
        "aes128gcm"
      );

      const row = await messageRow(queued.messageIds[0]!);

      // `sent` = the push service ACCEPTED it. It says nothing about the device.
      expect(row.status).toBe("sent");
      expect(row.sent_at).not.toBeNull();
      expect(row.provider_name).toBe("web_push");
      expect(await attemptsOf(queued.messageIds[0]!)).toEqual([
        { attempt_no: 1, outcome: "success" }
      ]);

      const subRow = (await getAdminSql()`
        SELECT last_success_at FROM awcms_push_subscriptions WHERE id = ${sub.id}
      `) as { last_success_at: Date | null }[];

      expect(subRow[0]!.last_success_at).not.toBeNull();

      // A second pass finds nothing due: no double send.
      const again = await dispatch(T_A, realProvider(service.http, format));

      expect(again.claimed).toBe(0);
      expect(service.calls).toHaveLength(1);
    }
  );

  test.each([
    ["429 rate limited", { ok: true, status: 429, body: "" }],
    ["503 push service unavailable", { ok: true, status: 503, body: "" }],
    ["transport timeout", { ok: false, reason: "request timed out" }]
  ] as [string, HttpAnswer][])(
    "%s: retry_wait with backoff, not re-sent early, then accepted",
    async (_label, failure) => {
      await register(T_A, USER_A, 1);
      const queued = await enqueue(T_A, USER_A, "approval.pending");
      const id = queued.messageIds[0]!;
      let answer: HttpAnswer = failure;
      const service = pushService(() => answer);
      const t0 = new Date();

      const first = await dispatch(T_A, realProvider(service.http, "legacy"), {
        now: t0
      });

      expect(first).toMatchObject({ claimed: 1, retried: 1, sent: 0 });

      const waiting = await messageRow(id);

      expect(waiting.status).toBe("retry_wait");
      expect(Number(waiting.retry_count)).toBe(1);
      // First backoff is exactly 2^0 = 1 minute after the failed pass.
      expect(waiting.next_attempt_at!.getTime()).toBe(t0.getTime() + 60_000);

      // Not due yet: nothing is claimed and the provider is not touched.
      const early = await dispatch(T_A, realProvider(service.http, "legacy"), {
        now: new Date(t0.getTime() + 30_000)
      });

      expect(early.claimed).toBe(0);
      expect(service.calls).toHaveLength(1);

      // Recovered provider: the due retry is accepted.
      answer = { ok: true, status: 201, body: "" };
      resetProviderCircuitBreakersForTests();

      const retry = await dispatch(T_A, realProvider(service.http, "legacy"), {
        now: new Date(t0.getTime() + 61_000)
      });

      expect(retry).toMatchObject({ claimed: 1, sent: 1 });
      expect((await messageRow(id)).status).toBe("sent");
      expect(await attemptsOf(id)).toEqual([
        { attempt_no: 1, outcome: "failure" },
        { attempt_no: 2, outcome: "success" }
      ]);
    }
  );

  test("retries are bounded: a persistently failing provider ends in failed, not a loop", async () => {
    await register(T_A, USER_A, 1);
    const id = (await enqueue(T_A, USER_A, "approval.pending")).messageIds[0]!;
    const service = pushService(() => ({ ok: true, status: 503, body: "" }));
    const env = { ...ENV, PUSH_SEND_MAX_RETRIES: "1" } as NodeJS.ProcessEnv;
    let now = new Date();

    await dispatch(T_A, realProvider(service.http, "legacy"), { now, env });
    expect((await messageRow(id)).status).toBe("retry_wait");

    resetProviderCircuitBreakersForTests();
    now = new Date(now.getTime() + 5 * 60_000);

    const last = await dispatch(T_A, realProvider(service.http, "legacy"), {
      now,
      env
    });

    expect(last.failed).toBe(1);
    expect((await messageRow(id)).status).toBe("failed");
    expect(service.calls).toHaveLength(2);
  });

  test("a permanent refusal (403) fails at once and is not retried", async () => {
    await register(T_A, USER_A, 1);
    const id = (await enqueue(T_A, USER_A, "approval.pending")).messageIds[0]!;
    const service = pushService(() => ({ ok: true, status: 403, body: "" }));

    const result = await dispatch(T_A, realProvider(service.http, "legacy"));

    expect(result).toMatchObject({ failed: 1, retried: 0 });
    expect((await messageRow(id)).status).toBe("failed");
  });

  test.each([404, 410])(
    "%d gone: the subscription is disabled and leaves future fan-out",
    async (status) => {
      const sub = await register(T_A, USER_A, 1);
      const first = (await enqueue(T_A, USER_A, "approval.pending"))
        .messageIds[0]!;
      const service = pushService(() => ({ ok: true, status, body: "" }));

      const result = await dispatch(T_A, realProvider(service.http, "legacy"));

      expect(result).toMatchObject({ subscriptionsDisabled: 1, retried: 0 });
      expect((await messageRow(first)).status).toBe("failed");

      const subRow = (await getAdminSql()`
        SELECT status, disabled_reason FROM awcms_push_subscriptions WHERE id = ${sub.id}
      `) as { status: string; disabled_reason: string | null }[];

      expect(subRow[0]!.status).toBe("disabled");
      expect(subRow[0]!.disabled_reason).not.toBeNull();

      // A later notification for the same person finds no active device.
      const later = await enqueue(T_A, USER_A, "approval.later");

      expect(later.messageIds).toEqual([]);
      expect(later.skippedRecipients).toEqual([USER_A]);
      expect(service.calls).toHaveLength(1);
    }
  );

  test("tenant isolation: tenant A's dispatch never reaches tenant B's subscription, and RLS hides B's rows", async () => {
    await register(T_A, USER_A, 1);
    const subB = await register(T_B, USER_B, 1);
    await enqueue(T_A, USER_A, "approval.pending");
    const idB = (await enqueue(T_B, USER_B, "approval.pending")).messageIds[0]!;
    const service = pushService(() => ({ ok: true, status: 201, body: "" }));

    const result = await dispatch(T_A, realProvider(service.http, "legacy"));

    expect(result.sent).toBe(1);
    expect(service.calls.map((c) => c.url)).toEqual([endpointOf(T_A, 1)]);
    expect((await messageRow(idB)).status).toBe("queued");

    // Under tenant A's context B's rows do not exist (RLS FORCE), by id too.
    const seen = await withTenantOrThrow(getRuntimeSql(), T_A, async (tx) => ({
      messages: await tx`SELECT id FROM awcms_push_messages WHERE id = ${idB}`,
      subs: await tx`SELECT id FROM awcms_push_subscriptions WHERE id = ${subB.id}`,
      all: await tx`SELECT tenant_id FROM awcms_push_messages`
    }));

    expect(seen.messages).toHaveLength(0);
    expect(seen.subs).toHaveLength(0);
    expect(
      (seen.all as { tenant_id: string }[]).every((r) => r.tenant_id === T_A)
    ).toBe(true);

    // B drains independently, to B's endpoint only.
    const resultB = await dispatch(T_B, realProvider(service.http, "legacy"));

    expect(resultB.sent).toBe(1);
    expect(service.calls.map((c) => c.url)).toEqual([
      endpointOf(T_A, 1),
      endpointOf(T_B, 1)
    ]);
  });

  test("revoke (unsubscribe) cancels queued messages and nothing is sent afterwards", async () => {
    const sub = await register(T_A, USER_A, 1);
    const id = (await enqueue(T_A, USER_A, "approval.pending")).messageIds[0]!;

    const revoked = await withTenantOrThrow(getRuntimeSql(), T_A, (tx) =>
      revokeOwnPushSubscription(tx, T_A, USER_A, sub.id)
    );

    expect(revoked.revoked).toBe(true);

    const service = pushService(() => ({ ok: true, status: 201, body: "" }));
    const result = await dispatch(T_A, realProvider(service.http, "legacy"));

    expect(result.claimed).toBe(0);
    expect(service.calls).toHaveLength(0);

    const row = await messageRow(id);

    expect(row.status).toBe("cancelled");
    expect(row.last_error).toBe("subscription_revoked");
  });

  test("worker crash mid-batch: stranded rows are reclaimed only after the lease, the one already sent is not sent again", async () => {
    await register(T_A, USER_A, 1);
    const ids: string[] = [];

    for (const c of ["a.one", "a.two", "a.three"]) {
      ids.push((await enqueue(T_A, USER_A, c)).messageIds[0]!);
    }

    let calls = 0;
    const firstPass: string[] = [];
    const crashing: PushProvider = {
      supportedTransports: ["web_push", "fcm"],
      async send(target) {
        calls += 1;

        if (calls === 2) throw new Error("worker killed");

        firstPass.push(target.endpoint);

        return { ok: true };
      },
      async healthCheck() {
        return { ok: true };
      }
    };
    const t0 = new Date();

    await expect(dispatch(T_A, crashing, { now: t0 })).rejects.toThrow(
      "worker killed"
    );

    const states = await Promise.all(ids.map((i) => messageRow(i)));

    expect(states.map((s) => s.status).sort()).toEqual([
      "sending",
      "sending",
      "sent"
    ]);

    // Inside the 2-minute lease the stranded rows are NOT stolen.
    const secondPass: string[] = [];
    const during = await dispatch(T_A, recorder(secondPass), {
      now: new Date(t0.getTime() + 30_000)
    });

    expect(during.claimed).toBe(0);

    // After the lease they are reclaimed and sent exactly once each.
    const after = await dispatch(T_A, recorder(secondPass), {
      now: new Date(t0.getTime() + 3 * 60_000)
    });

    expect(after).toMatchObject({ claimed: 2, sent: 2 });
    expect(secondPass).toHaveLength(2);
    expect(firstPass).toHaveLength(1);

    const final = await Promise.all(ids.map((i) => messageRow(i)));

    expect(final.every((s) => s.status === "sent")).toBe(true);
  });

  test("two workers draining at once send every message exactly once (SKIP LOCKED)", async () => {
    await register(T_A, USER_A, 1);

    for (let n = 0; n < 6; n += 1) {
      await enqueue(T_A, USER_A, `bulk.n${n}`);
    }

    let sentCalls = 0;
    const provider: PushProvider = {
      supportedTransports: ["web_push", "fcm"],
      async send() {
        sentCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));

        return { ok: true };
      },
      async healthCheck() {
        return { ok: true };
      }
    };

    const [a, b] = await Promise.all([
      dispatch(T_A, provider),
      dispatch(T_A, provider)
    ]);

    expect(a.claimed + b.claimed).toBe(6);
    expect(a.sent + b.sent).toBe(6);
    expect(sentCalls).toBe(6);
  });
});
