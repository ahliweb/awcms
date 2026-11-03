/**
 * `social_publishing` against a real PostgreSQL (Issue #1145, ADR-0157):
 * enqueue as the least-privilege runtime role, dispatch as `awcms_worker`, FORCE
 * RLS in force, two tenants with several accounts each, and ONE in-memory fake
 * provider adapter (never a real provider).
 *
 * Proves what a mock cannot:
 *
 *   * one publication fans out to ONE JOB PER ACCOUNT, idempotent by a unique
 *     key, with one event, and NO column of any social table can hold a token or
 *     a secret reference;
 *   * cross-tenant forgery: another tenant's account is the same refusal as an
 *     unknown one, and the composite foreign key refuses it at the database;
 *   * token isolation: every account is published with ITS OWN credential for
 *     ITS OWN tenant, and the credential reaches no row, event or audit entry;
 *   * unsupported content is REFUSED per account and never downgraded;
 *   * approval gates dispatch, a creator cannot approve their own publication,
 *     and a schedule defers it;
 *   * partial failure never replays: a published sibling is not sent again when
 *     another account fails or is retried, and `published` is terminal in the
 *     database;
 *   * revocation stops a job (terminal), a degraded account HOLDS it without
 *     consuming an attempt, and nothing is rerouted;
 *   * the fake adapter's HTTP client is `ssrfSafeFetch`: an internal address is
 *     blocked;
 *   * quota and fair share hold under concurrent dispatchers, and every job is
 *     sent exactly once;
 *   * the circuit breaker stops a failing account without touching another;
 *   * the article path (`SocialPublishingPort`) is off unless enabled, never
 *     throws into the publish transaction, and records a refused publication
 *     for unpublishable content;
 *   * RLS, role grants and the database triggers.
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
  resetDatabaseCircuitBreakerForTests,
  resetProviderCircuitBreakersForTests
} from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type { MediaLibraryPort } from "../../src/modules/_shared/ports/media-library-port";
import { createChannelAccountPortAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import {
  createKeyRingSecretStore,
  resetSecretDecryptCounts
} from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import {
  approvePublication,
  cancelPublication,
  fetchPublication,
  listPublications,
  retryJob,
  schedulePublication
} from "../../src/modules/social-publishing/application/publication-directory";
import {
  enqueuePublication,
  type EnqueueInput
} from "../../src/modules/social-publishing/application/publication-enqueue";
import {
  dispatchSocialPublishQueue,
  noPublishCredentialPort
} from "../../src/modules/social-publishing/application/social-publish-dispatch";
import { createSocialPublishingPortAdapter } from "../../src/modules/social-publishing/application/social-publishing-port-adapter";
import {
  upsertRule,
  updateSettings
} from "../../src/modules/social-publishing/application/settings-directory";
import {
  buildContentSnapshot,
  type MediaFacts
} from "../../src/modules/social-publishing/domain/social-publish-content";
import { socialPublishBreakerKey } from "../../src/modules/social-publishing/domain/social-publishing-constants";
import { createSocialAdapterRegistry } from "../../src/modules/social-publishing/infrastructure/social-adapter-registry";
import {
  FULL_CAPABILITIES,
  TEXT_ONLY_CAPABILITIES,
  createFakeSocialAdapter
} from "../support/fake-social-publish-adapter";

const TENANT_A = "a1145000-0000-4000-8000-00000000000a";
const TENANT_B = "a1145000-0000-4000-8000-00000000000b";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 3) % 251)
  ).toString("base64");
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${bytes(11)}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);
const ENV = {
  SOCIAL_PUBLISHING_ENABLED: "true",
  CHANNEL_ACCOUNTS_ENABLED: "true",
  APP_URL: "https://cms.example"
} as unknown as NodeJS.ProcessEnv;
const publishers = createChannelAccountPortAdapter({ env: ENV });
const credentials = createChannelSenderCredentialAdapter({ store, env: ENV });

const runtime = () => getRuntimeSql();
const worker = () => (workerRoleActivated ? getWorkerRoleSql() : runtime());
const inTenant = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(runtime(), tenantId, fn);
/**
 * A dispatch clock `minutes` from now, fixed when it is built. One second is
 * added so the instant is always later than the `now()` the database stamped on
 * a job created a moment ago (a clock earlier than that would claim nothing).
 */
const at = (minutes: number) => {
  const instant = new Date(Date.now() + minutes * 60_000 + 1000);

  return () => instant;
};

const PROVIDER_SHAPE: Record<string, { kind: string }> = {
  facebook: { kind: "page" },
  instagram: { kind: "professional_account" },
  threads: { kind: "profile" },
  linkedin: { kind: "organization_page" }
};

let externalSeq = 5_000_000;

type Seed = {
  provider?: string;
  status?: string;
  grantState?: string;
  capabilities?: string[];
  scope?: { type: string; id: string } | null;
};

type Seeded = {
  id: string;
  tenantId: string;
  provider: string;
  externalId: string;
  token: string;
  connectionId: string;
  secretId: string;
};

/** A tenant-owned publishing account: an OAuth connection with a real stored token, the account, its capability evidence. */
async function seedAccount(tenantId: string, seed: Seed = {}): Promise<Seeded> {
  const admin = getAdminSql();
  const provider = seed.provider ?? "facebook";
  const kind = PROVIDER_SHAPE[provider]!.kind;
  const externalId = String((externalSeq += 1));
  const token = `TOKEN-${provider}-${externalId}-${tenantId.slice(-1)}`;
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
    VALUES (${tenantId}, ${provider}, 'oauth2', ${seed.grantState ?? "active"},
            ${access.secretId})
    RETURNING id
  `) as { id: string }[];
  const account = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider,
       account_kind, external_id, display_name, auth_mode, status,
       connection_id)
    VALUES (${tenantId}, ${seed.scope?.type ?? null}, ${seed.scope?.id ?? null},
            ${provider}, ${kind}, ${externalId}, ${`n-${externalId}`}, 'oauth2',
            ${seed.status ?? "connected"}, ${connection[0]!.id})
    RETURNING id
  `) as { id: string }[];

  for (const capability of seed.capabilities ?? ["publish"]) {
    await admin`
      INSERT INTO awcms_channel_account_capabilities
        (tenant_id, account_id, capability, state, evidence_kind,
         evidence_ref, matrix_version, verified_at)
      VALUES (${tenantId}, ${account[0]!.id}, ${capability}, 'granted',
              'app_review_reference', 'evidence-1', ${PROVIDER_MATRIX_VERSION},
              now())
    `;
  }

  return {
    id: account[0]!.id,
    tenantId,
    provider,
    externalId,
    token,
    connectionId: connection[0]!.id,
    secretId: access.secretId
  };
}

async function seedTenantUser(tenantId: string, tag: string): Promise<string> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const user = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  return user[0]!.id;
}

const fb = createFakeSocialAdapter("facebook");
const ig = createFakeSocialAdapter("instagram", {
  ...FULL_CAPABILITIES,
  imageMimeTypes: ["image/jpeg"]
});
const th = createFakeSocialAdapter("threads", TEXT_ONLY_CAPABILITIES);
const li = createFakeSocialAdapter("linkedin");
const registry = createSocialAdapterRegistry([fb, ig, th, li]);
const deps = { publishers, registry };

function resetFakes() {
  for (const adapter of [fb, ig, th, li]) {
    adapter.calls.length = 0;
    adapter.setBehavior((request) => ({
      outcome: "published",
      externalPostId: `post-${request.provider}-${request.accountId.slice(0, 8)}`,
      externalPostUrl: `https://${request.provider}.example/p/${request.accountId.slice(0, 8)}`
    }));
  }
}

const IMAGE: MediaFacts = {
  publicUrl: "https://cdn.example/m/1.jpg",
  altText: "A photo",
  mimeType: "image/jpeg",
  sizeBytes: 1_000_000,
  creditLine: "Studio",
  copyrightStatus: "owned"
};

function snapshot(
  over: Partial<{
    title: string;
    caption: string;
    linkUrl: string | null;
    media: MediaFacts | null;
  }> = {}
) {
  const built = buildContentSnapshot({
    title: "Headline",
    caption: "A caption for the world.",
    linkUrl: "https://cms.example/blog/a/headline",
    media: null,
    ...over
  });

  if (!built.ok) throw new Error(`fixture: ${built.code}`);

  return built.snapshot;
}

function enqueueInput(
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
    correlationId: "corr-1145",
    ...over
  };
}

const enqueue = (tenantId: string, input: EnqueueInput) =>
  inTenant(tenantId, (tx) => enqueuePublication(tx, tenantId, input, deps));

function dispatch(
  tenantId: string,
  over: Partial<Parameters<typeof dispatchSocialPublishQueue>[2]> = {}
) {
  // As the runtime role, NOT `awcms_worker` (the #1145 audit, H1): the worker
  // role cannot read a social token (see the "hardening" tests), so the dispatch
  // that decrypts one is exercised as the role that can, standing in for the
  // dedicated DB role the first connector brings (ADR-0157 section 6).
  return dispatchSocialPublishQueue(runtime(), tenantId, {
    publishers,
    credentials,
    registry,
    env: ENV,
    clock: at(0),
    ...over
  });
}

async function jobs(publicationId: string) {
  return (await getAdminSql()`
    SELECT id, channel_account_id, status, attempt_count, hold_count,
           failure_code, last_error, external_post_id, max_attempts,
           next_attempt_at
    FROM awcms_social_publish_jobs WHERE publication_id = ${publicationId}
    ORDER BY created_at, id
  `) as {
    id: string;
    channel_account_id: string;
    status: string;
    attempt_count: number;
    hold_count: number;
    failure_code: string | null;
    last_error: string | null;
    external_post_id: string | null;
    max_attempts: number;
    next_attempt_at: Date;
  }[];
}

async function seedTenants(): Promise<void> {
  const admin = getAdminSql();

  for (const [id, code] of [
    [TENANT_A, "sp1145-a"],
    [TENANT_B, "sp1145-b"]
  ] as const) {
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }
}

async function expectDbRefusal(
  promise: Promise<unknown>,
  what: string,
  errno: string
): Promise<void> {
  let error: Error & { errno?: unknown };

  try {
    error = (await assertRejected(promise, what)) as typeof error;
  } finally {
    resetDatabaseCircuitBreakerForTests();
  }

  expect(String(error.errno), `${what}: ${error.message}`).toBe(errno);
}

const suite = integrationEnabled ? describe : describe.skip;

suite("social_publishing against PostgreSQL", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetProviderCircuitBreakersForTests();
    resetSecretDecryptCounts();
    resetFakes();
    await seedTenants();
  });

  test("the worker role is in force and the five tables are FORCE RLS", async () => {
    expect(workerRoleActivated).toBe(true);

    const rows = (await getAdminSql()`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN (
        'awcms_social_publishing_settings', 'awcms_social_publish_rules',
        'awcms_social_publications', 'awcms_social_publish_jobs',
        'awcms_social_publish_attempts')
    `) as {
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }[];

    expect(rows).toHaveLength(5);

    for (const row of rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
  });

  test("no column of any social table can hold a token, a secret or a credential", async () => {
    const rows = (await getAdminSql()`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name LIKE 'awcms_social_%'
        AND column_name ~* '(token|secret|credential|password|api_?key|bearer|ciphertext)'
    `) as unknown[];

    expect(rows).toEqual([]);
  });

  describe("fan-out: one publication, one job per account", () => {
    test("N accounts of two tenants: one job each, one event, idempotent on repeat", async () => {
      const a = [
        await seedAccount(TENANT_A, { provider: "facebook" }),
        await seedAccount(TENANT_A, { provider: "instagram" }),
        await seedAccount(TENANT_A, { provider: "linkedin" })
      ];
      const b = [
        await seedAccount(TENANT_B, { provider: "facebook" }),
        await seedAccount(TENANT_B, { provider: "threads" }),
        await seedAccount(TENANT_B, { provider: "linkedin" })
      ];
      const first = await enqueue(
        TENANT_A,
        enqueueInput(a.map((account) => account.id))
      );

      expect(first.jobsCreated).toBe(3);
      expect(first.accounts.map((account) => account.outcome)).toEqual([
        "queued",
        "queued",
        "queued"
      ]);

      const events = (await getAdminSql()`
        SELECT event_type, payload FROM awcms_domain_events
        WHERE tenant_id = ${TENANT_A}
          AND event_type = 'awcms.social_publishing.publication.queued'
      `) as { payload: { jobCount: number; accountIds: string[] } }[];

      expect(events).toHaveLength(1);
      expect(events[0]!.payload.jobCount).toBe(3);
      expect([...events[0]!.payload.accountIds].sort()).toEqual(
        a.map((account) => account.id).sort()
      );

      // The tenant B accounts are a separate publication with their own jobs.
      const second = await enqueue(
        TENANT_B,
        enqueueInput(
          b.map((account) => account.id),
          {
            snapshot: snapshot({ caption: "Short." })
          }
        )
      );

      expect(second.jobsCreated).toBe(3);

      const all = (await getAdminSql()`
        SELECT tenant_id, count(*)::int AS total
        FROM awcms_social_publish_jobs GROUP BY tenant_id ORDER BY tenant_id
      `) as { tenant_id: string; total: number }[];

      expect(all).toEqual([
        { tenant_id: TENANT_A, total: 3 },
        { tenant_id: TENANT_B, total: 3 }
      ]);
    });

    test("an article event is idempotent per (article, trigger, account) and adds only a newly eligible account", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const y = await seedAccount(TENANT_A, { provider: "linkedin" });
      const articleId = crypto.randomUUID();
      const input = (accountIds: string[]) =>
        enqueueInput(accountIds, {
          source: {
            kind: "article",
            articleId,
            trigger: "post_published"
          }
        });
      const one = await enqueue(TENANT_A, input([x.id]));
      const again = await enqueue(TENANT_A, input([x.id]));
      const grown = await enqueue(TENANT_A, input([x.id, y.id]));

      expect(one.jobsCreated).toBe(1);
      expect(again.jobsCreated).toBe(0);
      expect(again.accounts[0]!.outcome).toBe("existing");
      expect(grown.jobsCreated).toBe(1);
      expect(grown.publicationId).toBe(one.publicationId);

      const total = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_social_publications
        WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];

      expect(total[0]!.n).toBe(1);
    });

    test("concurrent identical article events create one publication and one job", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const articleId = crypto.randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          enqueue(
            TENANT_A,
            enqueueInput([x.id], {
              source: {
                kind: "article",
                articleId,
                trigger: "post_published"
              }
            })
          )
        )
      );

      expect(results.reduce((sum, r) => sum + r.jobsCreated, 0)).toBe(1);

      const rows = (await getAdminSql()`
        SELECT
          (SELECT count(*)::int FROM awcms_social_publications) AS publications,
          (SELECT count(*)::int FROM awcms_social_publish_jobs) AS jobs
      `) as { publications: number; jobs: number }[];

      expect(rows[0]).toEqual({ publications: 1, jobs: 1 });
    });
  });

  describe("fail closed at enqueue", () => {
    test("another tenant's account, an unknown id and a revoked account are refused; the composite foreign key refuses it at the database", async () => {
      const own = await seedAccount(TENANT_A, { provider: "facebook" });
      const foreign = await seedAccount(TENANT_B, { provider: "facebook" });
      const revoked = await seedAccount(TENANT_A, {
        provider: "linkedin",
        status: "revoked"
      });
      const unapproved = await seedAccount(TENANT_A, {
        provider: "instagram",
        capabilities: []
      });
      const result = await enqueue(
        TENANT_A,
        enqueueInput([
          own.id,
          foreign.id,
          crypto.randomUUID(),
          revoked.id,
          unapproved.id
        ])
      );
      const byAccount = new Map(
        result.accounts.map((account) => [account.accountId, account])
      );

      expect(result.jobsCreated).toBe(1);
      expect(byAccount.get(foreign.id)).toMatchObject({
        outcome: "refused",
        reason: "ACCOUNT_NOT_FOUND"
      });
      expect(byAccount.get(revoked.id)).toMatchObject({
        outcome: "refused",
        reason: "ACCOUNT_REVOKED"
      });
      expect(byAccount.get(unapproved.id)).toMatchObject({
        outcome: "refused",
        reason: "CAPABILITY_DENIED"
      });

      const unknownRefusals = result.accounts.filter(
        (account) =>
          account.outcome === "refused" &&
          account.reason === "ACCOUNT_NOT_FOUND"
      );

      // Another tenant's id and a random id are ONE answer.
      expect(unknownRefusals).toHaveLength(2);

      // And at the database: a job in tenant A naming tenant B's account.
      await expectDbRefusal(
        getAdminSql()`
          INSERT INTO awcms_social_publish_jobs
            (tenant_id, publication_id, channel_account_id, provider,
             account_kind, variant, idempotency_key)
          VALUES (${TENANT_A}, ${result.publicationId}, ${foreign.id},
                  'facebook', 'page', 'text', ${"a".repeat(64)})
        `,
        "a cross-tenant account on a job",
        "23514"
      );
    });

    test("a provider with no adapter cannot publish", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await inTenant(TENANT_A, (tx) =>
        enqueuePublication(tx, TENANT_A, enqueueInput([account.id]), {
          publishers,
          registry: createSocialAdapterRegistry([])
        })
      );

      expect(result.jobsCreated).toBe(0);
      expect(result.publicationId).toBeNull();
      expect(result.accounts[0]).toMatchObject({
        outcome: "refused",
        reason: "PROVIDER_ADAPTER_UNAVAILABLE"
      });
    });

    test("an unavailable channel module refuses every account", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await inTenant(TENANT_A, (tx) =>
        enqueuePublication(tx, TENANT_A, enqueueInput([account.id]), {
          publishers: null,
          registry
        })
      );

      expect(result.jobsCreated).toBe(0);
      expect(result.accounts[0]).toMatchObject({
        reason: "PUBLISHERS_UNAVAILABLE"
      });
    });

    test("unsupported content is REFUSED per account and never downgraded", async () => {
      const facebook = await seedAccount(TENANT_A, { provider: "facebook" });
      const threads = await seedAccount(TENANT_A, { provider: "threads" });
      const instagram = await seedAccount(TENANT_A, { provider: "instagram" });
      const result = await enqueue(
        TENANT_A,
        enqueueInput([facebook.id, threads.id, instagram.id], {
          snapshot: snapshot({
            media: { ...IMAGE, mimeType: "image/png" }
          }),
          mediaObjectId: crypto.randomUUID()
        })
      );
      const byAccount = new Map(
        result.accounts.map((account) => [account.accountId, account])
      );

      expect(byAccount.get(facebook.id)!.outcome).toBe("queued");
      // Text-only provider: the image is refused, NOT posted as text.
      expect(byAccount.get(threads.id)).toMatchObject({
        outcome: "refused",
        reason: "VARIANT_UNSUPPORTED"
      });
      // jpeg-only provider.
      expect(byAccount.get(instagram.id)).toMatchObject({
        outcome: "refused",
        reason: "MEDIA_TYPE_UNSUPPORTED"
      });

      const rows = await jobs(result.publicationId!);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.channel_account_id).toBe(facebook.id);
    });

    test("content too long for a provider is refused, not truncated", async () => {
      const threads = await seedAccount(TENANT_A, { provider: "threads" });
      const result = await enqueue(
        TENANT_A,
        enqueueInput([threads.id], {
          snapshot: snapshot({ caption: "x".repeat(400) })
        })
      );

      expect(result.accounts[0]).toMatchObject({
        outcome: "refused",
        reason: "CONTENT_TOO_LONG"
      });
    });
  });

  describe("approval and scheduling", () => {
    test("nothing is claimable before approval; a creator cannot approve their own; another person can", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const maker = await seedTenantUser(TENANT_A, "maker");
      const checker = await seedTenantUser(TENANT_A, "checker");
      const result = await enqueue(
        TENANT_A,
        enqueueInput([account.id], {
          approvalRequired: true,
          actorTenantUserId: maker
        })
      );

      expect(result.state).toBe("pending_approval");
      expect((await dispatch(TENANT_A)).claimed).toBe(0);
      expect(fb.calls).toHaveLength(0);

      const self = await inTenant(TENANT_A, (tx) =>
        approvePublication(tx, TENANT_A, maker, result.publicationId!)
      );

      expect(self).toEqual({
        outcome: "refused",
        code: "SELF_APPROVAL_FORBIDDEN"
      });

      const approved = await inTenant(TENANT_A, (tx) =>
        approvePublication(tx, TENANT_A, checker, result.publicationId!)
      );

      expect(approved).toMatchObject({ outcome: "ok", alreadyApproved: false });

      // Idempotent.
      expect(
        await inTenant(TENANT_A, (tx) =>
          approvePublication(tx, TENANT_A, checker, result.publicationId!)
        )
      ).toMatchObject({ outcome: "ok", alreadyApproved: true });

      const run = await dispatch(TENANT_A);

      expect(run).toMatchObject({ claimed: 1, published: 1 });
      expect(fb.calls).toHaveLength(1);
    });

    test("a cancelled publication is never claimed and a cancelled approval cannot be revived", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const user = await seedTenantUser(TENANT_A, "canceller");
      const result = await enqueue(
        TENANT_A,
        enqueueInput([account.id], { approvalRequired: true })
      );
      const cancelled = await inTenant(TENANT_A, (tx) =>
        cancelPublication(tx, TENANT_A, user, result.publicationId!, "no")
      );

      expect(cancelled).toMatchObject({
        outcome: "ok",
        jobsCancelled: 1,
        jobsAlreadyPublished: 0
      });
      expect(
        await inTenant(TENANT_A, (tx) =>
          approvePublication(tx, TENANT_A, user, result.publicationId!)
        )
      ).toEqual({ outcome: "refused", code: "PUBLICATION_STATE_INVALID" });
      expect((await dispatch(TENANT_A)).claimed).toBe(0);
    });

    test("a schedule defers dispatch until its instant, and can move only before anything was dispatched", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const when = new Date(Date.now() + 60 * 60_000);
      const result = await enqueue(
        TENANT_A,
        enqueueInput([account.id], { notBefore: when })
      );

      expect((await dispatch(TENANT_A, { clock: at(30) })).claimed).toBe(0);
      expect((await dispatch(TENANT_A, { clock: at(61) })).published).toBe(1);

      expect(
        await inTenant(TENANT_A, (tx) =>
          schedulePublication(tx, TENANT_A, result.publicationId!, null)
        )
      ).toEqual({ outcome: "refused", code: "ALREADY_DISPATCHED" });
    });
  });

  describe("dispatch: tokens, isolation and the SSRF-safe client", () => {
    test("every account is published with ITS OWN credential for ITS OWN tenant, and the credential reaches no row", async () => {
      const a = [
        await seedAccount(TENANT_A, { provider: "facebook" }),
        await seedAccount(TENANT_A, { provider: "linkedin" }),
        await seedAccount(TENANT_A, { provider: "instagram" })
      ];
      const b = [
        await seedAccount(TENANT_B, { provider: "facebook" }),
        await seedAccount(TENANT_B, { provider: "linkedin" }),
        await seedAccount(TENANT_B, { provider: "instagram" })
      ];

      await enqueue(TENANT_A, enqueueInput(a.map((account) => account.id)));
      await enqueue(TENANT_B, enqueueInput(b.map((account) => account.id)));

      const runA = await dispatch(TENANT_A);
      const runB = await dispatch(TENANT_B);

      expect(runA.published).toBe(3);
      expect(runB.published).toBe(3);

      const everyCall = [...fb.calls, ...li.calls, ...ig.calls];

      expect(everyCall).toHaveLength(6);

      for (const account of [...a, ...b]) {
        const call = everyCall.find((c) => c.accountId === account.id)!;

        expect(call.tenantId).toBe(account.tenantId);
        expect(call.credential).toBe(account.token);
        expect(call.externalId).toBe(account.externalId);
        expect(call.hasHttp).toBe(true);
      }

      const persisted = (await getAdminSql()`
        SELECT to_jsonb(t)::text AS row FROM awcms_social_publish_jobs t
        UNION ALL SELECT to_jsonb(t)::text FROM awcms_social_publications t
        UNION ALL SELECT to_jsonb(t)::text FROM awcms_social_publish_attempts t
        UNION ALL SELECT to_jsonb(t)::text FROM awcms_audit_events t
        UNION ALL SELECT to_jsonb(t)::text FROM awcms_domain_events t
        UNION ALL SELECT to_jsonb(t)::text FROM awcms_idempotency_keys t
      `) as { row: string }[];
      const text = persisted.map((entry) => entry.row).join("\n");

      for (const account of [...a, ...b]) {
        expect(text).not.toContain(account.token);
      }
    });

    test("the adapter's HTTP client is ssrfSafeFetch: an internal address is blocked", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      let blocked: unknown = null;

      fb.setBehavior(async (request) => {
        blocked = await request.http("http://127.0.0.1:9/internal");

        return {
          outcome: "published",
          externalPostId: "ok",
          externalPostUrl: "https://facebook.example/p/1"
        };
      });
      await enqueue(TENANT_A, enqueueInput([account.id]));
      await dispatch(TENANT_A);

      expect(blocked).toMatchObject({ ok: false });
    });

    test("a thrown adapter error is an UNKNOWN outcome for a provider that does not dedupe, and its message is never stored", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });

      fb.setBehavior(() => {
        throw new Error(`boom ${account.token}`);
      });

      const result = await enqueue(TENANT_A, enqueueInput([account.id]));
      const run = await dispatch(TENANT_A);

      expect(run.unknown).toBe(1);

      const [job] = await jobs(result.publicationId!);

      expect(job).toMatchObject({
        status: "needs_reconciliation",
        failure_code: "ADAPTER_ERROR"
      });
      expect(JSON.stringify(job)).not.toContain(account.token);
    });
  });

  describe("the independent audit of #1240", () => {
    const slow =
      (ms: number, outcome: "published" = "published") =>
      async () => {
        await Bun.sleep(ms);

        return {
          outcome,
          externalPostId: "slow-post",
          externalPostUrl: "https://facebook.example/p/slow"
        } as const;
      };
    const only = (adapter: ReturnType<typeof createFakeSocialAdapter>) =>
      createSocialAdapterRegistry([adapter]);

    test("H1: the worker role cannot see a social token, and the dispatch script's credential port refuses everything", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const visible = await withTenantOrThrow(
        worker(),
        TENANT_A,
        (tx) =>
          tx`SELECT id FROM awcms_channel_secrets WHERE id = ${account.secretId}`
      );

      // The restrictive policy of sql/328 hides it; this module widens nothing.
      expect(visible).toHaveLength(0);

      const result = await enqueue(TENANT_A, enqueueInput([account.id]));
      const run = await dispatchSocialPublishQueue(worker(), TENANT_A, {
        publishers,
        credentials: noPublishCredentialPort,
        registry: createSocialAdapterRegistry([]),
        env: ENV,
        clock: at(0)
      });
      const [job] = await jobs(result.publicationId!);

      // No adapter: the job fails closed before any credential is asked for.
      expect(run.failed).toBe(1);
      expect(job).toMatchObject({
        status: "failed",
        failure_code: "PROVIDER_ADAPTER_UNAVAILABLE"
      });
      expect(fb.calls).toHaveLength(0);
    });

    test("H1: even WITH an adapter, the worker-role dispatcher with the refusing port publishes nothing", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([account.id]));

      await dispatchSocialPublishQueue(worker(), TENANT_A, {
        publishers,
        credentials: noPublishCredentialPort,
        registry,
        env: ENV,
        clock: at(0)
      });

      const [job] = await jobs(result.publicationId!);

      expect(job!.status).toBe("failed");
      expect(job!.failure_code).toBe("ACCOUNT_CREDENTIAL_UNAVAILABLE");
      expect(fb.calls).toHaveLength(0);
    });

    test("M1 (the auditor's PoC): a provider that finishes AFTER the timeout still yields exactly ONE post, and the job waits for an operator", async () => {
      const slowFb = createFakeSocialAdapter(
        "facebook",
        FULL_CAPABILITIES,
        slow(300)
      );
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([account.id]));
      const options = {
        registry: only(slowFb),
        providerTimeoutMs: 100
      };

      const first = await dispatch(TENANT_A, options);

      // The request finished AFTER the dispatcher gave up waiting.
      await Bun.sleep(400);

      const [job] = await jobs(result.publicationId!);

      expect(first.unknown).toBe(1);
      expect(job).toMatchObject({
        status: "needs_reconciliation",
        failure_code: "PROVIDER_TIMEOUT",
        attempt_count: 1
      });

      // Never retried automatically, however long the dispatcher keeps running.
      for (const minutes of [30, 600, 5000]) {
        expect(
          (await dispatch(TENANT_A, { ...options, clock: at(minutes) })).claimed
        ).toBe(0);
      }

      expect(slowFb.calls).toHaveLength(1);
      expect(slowFb.providerPosts).toHaveLength(1);

      // The aggregate says so.
      const detail = await inTenant(TENANT_A, (tx) =>
        fetchPublication(tx, TENANT_A, result.publicationId!)
      );

      expect(detail!.publication.status).toBe("needs_reconciliation");

      // An operator must confirm that the post may already exist.
      expect(
        await inTenant(TENANT_A, (tx) => retryJob(tx, TENANT_A, job!.id))
      ).toEqual({
        outcome: "refused",
        code: "RECONCILIATION_CONFIRMATION_REQUIRED"
      });
      expect(
        await inTenant(TENANT_A, (tx) =>
          retryJob(tx, TENANT_A, job!.id, { confirmPossiblyPublished: true })
        )
      ).toMatchObject({ outcome: "ok" });

      slowFb.setBehavior(() => ({
        outcome: "published",
        externalPostId: "again",
        externalPostUrl: "https://facebook.example/p/again"
      }));
      await dispatch(TENANT_A, { ...options, clock: at(40) });

      // Only now, by the operator's decision, is a second post possible.
      expect(slowFb.providerPosts).toHaveLength(2);
    });

    test("M1: the timeout CANCELS the request (the call's signal fires), it does not abandon it", async () => {
      let aborted = false;
      const watching = createFakeSocialAdapter(
        "facebook",
        FULL_CAPABILITIES,
        async (request) => {
          await new Promise<void>((resolve) =>
            request.signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            })
          );

          return { outcome: "retryable", errorCode: "UPSTREAM_5XX" };
        }
      );
      const account = await seedAccount(TENANT_A, { provider: "facebook" });

      await enqueue(TENANT_A, enqueueInput([account.id]));
      await dispatch(TENANT_A, {
        registry: only(watching),
        providerTimeoutMs: 100
      });

      expect(aborted).toBe(true);
    });

    test("M1: a provider that DEDUPES on the idempotency key is retried automatically with the same key, and L5: the timeout stays distinguishable", async () => {
      const dedupingFb = createFakeSocialAdapter(
        "facebook",
        FULL_CAPABILITIES,
        slow(300),
        { supportsIdempotencyKey: true }
      );
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([account.id]));
      const options = { registry: only(dedupingFb), providerTimeoutMs: 100 };

      const first = await dispatch(TENANT_A, options);

      await Bun.sleep(400);

      const [waiting] = await jobs(result.publicationId!);
      const ledger = (await getAdminSql()`
        SELECT outcome, error_code FROM awcms_social_publish_attempts
        WHERE job_id = ${waiting!.id}
      `) as { outcome: string; error_code: string }[];

      expect(first.retried).toBe(1);
      // L5: the dispatcher's own code is NOT rewritten into the generic one.
      expect(waiting).toMatchObject({
        status: "retry_wait",
        failure_code: "PROVIDER_TIMEOUT"
      });
      expect(ledger).toEqual([
        { outcome: "retryable", error_code: "PROVIDER_TIMEOUT" }
      ]);

      dedupingFb.setBehavior(() => ({
        outcome: "published",
        externalPostId: "same",
        externalPostUrl: "https://facebook.example/p/same"
      }));
      await dispatch(TENANT_A, { ...options, clock: at(60) });

      // Two requests, the SAME key, ONE post on the provider.
      expect(dedupingFb.calls).toHaveLength(2);
      expect(dedupingFb.calls[0]!.idempotencyKey).toBe(
        dedupingFb.calls[1]!.idempotencyKey
      );
      expect(dedupingFb.providerPosts).toHaveLength(1);

      const [done] = await jobs(result.publicationId!);

      expect(done!.status).toBe("published");
    });

    test("M1: an adapter's own `unknown` outcome follows the same rule", async () => {
      const unsure = createFakeSocialAdapter(
        "facebook",
        FULL_CAPABILITIES,
        () => ({
          outcome: "unknown",
          errorCode: "UPSTREAM_5XX"
        })
      );
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([account.id]));

      await dispatch(TENANT_A, { registry: only(unsure) });

      const [job] = await jobs(result.publicationId!);

      expect(job).toMatchObject({
        status: "needs_reconciliation",
        failure_code: "UPSTREAM_5XX"
      });
    });

    test("M1: an unknown outcome leaves only to an operator or a cancel (database trigger), and cancel stops it", async () => {
      const unsure = createFakeSocialAdapter(
        "facebook",
        FULL_CAPABILITIES,
        () => ({
          outcome: "unknown",
          errorCode: "UPSTREAM_5XX"
        })
      );
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([account.id]));

      await dispatch(TENANT_A, { registry: only(unsure) });

      const [job] = await jobs(result.publicationId!);

      for (const status of [
        "publishing",
        "published",
        "failed",
        "retry_wait"
      ]) {
        await expectDbRefusal(
          getAdminSql().unsafe(
            `UPDATE awcms_social_publish_jobs SET status = '${status}' ${status === "published" ? ", external_post_id = 'x', published_at = now()" : ""} WHERE id = '${job!.id}'`
          ),
          `an unknown job moving to ${status}`,
          "23514"
        );
      }

      const user = await seedTenantUser(TENANT_A, "reconciler");
      const cancelled = await inTenant(TENANT_A, (tx) =>
        cancelPublication(tx, TENANT_A, user, result.publicationId!, null)
      );

      expect(cancelled).toMatchObject({ outcome: "ok", jobsCancelled: 1 });
    });

    test("M4: a tenant that switched the module OFF is not enqueued for and not dispatched", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const user = await seedTenantUser(TENANT_A, "gate");
      const queued = await enqueue(TENANT_A, enqueueInput([account.id]));

      await inTenant(TENANT_A, async (tx) => {
        await updateSettings(tx, TENANT_A, user, {
          autoPublishEnabled: true,
          approvalRequired: false
        });
        await upsertRule(tx, TENANT_A, user, "post_published", account.id);
      });
      await getAdminSql()`
        INSERT INTO awcms_modules (module_key, module_name)
        VALUES ('social_publishing', 'Social Publishing')
        ON CONFLICT (module_key) DO NOTHING
      `;
      await getAdminSql()`
        INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
        VALUES (${TENANT_A}, 'social_publishing', false)
      `;

      // Article path: nothing is enqueued.
      const article = await inTenant(TENANT_A, (tx) =>
        createSocialPublishingPortAdapter({
          mediaPort: {
            isManagedMediaEnforcementActiveForTenant: async () => false,
            isMediaReferenceSafe: async () => true,
            resolveMediaReferences: async () => new Map()
          },
          registry,
          env: ENV,
          loadPublishers: async () => publishers
        }).onArticlePublished(tx, TENANT_A, {
          articleId: crypto.randomUUID(),
          title: "T",
          slug: "t",
          excerpt: null,
          featuredMediaId: null,
          trigger: "post_published"
        })
      );

      expect(article).toEqual({ jobsCreated: 0 });

      // Dispatch: a job queued earlier is left alone.
      const run = await dispatch(TENANT_A);

      expect(run.claimed).toBe(0);
      expect(fb.calls).toHaveLength(0);

      const counts = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_social_publications
      `) as { n: number }[];

      expect(counts[0]!.n).toBe(1);

      // Switched back on, the same queued job goes out.
      await getAdminSql()`
        UPDATE awcms_tenant_modules SET enabled = true
        WHERE tenant_id = ${TENANT_A} AND module_key = 'social_publishing'
      `;
      expect((await dispatch(TENANT_A)).published).toBe(1);
      expect(queued.publicationId).not.toBeNull();
    });

    test("L2: the database refuses an approval-requiring publication that is ready without an approver, and a self-approved manual one", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const maker = await seedTenantUser(TENANT_A, "maker-l2");
      const result = await enqueue(
        TENANT_A,
        enqueueInput([account.id], {
          approvalRequired: true,
          actorTenantUserId: maker
        })
      );

      await expectDbRefusal(
        getAdminSql()`UPDATE awcms_social_publications SET state = 'ready' WHERE id = ${result.publicationId}`,
        "ready with no approver",
        "23514"
      );
      await expectDbRefusal(
        getAdminSql()`
          UPDATE awcms_social_publications
          SET state = 'ready', approved_by = ${maker}, approved_at = now()
          WHERE id = ${result.publicationId}
        `,
        "a manual publication approved by its creator",
        "23514"
      );

      const checker = await seedTenantUser(TENANT_A, "checker-l2");

      await getAdminSql()`
        UPDATE awcms_social_publications
        SET state = 'ready', approved_by = ${checker}, approved_at = now()
        WHERE id = ${result.publicationId}
      `;
    });

    test("L3: an approved publication cannot gain a target, in the application and in the database", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const y = await seedAccount(TENANT_A, { provider: "linkedin" });
      const checker = await seedTenantUser(TENANT_A, "checker-l3");
      const articleId = crypto.randomUUID();
      const input = (accountIds: string[]) =>
        enqueueInput(accountIds, {
          approvalRequired: true,
          source: { kind: "article", articleId, trigger: "post_published" }
        });
      const first = await enqueue(TENANT_A, input([x.id]));

      // Before approval a target may still be added (the approval will cover it).
      expect((await enqueue(TENANT_A, input([x.id]))).jobsCreated).toBe(0);

      await inTenant(TENANT_A, (tx) =>
        approvePublication(tx, TENANT_A, checker, first.publicationId!)
      );

      const grown = await enqueue(TENANT_A, input([x.id, y.id]));

      expect(grown.jobsCreated).toBe(0);
      expect(grown.accounts).toContainEqual(
        expect.objectContaining({
          accountId: y.id,
          outcome: "refused",
          reason: "NEW_TARGET_NEEDS_APPROVAL"
        })
      );

      await expectDbRefusal(
        getAdminSql()`
          INSERT INTO awcms_social_publish_jobs
            (tenant_id, publication_id, channel_account_id, provider,
             account_kind, variant, idempotency_key)
          VALUES (${TENANT_A}, ${first.publicationId}, ${y.id}, 'linkedin',
                  'organization_page', 'text', ${"d".repeat(64)})
        `,
        "a job added to an approved publication",
        "23514"
      );
    });

    test("L3: a publication that needed no approval can still gain a target", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const y = await seedAccount(TENANT_A, { provider: "linkedin" });
      const articleId = crypto.randomUUID();
      const input = (accountIds: string[]) =>
        enqueueInput(accountIds, {
          source: { kind: "article", articleId, trigger: "post_published" }
        });

      await enqueue(TENANT_A, input([x.id]));

      expect((await enqueue(TENANT_A, input([x.id, y.id]))).jobsCreated).toBe(
        1
      );
    });

    test("L7: a manual retry never 500s on the attempt ceiling: it is clamped, then refused", async () => {
      const account = await seedAccount(TENANT_A, { provider: "linkedin" });
      const result = await enqueue(TENANT_A, enqueueInput([account.id]));
      const [job] = await jobs(result.publicationId!);

      await getAdminSql()`
        UPDATE awcms_social_publish_jobs
        SET status = 'failed', attempt_count = 49, failure_code = 'REJECTED'
        WHERE id = ${job!.id}
      `;

      expect(
        await inTenant(TENANT_A, (tx) => retryJob(tx, TENANT_A, job!.id))
      ).toMatchObject({ outcome: "ok" });
      expect((await jobs(result.publicationId!))[0]!.max_attempts).toBe(50);

      await getAdminSql()`
        UPDATE awcms_social_publish_jobs
        SET status = 'failed', attempt_count = 50, failure_code = 'REJECTED'
        WHERE id = ${job!.id}
      `;

      expect(
        await inTenant(TENANT_A, (tx) => retryJob(tx, TENANT_A, job!.id))
      ).toEqual({ outcome: "refused", code: "RETRY_BUDGET_EXHAUSTED" });
    });
  });

  describe("hardening found by the self-audit", () => {
    test("an adapter-supplied failure code outside its declared vocabulary is never written, so it cannot carry the credential", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });

      fb.setBehavior((request) => ({
        outcome: "rejected",
        errorCode: request.credential.toUpperCase().replace(/[^A-Z0-9]/g, "_")
      }));

      const result = await enqueue(TENANT_A, enqueueInput([account.id]));

      await dispatch(TENANT_A);

      const [job] = await jobs(result.publicationId!);
      const ledger = (await getAdminSql()`
        SELECT error_code FROM awcms_social_publish_attempts
        WHERE job_id = ${job!.id}
      `) as { error_code: string }[];

      expect(job).toMatchObject({ status: "failed", failure_code: "REJECTED" });
      expect(ledger).toEqual([{ error_code: "REJECTED" }]);
    });
  });

  describe("partial failure never replays", () => {
    test("a rejected account does not change a published one, and retrying one job never re-sends a sibling", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const y = await seedAccount(TENANT_A, { provider: "instagram" });
      const z = await seedAccount(TENANT_A, { provider: "linkedin" });

      ig.setBehavior(() => ({
        outcome: "rejected",
        errorCode: "POLICY_BLOCK"
      }));
      li.setBehavior(() => ({
        outcome: "retryable",
        errorCode: "UPSTREAM_5XX"
      }));

      const result = await enqueue(TENANT_A, enqueueInput([x.id, y.id, z.id]));

      await dispatch(TENANT_A);

      let detail = await inTenant(TENANT_A, (tx) =>
        fetchPublication(tx, TENANT_A, result.publicationId!)
      );
      const byAccount = new Map(
        detail!.jobs.map((job) => [job.accountId, job])
      );

      expect(byAccount.get(x.id)!.status).toBe("published");
      expect(byAccount.get(y.id)).toMatchObject({
        status: "failed",
        failureCode: "POLICY_BLOCK"
      });
      expect(byAccount.get(z.id)!.status).toBe("retry_wait");
      expect(detail!.publication.status).toBe("partially_published");

      const content = (await getAdminSql()`
        SELECT content_hash, caption FROM awcms_social_publications
        WHERE id = ${result.publicationId}
      `) as { content_hash: string; caption: string }[];

      // The retry of the third account (and a second pass) never re-sends X.
      li.setBehavior(() => ({
        outcome: "published",
        externalPostId: "late",
        externalPostUrl: "https://linkedin.example/p/late"
      }));
      await dispatch(TENANT_A, { clock: at(60) });
      await dispatch(TENANT_A, { clock: at(120) });

      expect(fb.calls).toHaveLength(1);
      expect(ig.calls).toHaveLength(1);
      expect(li.calls).toHaveLength(2);

      detail = await inTenant(TENANT_A, (tx) =>
        fetchPublication(tx, TENANT_A, result.publicationId!)
      );
      expect(detail!.jobs.find((job) => job.accountId === z.id)!.status).toBe(
        "published"
      );

      // A manual retry of the FAILED job moves only that job.
      ig.setBehavior(() => ({
        outcome: "published",
        externalPostId: "fixed",
        externalPostUrl: "https://instagram.example/p/fixed"
      }));

      const failedJob = detail!.jobs.find((job) => job.accountId === y.id)!;

      expect(
        await inTenant(TENANT_A, (tx) => retryJob(tx, TENANT_A, failedJob.id))
      ).toMatchObject({ outcome: "ok" });
      await dispatch(TENANT_A, { clock: at(180) });

      expect(fb.calls).toHaveLength(1);
      expect(li.calls).toHaveLength(2);
      expect(ig.calls).toHaveLength(2);

      detail = await inTenant(TENANT_A, (tx) =>
        fetchPublication(tx, TENANT_A, result.publicationId!)
      );
      expect(detail!.publication.status).toBe("published");

      // The snapshot never moved.
      const after = (await getAdminSql()`
        SELECT content_hash, caption FROM awcms_social_publications
        WHERE id = ${result.publicationId}
      `) as { content_hash: string; caption: string }[];

      expect(after).toEqual(content);
    });

    test("a published job can never be retried, rewritten or cancelled: the database holds it", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([account.id]));

      await dispatch(TENANT_A);

      const [job] = await jobs(result.publicationId!);

      expect(job!.status).toBe("published");
      expect(
        await inTenant(TENANT_A, (tx) => retryJob(tx, TENANT_A, job!.id))
      ).toEqual({ outcome: "refused", code: "JOB_ALREADY_PUBLISHED" });

      for (const statement of [
        getAdminSql()`UPDATE awcms_social_publish_jobs SET status = 'queued' WHERE id = ${job!.id}`,
        getAdminSql()`UPDATE awcms_social_publish_jobs SET status = 'cancelled' WHERE id = ${job!.id}`,
        getAdminSql()`UPDATE awcms_social_publish_jobs SET external_post_id = 'x' WHERE id = ${job!.id}`
      ]) {
        await expectDbRefusal(statement, "rewriting a published job", "23514");
      }

      const canceller = await seedTenantUser(TENANT_A, "late-canceller");
      const cancelled = await inTenant(TENANT_A, (tx) =>
        cancelPublication(tx, TENANT_A, canceller, result.publicationId!, null)
      );

      // Cancelling stops only unsent work and reports what was already out.
      expect(cancelled).toMatchObject({
        outcome: "ok",
        jobsCancelled: 0,
        jobsAlreadyPublished: 1
      });
    });

    test("the snapshot and identity of a publication are immutable", async () => {
      const account = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([account.id]));

      await expectDbRefusal(
        getAdminSql()`UPDATE awcms_social_publications SET caption = 'edited' WHERE id = ${result.publicationId}`,
        "editing a caption",
        "23514"
      );
      await expectDbRefusal(
        getAdminSql()`UPDATE awcms_social_publications SET link_url = 'https://evil.example/' WHERE id = ${result.publicationId}`,
        "editing a link",
        "23514"
      );
    });
  });

  describe("revocation and degraded accounts", () => {
    test("a revoked account fails its job terminally and the provider is never called", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const y = await seedAccount(TENANT_A, { provider: "linkedin" });
      const result = await enqueue(TENANT_A, enqueueInput([x.id, y.id]));

      await getAdminSql()`UPDATE awcms_channel_accounts SET status = 'revoked', revoked_at = now() WHERE id = ${x.id}`;

      const run = await dispatch(TENANT_A);
      const rows = new Map(
        (await jobs(result.publicationId!)).map((job) => [
          job.channel_account_id,
          job
        ])
      );

      expect(run).toMatchObject({ failed: 1, published: 1 });
      expect(rows.get(x.id)).toMatchObject({
        status: "failed",
        failure_code: "ACCOUNT_ACCOUNT_REVOKED",
        attempt_count: 0
      });
      expect(fb.calls).toHaveLength(0);
      expect(li.calls).toHaveLength(1);
    });

    test("a revoked connection and a withdrawn capability are terminal; nothing is rerouted", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const y = await seedAccount(TENANT_A, { provider: "instagram" });
      const z = await seedAccount(TENANT_A, { provider: "linkedin" });
      const result = await enqueue(TENANT_A, enqueueInput([x.id, y.id, z.id]));

      await getAdminSql()`UPDATE awcms_channel_provider_connections SET grant_state = 'revoked', access_secret_id = NULL WHERE id = ${x.connectionId}`;
      await getAdminSql()`DELETE FROM awcms_channel_account_capabilities WHERE account_id = ${y.id}`;

      await dispatch(TENANT_A);

      const rows = new Map(
        (await jobs(result.publicationId!)).map((job) => [
          job.channel_account_id,
          job
        ])
      );

      expect(rows.get(x.id)!.status).toBe("failed");
      expect(rows.get(y.id)).toMatchObject({
        status: "failed",
        failure_code: "ACCOUNT_CAPABILITY_DENIED"
      });
      expect(rows.get(z.id)!.status).toBe("published");
      expect(fb.calls).toHaveLength(0);
      expect(ig.calls).toHaveLength(0);
      // The healthy account was not given anyone's content twice.
      expect(li.calls).toHaveLength(1);
    });

    test("a degraded account HOLDS the job without consuming an attempt, and it publishes once the account recovers", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([x.id]));

      await getAdminSql()`UPDATE awcms_channel_accounts SET status = 'degraded' WHERE id = ${x.id}`;

      const run = await dispatch(TENANT_A);
      const [held] = await jobs(result.publicationId!);

      expect(run).toMatchObject({ held: 1, claimed: 0 });
      expect(held).toMatchObject({
        status: "queued",
        attempt_count: 0,
        hold_count: 1,
        failure_code: "HELD_ACCOUNT_DEGRADED"
      });
      expect(fb.calls).toHaveLength(0);

      await getAdminSql()`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${x.id}`;
      await dispatch(TENANT_A, { clock: at(20) });

      const [done] = await jobs(result.publicationId!);

      expect(done).toMatchObject({ status: "published", attempt_count: 1 });
    });

    test("an expired grant holds; a hold budget that runs out fails the job", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([x.id]));

      // The grant lapses AFTER the job was queued (at enqueue it was active).
      await getAdminSql()`UPDATE awcms_channel_provider_connections SET grant_state = 'expired' WHERE id = ${x.connectionId}`;

      for (let pass = 0; pass < 12; pass += 1) {
        await dispatch(TENANT_A, { clock: at(20 * (pass + 1)) });
      }

      const [job] = await jobs(result.publicationId!);

      expect(job).toMatchObject({
        status: "failed",
        failure_code: "HOLD_EXHAUSTED",
        attempt_count: 0
      });
      expect(fb.calls).toHaveLength(0);
    });
  });

  describe("quota, fairness, concurrency and the breaker", () => {
    test("the per-account daily cap holds under concurrent dispatchers and every job is sent at most once", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });

      for (let n = 0; n < 8; n += 1) {
        await enqueue(
          TENANT_A,
          enqueueInput([x.id], {
            snapshot: snapshot({ caption: `Post number ${n}` })
          })
        );
      }

      await Promise.all(
        Array.from({ length: 4 }, () =>
          dispatch(TENANT_A, { accountDailyCap: 3, perAccountBatch: 3 })
        )
      );

      expect(fb.calls).toHaveLength(3);
      expect(new Set(fb.calls.map((c) => c.idempotencyKey)).size).toBe(3);

      const published = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_social_publish_jobs
        WHERE status = 'published'
      `) as { n: number }[];

      expect(published[0]!.n).toBe(3);

      // A day later the window has moved and the rest can go out.
      await dispatch(TENANT_A, {
        clock: at(25 * 60),
        accountDailyCap: 3,
        perAccountBatch: 3
      });
      expect(fb.calls).toHaveLength(6);
    });

    test("concurrent dispatchers send every job exactly once", async () => {
      const accounts = [
        await seedAccount(TENANT_A, { provider: "facebook" }),
        await seedAccount(TENANT_A, { provider: "linkedin" }),
        await seedAccount(TENANT_A, { provider: "instagram" })
      ];

      for (let n = 0; n < 4; n += 1) {
        await enqueue(
          TENANT_A,
          enqueueInput(
            accounts.map((account) => account.id),
            {
              snapshot: snapshot({ caption: `Concurrent ${n}` })
            }
          )
        );
      }

      for (let round = 0; round < 6; round += 1) {
        await Promise.all(
          Array.from({ length: 4 }, () =>
            dispatch(TENANT_A, { limit: 4, perAccountBatch: 2 })
          )
        );
      }

      const every = [...fb.calls, ...li.calls, ...ig.calls];

      expect(every).toHaveLength(12);
      expect(new Set(every.map((call) => call.idempotencyKey)).size).toBe(12);

      const states = (await getAdminSql()`
        SELECT status, count(*)::int AS n FROM awcms_social_publish_jobs
        GROUP BY status
      `) as { status: string; n: number }[];

      expect(states).toEqual([{ status: "published", n: 12 }]);
    });

    test("one account's backlog cannot starve another's", async () => {
      const busy = await seedAccount(TENANT_A, { provider: "facebook" });
      const quiet = await seedAccount(TENANT_A, { provider: "linkedin" });

      for (let n = 0; n < 6; n += 1) {
        await enqueue(
          TENANT_A,
          enqueueInput([busy.id], {
            snapshot: snapshot({ caption: `Busy ${n}` })
          })
        );
      }

      await enqueue(
        TENANT_A,
        enqueueInput([quiet.id], { snapshot: snapshot({ caption: "Quiet" }) })
      );

      const run = await dispatch(TENANT_A, { limit: 4, perAccountBatch: 2 });

      expect(run.claimed).toBe(3);
      expect(li.calls).toHaveLength(1);
      expect(fb.calls).toHaveLength(2);
    });

    test("a failing account's breaker opens and stops it without touching another account", async () => {
      const bad = await seedAccount(TENANT_A, { provider: "facebook" });
      const good = await seedAccount(TENANT_A, { provider: "linkedin" });

      fb.setBehavior(() => ({
        outcome: "retryable",
        errorCode: "UPSTREAM_5XX"
      }));

      for (let n = 0; n < 6; n += 1) {
        await enqueue(
          TENANT_A,
          enqueueInput([bad.id, good.id], {
            snapshot: snapshot({ caption: `Breaker ${n}` })
          })
        );
      }

      await dispatch(TENANT_A, { limit: 20, perAccountBatch: 5 });

      const breaker = getProviderCircuitBreaker(
        socialPublishBreakerKey(bad.id)
      );

      expect(breaker.canAttempt(at(0)())).toBe(false);

      const callsBefore = fb.calls.length;
      const run = await dispatch(TENANT_A, {
        limit: 20,
        perAccountBatch: 5,
        clock: at(0)
      });

      expect(run.skippedBreaker).toBeGreaterThan(0);
      expect(fb.calls.length).toBe(callsBefore);
      expect(li.calls.length).toBeGreaterThan(0);
      expect(
        getProviderCircuitBreaker(socialPublishBreakerKey(good.id)).canAttempt(
          at(0)()
        )
      ).toBe(true);
    });

    test("a job whose lease expired (a crashed pass) is claimed again and counted as a new attempt", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const result = await enqueue(TENANT_A, enqueueInput([x.id]));

      await getAdminSql()`
        UPDATE awcms_social_publish_jobs
        SET status = 'publishing', attempt_count = 1,
            next_attempt_at = ${at(-10)()}::timestamptz
        WHERE publication_id = ${result.publicationId}
      `;

      const run = await dispatch(TENANT_A);
      const [job] = await jobs(result.publicationId!);
      const ledger = (await getAdminSql()`
        SELECT attempt_no, outcome FROM awcms_social_publish_attempts
        WHERE job_id = ${job!.id}
      `) as { attempt_no: number; outcome: string }[];

      expect(run.published).toBe(1);
      expect(job).toMatchObject({ status: "published", attempt_count: 2 });
      expect(ledger).toEqual([{ attempt_no: 2, outcome: "published" }]);
    });

    test("a retry budget that runs out fails the job with RETRIES_EXHAUSTED", async () => {
      const x = await seedAccount(TENANT_A, { provider: "linkedin" });

      li.setBehavior(() => ({
        outcome: "retryable",
        errorCode: "UPSTREAM_5XX"
      }));

      const result = await enqueue(TENANT_A, enqueueInput([x.id]));

      for (let pass = 1; pass <= 6; pass += 1) {
        await dispatch(TENANT_A, { clock: at(pass * 600) });
        resetProviderCircuitBreakersForTests();
      }

      const [job] = await jobs(result.publicationId!);

      expect(job).toMatchObject({
        status: "failed",
        failure_code: "RETRIES_EXHAUSTED",
        attempt_count: 5
      });
    });
  });

  describe("the deployment switch", () => {
    test("dispatch is a no-op unless SOCIAL_PUBLISHING_ENABLED is true", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });

      await enqueue(TENANT_A, enqueueInput([x.id]));

      const run = await dispatch(TENANT_A, {
        env: {
          SOCIAL_PUBLISHING_ENABLED: "false"
        } as unknown as NodeJS.ProcessEnv
      });

      expect(run.claimed).toBe(0);
      expect(fb.calls).toHaveLength(0);
    });
  });

  describe("the article path (SocialPublishingPort)", () => {
    const mediaPort = (
      resolve: MediaLibraryPort["resolveMediaReferences"]
    ): MediaLibraryPort => ({
      isManagedMediaEnforcementActiveForTenant: async () => false,
      isMediaReferenceSafe: async () => true,
      resolveMediaReferences: resolve
    });
    const goodMedia = mediaPort(async (_tx, _tenant, ids) => {
      const map = new Map<
        string,
        Awaited<
          ReturnType<MediaLibraryPort["resolveMediaReferences"]>
        > extends ReadonlyMap<string, infer V>
          ? V
          : never
      >();

      for (const id of ids) {
        map.set(id, {
          publicUrl: IMAGE.publicUrl,
          altText: IMAGE.altText,
          mimeType: IMAGE.mimeType,
          width: 800,
          height: 600,
          sizeBytes: IMAGE.sizeBytes,
          creditLine: "Studio",
          sourceName: "Studio",
          copyrightStatus: "owned"
        });
      }

      return map;
    });
    const event = (over: Record<string, unknown> = {}) => ({
      articleId: crypto.randomUUID(),
      title: "Big news",
      slug: "big-news",
      excerpt: "Something happened.",
      featuredMediaId: null,
      trigger: "post_published" as const,
      ...over
    });

    async function configure(
      tenantId: string,
      accountId: string,
      settings = { autoPublishEnabled: true, approvalRequired: false }
    ) {
      const user = await seedTenantUser(
        tenantId,
        `cfg-${accountId.slice(0, 6)}`
      );

      await inTenant(tenantId, async (tx) => {
        await updateSettings(tx, tenantId, user, settings);
        await upsertRule(tx, tenantId, user, "post_published", accountId);
      });
    }

    const port = (
      media: MediaLibraryPort = goodMedia,
      env: NodeJS.ProcessEnv = ENV
    ) =>
      createSocialPublishingPortAdapter({
        mediaPort: media,
        registry,
        env,
        loadPublishers: async () => publishers
      });

    test("off unless the deployment enables it, and off per tenant until the tenant opts in", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });

      await configure(TENANT_A, x.id);

      const off = await inTenant(TENANT_A, (tx) =>
        port(goodMedia, {
          SOCIAL_PUBLISHING_ENABLED: "false"
        } as unknown as NodeJS.ProcessEnv).onArticlePublished(
          tx,
          TENANT_A,
          event()
        )
      );

      expect(off).toEqual({ jobsCreated: 0 });

      // Tenant B never opted in and has no rule.
      const y = await seedAccount(TENANT_B, { provider: "facebook" });
      const other = await inTenant(TENANT_B, (tx) =>
        port().onArticlePublished(tx, TENANT_B, event())
      );

      expect(other).toEqual({ jobsCreated: 0 });

      // Opted in but the tenant switch is off.
      await configure(TENANT_B, y.id, {
        autoPublishEnabled: false,
        approvalRequired: false
      });
      expect(
        await inTenant(TENANT_B, (tx) =>
          port().onArticlePublished(tx, TENANT_B, event())
        )
      ).toEqual({ jobsCreated: 0 });
    });

    test("an enabled tenant queues one job per rule account, idempotently, with an article link", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });
      const y = await seedAccount(TENANT_A, { provider: "linkedin" });

      await configure(TENANT_A, x.id);

      const user = await seedTenantUser(TENANT_A, "second-rule");

      await inTenant(TENANT_A, (tx) =>
        upsertRule(tx, TENANT_A, user, "post_published", y.id)
      );

      const input = event();
      const first = await inTenant(TENANT_A, (tx) =>
        port().onArticlePublished(tx, TENANT_A, input, "corr-article")
      );
      const again = await inTenant(TENANT_A, (tx) =>
        port().onArticlePublished(tx, TENANT_A, input, "corr-article")
      );

      expect(first).toEqual({ jobsCreated: 2 });
      expect(again).toEqual({ jobsCreated: 0 });

      const rows = (await getAdminSql()`
        SELECT link_url, state, source_id FROM awcms_social_publications
        WHERE tenant_id = ${TENANT_A}
      `) as { link_url: string; state: string; source_id: string }[];

      expect(rows).toEqual([
        {
          link_url: "https://cms.example/blog/sp1145-a/big-news",
          state: "ready",
          source_id: input.articleId
        }
      ]);

      await dispatch(TENANT_A);
      expect(fb.calls[0]!.linkUrl).toBe(
        "https://cms.example/blog/sp1145-a/big-news"
      );
    });

    test("approval is required by default for an article event", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });

      await configure(TENANT_A, x.id, {
        autoPublishEnabled: true,
        approvalRequired: true
      });
      await inTenant(TENANT_A, (tx) =>
        port().onArticlePublished(tx, TENANT_A, event())
      );

      expect((await dispatch(TENANT_A)).claimed).toBe(0);

      const rows = (await getAdminSql()`
        SELECT state FROM awcms_social_publications
      `) as { state: string }[];

      expect(rows).toEqual([{ state: "pending_approval" }]);
    });

    test("unpublishable content is a refused publication: zero jobs, recorded once, and the publish transaction survives", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });

      await configure(TENANT_A, x.id);

      const missing = mediaPort(async () => new Map());
      const input = event({ featuredMediaId: crypto.randomUUID() });
      const marker = crypto.randomUUID();
      const result = await inTenant(TENANT_A, async (tx) => {
        const outcome = await port(missing).onArticlePublished(
          tx,
          TENANT_A,
          input
        );

        // The article's own transaction keeps working after the port ran.
        await tx`
          INSERT INTO awcms_audit_events
            (tenant_id, module_key, action, resource_type, severity, message)
          VALUES (${TENANT_A}, 'blog_content', 'marker', 'x', 'info', ${marker})
        `;

        return outcome;
      });

      expect(result).toEqual({ jobsCreated: 0 });

      const rows = (await getAdminSql()`
        SELECT state, refusal_code FROM awcms_social_publications
      `) as { state: string; refusal_code: string }[];
      const marked = (await getAdminSql()`
        SELECT 1 FROM awcms_audit_events WHERE message = ${marker}
      `) as unknown[];

      expect(rows).toEqual([
        { state: "refused", refusal_code: "MEDIA_NOT_ELIGIBLE" }
      ]);
      expect(marked).toHaveLength(1);
    });

    test("an unexpected failure inside the port never aborts the publish transaction", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });

      await configure(TENANT_A, x.id);

      const exploding = mediaPort(async () => {
        throw new Error("media exploded");
      });
      const marker = crypto.randomUUID();
      const result = await inTenant(TENANT_A, async (tx) => {
        const outcome = await port(exploding).onArticlePublished(
          tx,
          TENANT_A,
          event({ featuredMediaId: crypto.randomUUID() })
        );

        await tx`
          INSERT INTO awcms_audit_events
            (tenant_id, module_key, action, resource_type, severity, message)
          VALUES (${TENANT_A}, 'blog_content', 'marker', 'x', 'info', ${marker})
        `;

        return outcome;
      });

      expect(result).toEqual({ jobsCreated: 0 });
      expect(
        (await getAdminSql()`SELECT 1 FROM awcms_audit_events WHERE message = ${marker}`) as unknown[]
      ).toHaveLength(1);
    });

    test("it also works as the scheduled-publish worker role", async () => {
      const x = await seedAccount(TENANT_A, { provider: "facebook" });

      await configure(TENANT_A, x.id);

      const result = await withTenantOrThrow(worker(), TENANT_A, (tx) =>
        port().onArticlePublished(tx, TENANT_A, event())
      );

      expect(result).toEqual({ jobsCreated: 1 });
    });
  });

  describe("tenant isolation, grants and the list", () => {
    test("tenant B cannot see tenant A's publications or jobs, and the keyset list pages without gaps", async () => {
      const a = await seedAccount(TENANT_A, { provider: "facebook" });

      for (let n = 0; n < 5; n += 1) {
        await enqueue(
          TENANT_A,
          enqueueInput([a.id], { snapshot: snapshot({ caption: `Row ${n}` }) })
        );
      }

      const asB = await inTenant(TENANT_B, (tx) =>
        listPublications(tx, TENANT_B, { limit: 10, cursor: null, state: null })
      );

      expect(asB).toMatchObject({ ok: true, items: [] });

      const seen: string[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 5; page += 1) {
        const current: Awaited<ReturnType<typeof listPublications>> =
          await inTenant(TENANT_A, (tx) =>
            listPublications(tx, TENANT_A, { limit: 2, cursor, state: null })
          );

        if (!current.ok) throw new Error("cursor");

        seen.push(...current.items.map((item) => item.id));
        cursor = current.nextCursor;

        if (!cursor) break;
      }

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    test("neither the runtime role nor the worker role can DELETE a publication, a job or an attempt", async () => {
      const a = await seedAccount(TENANT_A, { provider: "facebook" });

      await enqueue(TENANT_A, enqueueInput([a.id]));

      for (const table of [
        "awcms_social_publications",
        "awcms_social_publish_jobs",
        "awcms_social_publish_attempts"
      ]) {
        await expectDbRefusal(
          inTenant(TENANT_A, (tx) => tx.unsafe(`DELETE FROM ${table}`)),
          `runtime DELETE on ${table}`,
          "42501"
        );
        await expectDbRefusal(
          withTenantOrThrow(worker(), TENANT_A, (tx) =>
            tx.unsafe(`DELETE FROM ${table}`)
          ),
          `worker DELETE on ${table}`,
          "42501"
        );
      }
    });

    test("the worker role can never touch the rules or settings it only reads", async () => {
      await expectDbRefusal(
        withTenantOrThrow(worker(), TENANT_A, (tx) =>
          tx.unsafe(
            `INSERT INTO awcms_social_publishing_settings (tenant_id) VALUES ('${TENANT_A}')`
          )
        ),
        "worker INSERT on settings",
        "42501"
      );
    });

    test("a publication's jobs cannot be created for a cancelled publication, nor for a non-connected account", async () => {
      const a = await seedAccount(TENANT_A, { provider: "facebook" });
      const b = await seedAccount(TENANT_A, { provider: "linkedin" });
      const result = await enqueue(TENANT_A, enqueueInput([a.id]));

      await getAdminSql()`UPDATE awcms_channel_accounts SET status = 'disabled' WHERE id = ${b.id}`;
      await expectDbRefusal(
        getAdminSql()`
          INSERT INTO awcms_social_publish_jobs
            (tenant_id, publication_id, channel_account_id, provider,
             account_kind, variant, idempotency_key)
          VALUES (${TENANT_A}, ${result.publicationId}, ${b.id}, 'linkedin',
                  'organization_page', 'text', ${"b".repeat(64)})
        `,
        "a job for a disabled account",
        "23514"
      );

      await getAdminSql()`
        UPDATE awcms_social_publications
        SET state = 'cancelled', cancelled_at = now()
        WHERE id = ${result.publicationId}
      `;
      await getAdminSql()`UPDATE awcms_channel_accounts SET status = 'connected' WHERE id = ${b.id}`;
      await expectDbRefusal(
        getAdminSql()`
          INSERT INTO awcms_social_publish_jobs
            (tenant_id, publication_id, channel_account_id, provider,
             account_kind, variant, idempotency_key)
          VALUES (${TENANT_A}, ${result.publicationId}, ${b.id}, 'linkedin',
                  'organization_page', 'text', ${"c".repeat(64)})
        `,
        "a job for a cancelled publication",
        "23514"
      );
    });
  });
});
