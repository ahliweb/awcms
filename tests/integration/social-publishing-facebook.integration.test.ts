/**
 * The Facebook Pages connector end to end against PostgreSQL (Issue #1146,
 * ADR-0157 section 6): the dispatcher runs on a REAL login as
 * `awcms_social_dispatch` (sql/358 + sql/373), exactly as
 * `social-publishing:dispatch` does in production, with the real credential
 * adapter, the real Facebook adapter and a fake Graph API behind the adapter's
 * HTTP seam (no network). Covered:
 *
 *   * two tenants x three Pages: every Page is published with ITS OWN token to
 *     ITS OWN page id, and a pass for one tenant never touches the other;
 *   * partial failure and replay: a rejected Page changes nothing about a
 *     published sibling, and a second pass publishes nothing again;
 *   * a token Graph refuses (code 190) degrades the account and HOLDS its other
 *     jobs; a revocation between enqueue and dispatch fails the job with no call;
 *   * rate limit (80001 + usage header), a lost answer and a duplicate post
 *     (506): retry with backoff, or `needs_reconciliation`, never a blind retry;
 *   * MIME and size are refused at enqueue for Facebook, never downgraded;
 *   * the role reads ONLY the token of a live, publish-granted Facebook Page,
 *     and cannot widen its own writes (re-queue, cancel, revive an account);
 *     `security:readiness` fails when a write policy is widened.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import type { SsrfGuardResult } from "../../src/lib/auth/ssrf-guard";
import { resetProviderCircuitBreakersForTests } from "../../src/lib/database/circuit-breaker";
import { assertConnectedAsSocialDispatchRole } from "../../src/lib/database/social-publishing-dispatch-client";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { createChannelAccountPortAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import {
  enqueuePublication,
  type EnqueueInput
} from "../../src/modules/social-publishing/application/publication-enqueue";
import {
  dispatchSocialPublishQueue,
  noPublishCredentialPort
} from "../../src/modules/social-publishing/application/social-publish-dispatch";
import type { SocialPublishHttp } from "../../src/modules/social-publishing/domain/social-publish-adapter";
import {
  buildContentSnapshot,
  type MediaFacts
} from "../../src/modules/social-publishing/domain/social-publish-content";
import { createFacebookPagesAdapter } from "../../src/modules/social-publishing/infrastructure/facebook-pages-adapter";
import { createSocialAdapterRegistry } from "../../src/modules/social-publishing/infrastructure/social-adapter-registry";
import {
  SOCIAL_DISPATCH_WRITE_POLICIES,
  checkWorkerSetupRoleGrants,
  pinPolicyExpression,
  probeSocialDispatchWriteBoundary
} from "../../scripts/security-readiness";

const TENANT_A = "a1146000-0000-4000-8000-00000000000a";
const TENANT_B = "a1146000-0000-4000-8000-00000000000b";
const ROLE = "awcms_social_dispatch";
const ROLE_PASSWORD = "t1146-fixture-password";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 5) % 251)
  ).toString("base64");
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${bytes(17)}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);
const ENV = {
  SOCIAL_PUBLISHING_ENABLED: "true",
  SOCIAL_PUBLISHING_FACEBOOK_ENABLED: "true",
  CHANNEL_ACCOUNTS_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;
const publishers = createChannelAccountPortAdapter({ env: ENV });
const credentials = createChannelSenderCredentialAdapter({ store, env: ENV });
const facebook = createFacebookPagesAdapter();
const registry = createSocialAdapterRegistry([facebook]);

const inTenant = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(getRuntimeSql(), tenantId, fn);

const at = (minutes: number) => {
  const instant = new Date(Date.now() + minutes * 60_000 + 1000);

  return () => instant;
};

let dispatchSql: Bun.SQL | undefined;

/** The dispatcher's own login, exactly as `SOCIAL_PUBLISHING_DATABASE_URL` would hold it. */
function roleSql(): Bun.SQL {
  if (!dispatchSql) throw new Error("the dispatch role login is not open");

  return dispatchSql;
}

// ---------------------------------------------------------------------------
// The fake Graph API, behind the adapter's HTTP seam.
// ---------------------------------------------------------------------------

type GraphCall = { pageId: string; edge: string; token: string; body: string };
type GraphAnswer =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | { lost: true };

const graphCalls: GraphCall[] = [];
let graphAnswer: (call: GraphCall, n: number) => GraphAnswer = (call, n) => ({
  status: 200,
  body: { id: `${call.pageId}_${9000 + n}` }
});

const graphHttp: SocialPublishHttp = async (url, init) => {
  const match = url.match(
    /^https:\/\/graph\.facebook\.com\/v27\.0\/([0-9]+)\/(feed|photos)$/
  );

  if (!match) throw new Error(`unexpected Graph URL ${url}`);

  const call: GraphCall = {
    pageId: match[1]!,
    edge: match[2]!,
    token: (init?.headers?.Authorization ?? "").replace(/^Bearer /, ""),
    body: typeof init?.body === "string" ? init.body : ""
  };

  graphCalls.push(call);

  const answer = graphAnswer(call, graphCalls.length);

  if ("lost" in answer) {
    return { ok: false, reason: "request_failed" } as SsrfGuardResult;
  }

  return {
    ok: true,
    response: new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers }
    })
  };
};

function dispatch(
  tenantId: string,
  over: Partial<Parameters<typeof dispatchSocialPublishQueue>[2]> = {}
) {
  return dispatchSocialPublishQueue(roleSql(), tenantId, {
    publishers,
    credentials,
    health: publishers,
    registry,
    env: ENV,
    clock: at(0),
    http: () => graphHttp,
    ...over
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let pageSeq = 610_000_000_000;

type Page = {
  id: string;
  pageId: string;
  token: string;
  connectionId: string;
  secretId: string;
};

async function seedPage(
  tenantId: string,
  seed: { provider?: string; capability?: "granted" | "denied" } = {}
): Promise<Page> {
  const admin = getAdminSql();
  const provider = seed.provider ?? "facebook";
  const pageId = String((pageSeq += 1));
  const token = `EAAG-${tenantId.slice(-1)}-${pageId}`;
  const access = await inTenant(tenantId, (tx) =>
    store.put(tx, {
      tenantId,
      purpose: "provider_access_token",
      plaintext: token,
      createdBy: null
    })
  );
  const connection = (await admin`
    INSERT INTO awcms_channel_provider_connections
      (tenant_id, provider, auth_mode, grant_state, access_secret_id)
    VALUES (${tenantId}, ${provider}, 'oauth2', 'active', ${access.secretId})
    RETURNING id
  `) as { id: string }[];
  const kind = provider === "facebook" ? "page" : "waba_phone_number";
  const account = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, connection_id)
    VALUES (${tenantId}, ${provider}, ${kind}, ${pageId}, ${`Page ${pageId}`},
            'oauth2', 'connected', ${connection[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const granted = (seed.capability ?? "granted") === "granted";

  await admin`
    INSERT INTO awcms_channel_account_capabilities
      (tenant_id, account_id, capability, state, evidence_kind, evidence_ref,
       matrix_version, verified_at)
    VALUES (${tenantId}, ${account[0]!.id}, 'publish',
            ${granted ? "granted" : "denied"},
            ${granted ? "app_review_reference" : null},
            ${granted ? "meta-app-review-fixture" : null},
            ${PROVIDER_MATRIX_VERSION}, ${granted ? new Date() : null})
  `;

  return {
    id: account[0]!.id,
    pageId,
    token,
    connectionId: connection[0]!.id,
    secretId: access.secretId
  };
}

function snapshot(media: MediaFacts | null = null, caption = "Hello Pages.") {
  const built = buildContentSnapshot({
    title: "Headline",
    caption,
    linkUrl: "https://cms.example/blog/a/headline",
    media
  });

  if (!built.ok) throw new Error(`fixture: ${built.code}`);

  return built.snapshot;
}

function input(
  accountIds: string[],
  over: Partial<EnqueueInput> = {}
): EnqueueInput {
  return {
    source: { kind: "manual" },
    snapshot: snapshot(),
    mediaObjectId: null,
    accountIds,
    approvalRequired: false,
    notBefore: null,
    actorTenantUserId: null,
    correlationId: "corr-1146",
    ...over
  };
}

const enqueue = (tenantId: string, value: EnqueueInput) =>
  inTenant(tenantId, (tx) =>
    enqueuePublication(tx, tenantId, value, { publishers, registry })
  );

type JobRow = {
  id: string;
  tenant_id: string;
  channel_account_id: string;
  status: string;
  attempt_count: number;
  hold_count: number;
  failure_code: string | null;
  external_post_id: string | null;
  external_post_url: string | null;
  next_attempt_at: Date;
};

async function jobsOf(publicationId: string): Promise<JobRow[]> {
  return (await getAdminSql()`
    SELECT id, tenant_id, channel_account_id, status, attempt_count,
           hold_count, failure_code, external_post_id, external_post_url,
           next_attempt_at
    FROM awcms_social_publish_jobs WHERE publication_id = ${publicationId}
    ORDER BY created_at, id
  `) as JobRow[];
}

const byAccount = (rows: JobRow[], accountId: string) =>
  rows.find((row) => row.channel_account_id === accountId)!;

async function seedTenants(): Promise<void> {
  for (const [id, code] of [
    [TENANT_A, "fb1146-a"],
    [TENANT_B, "fb1146-b"]
  ] as const) {
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }
}

const suite = integrationEnabled ? describe : describe.skip;

suite("the Facebook Pages connector against PostgreSQL", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();

    const admin = getAdminSql();
    const database = (
      (await admin`SELECT current_database() AS name`) as { name: string }[]
    )[0]!.name;
    const url = new URL(process.env.DATABASE_URL!);

    url.username = ROLE;
    url.password = ROLE_PASSWORD;
    url.pathname = `/${database}`;

    await admin.unsafe(`ALTER ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}'`);
    dispatchSql = new Bun.SQL(url.toString(), { max: 2 });
  });

  afterAll(async () => {
    await dispatchSql?.close({ timeout: 1 });
    dispatchSql = undefined;
    // Back to the shipped state (sql/358: NOLOGIN, passwordless).
    await getAdminSql().unsafe(`ALTER ROLE ${ROLE} NOLOGIN PASSWORD NULL`);
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetProviderCircuitBreakersForTests();
    graphCalls.length = 0;
    graphAnswer = (call, n) => ({
      status: 200,
      body: { id: `${call.pageId}_${9000 + n}` }
    });
    await seedTenants();
  });

  test("the dispatcher's connection IS awcms_social_dispatch, and a superuser connection is refused", async () => {
    await assertConnectedAsSocialDispatchRole(roleSql());

    let refused = false;

    try {
      await assertConnectedAsSocialDispatchRole(getAdminSql());
    } catch {
      refused = true;
    }

    expect(refused).toBe(true);
  });

  test("two tenants x three Pages: each Page gets ITS OWN token and page id; one tenant's pass never touches the other", async () => {
    const pagesA = [
      await seedPage(TENANT_A),
      await seedPage(TENANT_A),
      await seedPage(TENANT_A)
    ];
    const pagesB = [
      await seedPage(TENANT_B),
      await seedPage(TENANT_B),
      await seedPage(TENANT_B)
    ];
    const pubA = await enqueue(TENANT_A, input(pagesA.map((page) => page.id)));
    const pubB = await enqueue(TENANT_B, input(pagesB.map((page) => page.id)));

    expect(pubA.jobsCreated).toBe(3);
    expect(pubB.jobsCreated).toBe(3);

    const resultA = await dispatch(TENANT_A);

    expect(resultA.published).toBe(3);
    expect(graphCalls).toHaveLength(3);

    // Tenant B untouched by tenant A's pass.
    expect(
      (await jobsOf(pubB.publicationId!)).every(
        (job) => job.status === "queued"
      )
    ).toBe(true);

    await dispatch(TENANT_B);

    expect(graphCalls).toHaveLength(6);

    for (const page of [...pagesA, ...pagesB]) {
      const calls = graphCalls.filter((call) => call.pageId === page.pageId);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.token).toBe(page.token);
      expect(calls[0]!.edge).toBe("feed");
    }

    for (const [pub, pages] of [
      [pubA, pagesA],
      [pubB, pagesB]
    ] as const) {
      const rows = await jobsOf(pub.publicationId!);

      for (const page of pages) {
        const job = byAccount(rows, page.id);

        expect(job.status).toBe("published");
        expect(job.external_post_id).toStartWith(`${page.pageId}_`);
        expect(job.external_post_url).toBe(
          `https://www.facebook.com/${job.external_post_id}`
        );
      }
    }

    // No token reached a row, an attempt, an event or an audit line.
    const leaked = (await getAdminSql()`
      SELECT
        (SELECT count(*) FROM awcms_social_publish_jobs
          WHERE coalesce(last_error, '') || coalesce(external_post_url, '') LIKE '%EAAG%')
        + (SELECT count(*) FROM awcms_social_publish_attempts
            WHERE coalesce(error_message, '') LIKE '%EAAG%')
        + (SELECT count(*) FROM awcms_audit_events WHERE attributes::text LIKE '%EAAG%')
        + (SELECT count(*) FROM awcms_domain_events WHERE payload::text LIKE '%EAAG%')
        AS n
    `) as { n: number }[];

    expect(Number(leaked[0]!.n)).toBe(0);
  });

  test("partial failure never replays: a rejected Page leaves the published siblings alone, and a second pass sends nothing", async () => {
    const pages = [
      await seedPage(TENANT_A),
      await seedPage(TENANT_A),
      await seedPage(TENANT_A)
    ];
    const rejectedPage = pages[1]!.pageId;

    graphAnswer = (call, n) =>
      call.pageId === rejectedPage
        ? { status: 400, body: { error: { code: 100, message: "bad" } } }
        : { status: 200, body: { id: `${call.pageId}_${n}` } };

    const pub = await enqueue(TENANT_A, input(pages.map((page) => page.id)));
    const first = await dispatch(TENANT_A);

    expect(first.published).toBe(2);
    expect(first.failed).toBe(1);

    const rows = await jobsOf(pub.publicationId!);

    expect(byAccount(rows, pages[1]!.id)).toMatchObject({
      status: "failed",
      failure_code: "FB_INVALID_PARAMETER"
    });

    graphCalls.length = 0;

    const replay = await dispatch(TENANT_A, { clock: at(60) });

    expect(replay.claimed).toBe(0);
    expect(graphCalls).toHaveLength(0);

    const again = await enqueue(TENANT_A, input(pages.map((page) => page.id)));

    // A manual publication is a NEW intent; the published ones keep their ids.
    expect(again.publicationId).not.toBe(pub.publicationId);
    expect(
      (await jobsOf(pub.publicationId!)).filter(
        (job) => job.status === "published"
      )
    ).toHaveLength(2);
  });

  test("Graph refuses the token (190): the job fails NEEDS_REAUTH, the account goes degraded, its other job is HELD and never sent", async () => {
    const revokedInMeta = await seedPage(TENANT_A);
    const healthy = await seedPage(TENANT_A);

    graphAnswer = (call, n) =>
      call.pageId === revokedInMeta.pageId
        ? {
            status: 400,
            body: { error: { code: 190, error_subcode: 463, message: "x" } }
          }
        : { status: 200, body: { id: `${call.pageId}_${n}` } };

    const first = await enqueue(
      TENANT_A,
      input([revokedInMeta.id, healthy.id])
    );
    const second = await enqueue(
      TENANT_A,
      input([revokedInMeta.id], { snapshot: snapshot(null, "Second post.") })
    );

    // One pass claims both of revokedInMeta's jobs in order? Fair share takes up
    // to three per account, so dispatch them one publication at a time.
    const result = await dispatch(TENANT_A, { perAccountBatch: 1 });

    expect(result.failed).toBe(1);
    expect(
      byAccount(await jobsOf(first.publicationId!), revokedInMeta.id)
    ).toMatchObject({ status: "failed", failure_code: "NEEDS_REAUTH" });
    expect(
      byAccount(await jobsOf(first.publicationId!), healthy.id).status
    ).toBe("published");

    const account = (await getAdminSql()`
      SELECT a.status, a.status_reason, h.state, h.reason_code
      FROM awcms_channel_accounts a
      JOIN awcms_channel_account_health h
        ON h.tenant_id = a.tenant_id AND h.account_id = a.id
      WHERE a.id = ${revokedInMeta.id}
    `) as {
      status: string;
      status_reason: string;
      state: string;
      reason_code: string;
    }[];

    expect(account[0]).toEqual({
      status: "degraded",
      status_reason: "PUBLISH_CREDENTIAL_REJECTED",
      state: "failing",
      reason_code: "PUBLISH_CREDENTIAL_REJECTED"
    });

    const callsBefore = graphCalls.length;

    await dispatch(TENANT_A, { clock: at(1) });

    expect(graphCalls).toHaveLength(callsBefore);
    expect((await jobsOf(second.publicationId!))[0]).toMatchObject({
      status: "queued",
      hold_count: 1,
      failure_code: "HELD_ACCOUNT_DEGRADED"
    });

    const audit = (await getAdminSql()`
      SELECT attributes FROM awcms_audit_events
      WHERE action = 'social_publishing.job.failed'
    `) as { attributes: { accountDegraded: boolean } }[];

    expect(audit.map((row) => row.attributes.accountDegraded)).toEqual([true]);
  });

  test("a revocation between enqueue and dispatch fails the job with no Graph call, and the role can no longer read the token", async () => {
    const page = await seedPage(TENANT_A);
    const pub = await enqueue(TENANT_A, input([page.id]));

    await getAdminSql()`
      UPDATE awcms_channel_accounts SET status = 'revoked', revoked_at = now()
      WHERE id = ${page.id}
    `;

    const result = await dispatch(TENANT_A);

    expect(result.failed).toBe(1);
    expect(graphCalls).toHaveLength(0);
    // The dispatcher prefixes every terminal account reason with `ACCOUNT_`
    // (`classifyAccountReason`, #1145), so the reason ACCOUNT_REVOKED reads so.
    expect((await jobsOf(pub.publicationId!))[0]!.failure_code).toBe(
      "ACCOUNT_ACCOUNT_REVOKED"
    );

    const visible = await withTenantOrThrow(
      roleSql(),
      TENANT_A,
      async (tx) =>
        (await tx`SELECT id FROM awcms_channel_secrets`) as { id: string }[]
    );

    expect(visible.map((row) => row.id)).not.toContain(page.secretId);
  });

  test("rate limit (80001): retry_wait for the time the usage header asks, nothing failed, nothing sent early", async () => {
    const page = await seedPage(TENANT_A);
    const pub = await enqueue(TENANT_A, input([page.id]));

    graphAnswer = () => ({
      status: 400,
      body: { error: { code: 80001, message: "too many calls" } },
      headers: {
        "x-business-use-case-usage": JSON.stringify({
          [page.pageId]: [
            {
              type: "pages",
              call_count: 100,
              estimated_time_to_regain_access: 19
            }
          ]
        })
      }
    });

    const now = at(0);
    const result = await dispatch(TENANT_A, { clock: now });

    expect(result.retried).toBe(1);

    const job = (await jobsOf(pub.publicationId!))[0]!;

    expect(job).toMatchObject({
      status: "retry_wait",
      failure_code: "FB_RATE_LIMITED"
    });
    expect(job.next_attempt_at.getTime()).toBeGreaterThanOrEqual(
      now().getTime() + 19 * 60_000
    );

    await dispatch(TENANT_A, { clock: at(10) });

    expect(graphCalls).toHaveLength(1);
  });

  test("a lost answer, a gateway 5xx and a duplicate post (506) become needs_reconciliation and are never retried by the dispatcher", async () => {
    const lost = await seedPage(TENANT_A);
    const gateway = await seedPage(TENANT_A);
    const duplicate = await seedPage(TENANT_A);

    graphAnswer = (call) =>
      call.pageId === lost.pageId
        ? { lost: true }
        : call.pageId === gateway.pageId
          ? { status: 502, body: "<html>bad gateway</html>" }
          : { status: 400, body: { error: { code: 506, message: "dup" } } };

    const pub = await enqueue(
      TENANT_A,
      input([lost.id, gateway.id, duplicate.id])
    );
    const result = await dispatch(TENANT_A);

    expect(result.unknown).toBe(3);

    const rows = await jobsOf(pub.publicationId!);

    expect(byAccount(rows, lost.id)).toMatchObject({
      status: "needs_reconciliation",
      failure_code: "FB_ANSWER_LOST"
    });
    expect(byAccount(rows, gateway.id).failure_code).toBe(
      "FB_UPSTREAM_UNKNOWN"
    );
    expect(byAccount(rows, duplicate.id).failure_code).toBe(
      "FB_DUPLICATE_POST"
    );

    graphCalls.length = 0;
    await dispatch(TENANT_A, { clock: at(600) });

    expect(graphCalls).toHaveLength(0);
  });

  test("a transient Graph outage (code 2) is retried with backoff and then published once", async () => {
    const page = await seedPage(TENANT_A);
    const pub = await enqueue(TENANT_A, input([page.id]));

    graphAnswer = (call, n) =>
      n === 1
        ? { status: 503, body: { error: { code: 2, message: "outage" } } }
        : { status: 200, body: { id: `${call.pageId}_77` } };

    expect((await dispatch(TENANT_A)).retried).toBe(1);
    expect((await dispatch(TENANT_A, { clock: at(300) })).published).toBe(1);
    expect(graphCalls).toHaveLength(2);
    expect((await jobsOf(pub.publicationId!))[0]!.external_post_id).toBe(
      `${page.pageId}_77`
    );
  });

  test("MIME and size are refused at enqueue for Facebook, never downgraded to text; JPEG goes to /photos", async () => {
    const page = await seedPage(TENANT_A);
    const image = (mimeType: string, sizeBytes: number): MediaFacts => ({
      publicUrl: `https://cdn.example/m/${sizeBytes}.${mimeType.split("/")[1]}`,
      altText: "Harbour",
      mimeType,
      sizeBytes,
      creditLine: null,
      copyrightStatus: "owned"
    });
    const webp = await enqueue(
      TENANT_A,
      input([page.id], {
        snapshot: snapshot(image("image/webp", 1000)),
        mediaObjectId: crypto.randomUUID()
      })
    );
    const tooLarge = await enqueue(
      TENANT_A,
      input([page.id], {
        snapshot: snapshot(image("image/png", 5 * 1024 * 1024)),
        mediaObjectId: crypto.randomUUID()
      })
    );

    expect(webp.accounts).toEqual([
      {
        accountId: page.id,
        outcome: "refused",
        reason: "MEDIA_TYPE_UNSUPPORTED"
      }
    ]);
    expect(tooLarge.accounts).toEqual([
      { accountId: page.id, outcome: "refused", reason: "MEDIA_TOO_LARGE" }
    ]);
    expect(webp.jobsCreated + tooLarge.jobsCreated).toBe(0);

    const jpeg = await enqueue(
      TENANT_A,
      input([page.id], {
        snapshot: snapshot(image("image/jpeg", 200_000)),
        mediaObjectId: crypto.randomUUID()
      })
    );

    graphAnswer = (call) => ({
      status: 200,
      body: { id: "55501", post_id: `${call.pageId}_55502` }
    });

    expect((await dispatch(TENANT_A)).published).toBe(1);
    expect(graphCalls[0]!.edge).toBe("photos");
    expect((await jobsOf(jpeg.publicationId!))[0]!.external_post_id).toBe(
      `${page.pageId}_55502`
    );
  });

  test("with the credential path OFF (the default composition) nothing is decrypted and Graph is never called", async () => {
    const page = await seedPage(TENANT_A);

    await enqueue(TENANT_A, input([page.id]));

    const result = await dispatch(TENANT_A, {
      credentials: noPublishCredentialPort
    });

    expect(result.published).toBe(0);
    expect(graphCalls).toHaveLength(0);
  });

  describe("the role's boundary (sql/358 + sql/373)", () => {
    test("as awcms_social_dispatch, only the token of a LIVE, publish-granted Facebook Page of the scoped tenant is readable", async () => {
      const live = await seedPage(TENANT_A);
      const denied = await seedPage(TENANT_A, { capability: "denied" });
      const revoked = await seedPage(TENANT_A);
      const whatsapp = await seedPage(TENANT_A, { provider: "whatsapp_cloud" });
      const otherTenant = await seedPage(TENANT_B);

      await getAdminSql()`
        UPDATE awcms_channel_accounts SET status = 'revoked' WHERE id = ${revoked.id}
      `;

      const visible = await withTenantOrThrow(
        roleSql(),
        TENANT_A,
        async (tx) =>
          (await tx`SELECT id FROM awcms_channel_secrets`) as { id: string }[]
      );

      expect(visible.map((row) => row.id)).toEqual([live.secretId]);

      for (const hidden of [denied, revoked, whatsapp, otherTenant]) {
        expect(visible.map((row) => row.id)).not.toContain(hidden.secretId);
      }

      const resolved = await withTenantOrThrow(roleSql(), TENANT_A, (tx) =>
        credentials.resolvePublishCredential(tx, {
          tenantId: TENANT_A,
          accountId: live.id
        })
      );

      expect(resolved).toEqual({ ok: true, credential: live.token });
    });

    test("it cannot re-queue a failed job, cancel a job, revive a degraded account or degrade a WhatsApp one", async () => {
      const page = await seedPage(TENANT_A);
      const whatsapp = await seedPage(TENANT_A, { provider: "whatsapp_cloud" });
      const pub = await enqueue(TENANT_A, input([page.id]));
      const job = (await jobsOf(pub.publicationId!))[0]!;

      await getAdminSql()`
        UPDATE awcms_social_publish_jobs SET status = 'failed'
        WHERE id = ${job.id}
      `;
      await getAdminSql()`
        UPDATE awcms_channel_accounts SET status = 'degraded' WHERE id = ${page.id}
      `;

      const counts = await withTenantOrThrow(
        roleSql(),
        TENANT_A,
        async (tx) => {
          const requeue = await tx`
          UPDATE awcms_social_publish_jobs SET status = 'queued'
          WHERE id = ${job.id}
        `;
          const revive = await tx`
          UPDATE awcms_channel_accounts SET status = 'connected'
          WHERE id = ${page.id}
        `;
          const degradeWhatsapp = await tx`
          UPDATE awcms_channel_accounts SET status = 'degraded'
          WHERE id = ${whatsapp.id}
        `;

          return {
            requeue: requeue.count,
            revive: revive.count,
            degradeWhatsapp: degradeWhatsapp.count
          };
        }
      );

      expect(counts).toEqual({ requeue: 0, revive: 0, degradeWhatsapp: 0 });
      expect((await jobsOf(pub.publicationId!))[0]!.status).toBe("failed");
    });

    test("readiness pins every write policy and its probe passes on the migrated database", async () => {
      for (const pin of SOCIAL_DISPATCH_WRITE_POLICIES) {
        expect(
          await pinPolicyExpression(getAdminSql(), pin),
          pin.policy
        ).toBeNull();
      }

      expect(await probeSocialDispatchWriteBoundary(getAdminSql())).toEqual({
        ran: true
      });
      expect((await checkWorkerSetupRoleGrants()).status).toBe("pass");
    });

    const MUTATIONS: [string, string, string, string][] = [
      [
        "awcms_social_publish_jobs",
        "awcms_social_publish_jobs_social_dispatch_update",
        "a USING that admits a failed job",
        `CREATE POLICY awcms_social_publish_jobs_social_dispatch_update
           ON awcms_social_publish_jobs AS RESTRICTIVE FOR UPDATE TO awcms_social_dispatch
           USING (status IN ('queued', 'retry_wait', 'publishing', 'failed', 'needs_reconciliation'))
           WITH CHECK (status IN ('queued', 'publishing', 'retry_wait', 'published', 'failed', 'needs_reconciliation'))`
      ],
      [
        "awcms_social_publish_jobs",
        "awcms_social_publish_jobs_social_dispatch_update",
        "a WITH CHECK that admits cancelled (true OR ...)",
        `CREATE POLICY awcms_social_publish_jobs_social_dispatch_update
           ON awcms_social_publish_jobs AS RESTRICTIVE FOR UPDATE TO awcms_social_dispatch
           USING (status IN ('queued', 'retry_wait', 'publishing'))
           WITH CHECK (true OR status IN ('queued'))`
      ],
      [
        "awcms_channel_accounts",
        "awcms_channel_accounts_social_dispatch_degrade",
        "a WITH CHECK that admits connected",
        `CREATE POLICY awcms_channel_accounts_social_dispatch_degrade
           ON awcms_channel_accounts AS RESTRICTIVE FOR UPDATE TO awcms_social_dispatch
           USING (provider IN ('facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin') AND deleted_at IS NULL AND status = 'connected')
           WITH CHECK (provider IN ('facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin') AND deleted_at IS NULL AND status IN ('degraded', 'connected'))`
      ],
      [
        "awcms_channel_accounts",
        "awcms_channel_accounts_social_dispatch_degrade",
        "a dropped provider test",
        `CREATE POLICY awcms_channel_accounts_social_dispatch_degrade
           ON awcms_channel_accounts AS RESTRICTIVE FOR UPDATE TO awcms_social_dispatch
           USING (deleted_at IS NULL AND status = 'connected')
           WITH CHECK (deleted_at IS NULL AND status = 'degraded')`
      ],
      [
        "awcms_audit_events",
        "awcms_audit_events_social_dispatch_insert",
        "any module's audit row",
        `CREATE POLICY awcms_audit_events_social_dispatch_insert
           ON awcms_audit_events AS RESTRICTIVE FOR INSERT TO awcms_social_dispatch
           WITH CHECK (true)`
      ]
    ];

    for (const [table, policy, label, mutated] of MUTATIONS) {
      test(`readiness FAILS with ${label} on ${policy}, and passes once it is restored`, async () => {
        // The same connection `checkWorkerSetupRoleGrants` reads (the harness
        // points DATABASE_URL at the ephemeral database).
        const local = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });
        const original = await Bun.file(
          "sql/373_awcms_social_dispatch_runtime_grants.sql"
        ).text();
        const from = original.indexOf(`CREATE POLICY ${policy}\n`);
        const statement = original.slice(
          from,
          original.indexOf(";\n", from) + 1
        );

        expect(from).toBeGreaterThan(0);

        try {
          await local.unsafe(`DROP POLICY ${policy} ON ${table}`);

          let status: string;

          try {
            await local.unsafe(mutated);
            status = (await checkWorkerSetupRoleGrants()).status;
          } finally {
            await local.unsafe(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
            await local.unsafe(statement);
          }

          expect(status).toBe("fail");
          expect((await checkWorkerSetupRoleGrants()).status).toBe("pass");
        } finally {
          await local.close({ timeout: 1 });
        }
      });
    }
  });
});
