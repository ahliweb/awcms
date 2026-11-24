/**
 * What `/admin/email-webhooks` decides for a caller, against a real PostgreSQL
 * and the real `loadAdminScreen` chokepoint (Issue #1162, ADR-0151 section 5).
 *
 * The screen's decisions are an application function
 * (`resolveEmailWebhooksScreen`), so a database can answer what a source-text
 * test cannot:
 *
 *   * TENANT isolation: a person of tenant B sees none of tenant A's callbacks
 *     or quarantined events, and the reverse;
 *   * an account assigned to somebody else hides its callbacks AND its events;
 *   * a review control is offered only to a caller holding
 *     `provider_events.approve`, and only on a pending bounce or unsubscribe
 *     (an open, or an already reviewed event, is never reviewable);
 *   * the data never carries a token, a token hash or a whole recipient;
 *   * the event list is keyset-paged: a second page continues where the first
 *     stopped, with no overlap and no gap;
 *   * a channel registry switched off reads as such, not as "no callbacks".
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
import { randomBytes } from "node:crypto";

import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { loadAdminScreen } from "../../src/lib/auth/admin-screen";
import type { SsrContext } from "../../src/lib/auth/ssr-session";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { PROVIDER_EVENT_PAGE_LIMIT } from "../../src/modules/email/application/provider-event-directory";
import {
  parseReviewStatusFilter,
  resolveEmailWebhooksScreen,
  type EmailWebhooksScreen
} from "../../src/modules/email/application/email-webhooks-screen";
import { issueWebhookSubscription } from "../../src/modules/channel-accounts/application/webhook-subscription-directory";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const UNUSABLE_LOGIN_MARKER = "fixture-no-login";

const READ = "email.webhook.read";
const APPROVE = "email.provider_events.approve";
const CONFIGURE = "email.webhook.configure";
/** Every token hash stored by this file: none of them may reach the screen data. */
const STORED_HASHES: string[] = [];

type Env = {
  tenantId: string;
  ownerSessionHash: string;
  ownerTenantUserId: string;
};

let env: Env;
let userCounter = 0;
let accountCounter = 0;
let handlerReady = false;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function insertSession(
  tenantId: string,
  identityId: string
): Promise<string> {
  const opaque = `sess-${randomBytes(18).toString("hex")}`;
  const stored = hashSessionToken(opaque);

  await admin()`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenantId}, ${identityId}, ${stored},
            now() + interval '8 hours', 'aal1', now())
  `;

  return stored;
}

async function bootstrap(): Promise<Env> {
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Webhooks Co",
      tenantCode: "whk-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: "whk-owner@example.com",
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
  const owner = (await admin()`
    SELECT tu.id, tu.identity_id FROM awcms_tenant_users tu
    WHERE tu.tenant_id = ${tenantId} LIMIT 1
  `) as { id: string; identity_id: string }[];

  return {
    tenantId,
    ownerSessionHash: await insertSession(tenantId, owner[0]!.identity_id),
    ownerTenantUserId: owner[0]!.id
  };
}

async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ sessionHash: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, ${UNUSABLE_LOGIN_MARKER})
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const sessionHash = await insertSession(tenantId, identity[0]!.id);
  const role = (await sql`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
  `) as { id: string }[];

  for (const key of permissionKeys) {
    const [moduleKey, activityCode, action] = key.split(".");
    const permission = (await sql`
      SELECT id FROM awcms_permissions
      WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
        AND action = ${action!}
    `) as { id: string }[];

    if (!permission[0])
      throw new Error(`fixture: ${key} is not in the catalogue`);

    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${role[0]!.id}, ${permission[0].id})
    `;
  }

  await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
    grantRolePolicy(tx, tenantId, {
      tenantUserId: tenantUser[0]!.id,
      roleId: role[0]!.id,
      grantedByTenantUserId: null,
      reason: "email senders screen fixture"
    })
  );

  return { sessionHash, tenantUserId: tenantUser[0]!.id };
}

async function assign(
  tenantId: string,
  accountId: string,
  tenantUserId: string,
  createdBy: string,
  kind: "operator" | "viewer" = "operator"
) {
  await admin().begin(async (tx) => {
    await tx`
      INSERT INTO awcms_channel_account_assignments
        (tenant_id, account_id, tenant_user_id, kind, created_by)
      VALUES (${tenantId}, ${accountId}, ${tenantUserId}, ${kind}, ${createdBy})
    `;
    // Since #1215 an account is open to the permission alone only when it is
    // `tenant_wide`; the seeders create that mode (the screen's original "no
    // assignee = open" fixtures), and assigning somebody is what closes it.
    // The access-mode guard wants an `owner` row for the switch, which these
    // fixtures do not model, so it is bypassed for this fixture write only.
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`
      UPDATE awcms_channel_accounts SET access_mode = 'assigned'
      WHERE tenant_id = ${tenantId} AND id = ${accountId}
    `;
  });
}

async function otherTenant(code: string): Promise<string> {
  const id = crypto.randomUUID();

  await admin()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
  `;

  return id;
}

async function seedEsp(tenantId: string, name: string): Promise<string> {
  accountCounter += 1;
  const rows = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name, auth_mode,
       status, access_mode)
    VALUES (${tenantId}, 'mailketing', 'esp_account', ${`mk-login-${accountCounter}`},
            ${name}, 'api_token', 'connected', 'tenant_wide')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function seedCallback(
  tenantId: string,
  accountId: string
): Promise<string> {
  const id = crypto.randomUUID();
  const hash = `sha256:${randomBytes(32).toString("hex")}`;

  STORED_HASHES.push(hash);

  const creator = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];
  const issued = await withTenantOrThrow(
    getHandlerDatabaseClient(),
    tenantId,
    (tx) =>
      issueWebhookSubscription(tx, tenantId, {
        id,
        accountId,
        provider: "mailketing",
        accountKind: "esp_account",
        verificationMode: "unauthenticated",
        callbackTokenHash: hash,
        createdBy: creator[0]!.id
      })
  );

  expect(issued.outcome).not.toBe("account_unavailable");

  return id;
}

async function seedEvent(
  tenantId: string,
  accountId: string,
  subscriptionId: string,
  options: {
    eventType?: string;
    reviewStatus?: string;
    ageSeconds?: number;
    recipientMasked?: string;
  } = {}
): Promise<string> {
  const type = options.eventType ?? "unsubscribe";
  // The table's own CHECKs: a bounce, open or delivered event is bound by the
  // provider message id; a click or unsubscribe by the recipient alone.
  const byMessageId = ["bounce", "open", "delivered"].includes(type);
  const review = options.reviewStatus ?? "pending";

  return admin().begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    const rows = (await tx`
      INSERT INTO awcms_email_provider_events
        (tenant_id, subscription_id, esp_account_id, email_message_id,
         event_type, correlation, provider_message_id, bounce_class, recipient_hash, recipient_masked,
         dedupe_key, review_status, reviewed_at, received_at)
      VALUES
        (${tenantId}, ${subscriptionId}, ${accountId}, ${crypto.randomUUID()},
         ${type}, ${byMessageId ? "provider_message_id" : "recipient_only"},
         ${byMessageId ? `pm-${crypto.randomUUID()}` : null},
         ${type === "bounce" ? "hard" : null},
         ${crypto.randomUUID().replaceAll("-", "").repeat(2)},
         ${options.recipientMasked ?? "p***@example.test"},
         ${crypto.randomUUID().replaceAll("-", "").repeat(2)}, ${review},
         ${review === "pending" || review === "informational" ? null : new Date()},
         now() - make_interval(secs => ${options.ageSeconds ?? 0}))
      RETURNING id
    `) as { id: string }[];

    return rows[0]!.id;
  });
}

/** Runs the screen the way `email-webhooks.astro` does: the real chokepoint, one transaction. */
async function screenFor(
  sessionHash: string,
  tenantId: string,
  query: { reviewStatus?: string; cursor?: string | null } = {}
): Promise<EmailWebhooksScreen | "denied" | "error"> {
  const outcome = await loadAdminScreen({
    ssr: { tenantId, tokenHash: sessionHash } as unknown as SsrContext,
    sql: getHandlerDatabaseClient(),
    workClass: "interactive",
    authorize: { moduleKey: "email", activityCode: "webhook", action: "read" },
    load: async ({ tx, auth, can }) =>
      resolveEmailWebhooksScreen(
        {
          tx,
          tenantId,
          tokenHash: sessionHash,
          auth,
          now: new Date(),
          request: new Request("http://localhost/admin/email-webhooks"),
          clientAddress: "127.0.0.1"
        },
        (guard) => can({ ...guard }),
        {
          reviewStatus: parseReviewStatusFilter(query.reviewStatus ?? null),
          cursor: query.cursor ?? null
        }
      ),
    onError: () => {}
  });

  return outcome.state === "allowed" ? outcome.data : outcome.state;
}

const ready = (value: Awaited<ReturnType<typeof screenFor>>) => {
  if (value === "denied" || value === "error") {
    throw new Error(`screen was ${value}`);
  }

  return value;
};

const suite = integrationEnabled ? describe : describe.skip;

suite("email webhooks screen decisions (Issue #1162)", () => {
  beforeAll(async () => {
    savedEnv.CHANNEL_ACCOUNTS_ENABLED = process.env.CHANNEL_ACCOUNTS_ENABLED;
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  test("a person of another tenant sees none of this tenant's callbacks or events, and the data holds no token, hash or whole recipient", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId, "Tenant A login");
    const callback = await seedCallback(env.tenantId, esp);

    await seedEvent(env.tenantId, esp, callback, {
      recipientMasked: "a***@tenant-a.test"
    });

    const tenant2 = await otherTenant("whk-two");
    const foreign = await seedUser(tenant2, "foreign", [READ]);
    const espB = await seedEsp(tenant2, "Tenant B login");
    const callbackB = await seedCallback(tenant2, espB);

    await seedEvent(tenant2, espB, callbackB, {
      recipientMasked: "b***@tenant-b.test"
    });

    const mine = ready(await screenFor(env.ownerSessionHash, env.tenantId));
    const theirs = ready(await screenFor(foreign.sessionHash, tenant2));

    expect(mine.callbacks.map((c) => c.accountName)).toEqual([
      "Tenant A login"
    ]);
    expect(mine.events.map((e) => e.recipientMasked)).toEqual([
      "a***@tenant-a.test"
    ]);
    expect(theirs.callbacks.map((c) => c.accountName)).toEqual([
      "Tenant B login"
    ]);
    expect(theirs.events.map((e) => e.recipientMasked)).toEqual([
      "b***@tenant-b.test"
    ]);
    expect(JSON.stringify(theirs)).not.toContain("Tenant A");
    expect(JSON.stringify(mine)).not.toContain("Tenant B");

    const text = JSON.stringify(mine);

    expect(STORED_HASHES.length).toBeGreaterThan(0);

    for (const hash of STORED_HASHES) {
      expect(text).not.toContain(hash);
      expect(text).not.toContain(hash.slice("sha256:".length));
    }

    expect(text).not.toMatch(/token/i);
    expect(text).not.toContain("recipientHash");
  });

  test("an account assigned to somebody else hides its callbacks and its events", async () => {
    if (!handlerReady) return;

    const open = await seedEsp(env.tenantId, "Open login");
    const closed = await seedEsp(env.tenantId, "Closed login");
    const openCallback = await seedCallback(env.tenantId, open);
    const closedCallback = await seedCallback(env.tenantId, closed);

    await seedEvent(env.tenantId, open, openCallback);
    await seedEvent(env.tenantId, closed, closedCallback);

    const other = await seedUser(env.tenantId, "other", [READ]);

    await assign(
      env.tenantId,
      closed,
      env.ownerTenantUserId,
      env.ownerTenantUserId
    );

    const screen = ready(await screenFor(other.sessionHash, env.tenantId));

    expect(screen.callbacks.map((c) => c.accountId)).toEqual([open]);
    expect(screen.events).toHaveLength(1);
    expect(screen.accounts.map((a) => a.id)).toEqual([open]);
  });

  test("review is offered only with provider_events.approve, and only on a pending bounce or unsubscribe", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId, "Login");
    const callback = await seedCallback(env.tenantId, esp);
    const pending = await seedEvent(env.tenantId, esp, callback, {
      eventType: "unsubscribe",
      ageSeconds: 5
    });
    const bounce = await seedEvent(env.tenantId, esp, callback, {
      eventType: "bounce",
      ageSeconds: 4
    });

    await seedEvent(env.tenantId, esp, callback, {
      eventType: "open",
      reviewStatus: "informational",
      ageSeconds: 3
    });
    await seedEvent(env.tenantId, esp, callback, {
      eventType: "unsubscribe",
      reviewStatus: "confirmed",
      ageSeconds: 2
    });

    const reader = await seedUser(env.tenantId, "reader", [READ]);
    const approver = await seedUser(env.tenantId, "approver", [READ, APPROVE]);
    const configurer = await seedUser(env.tenantId, "configurer", [
      READ,
      CONFIGURE
    ]);

    const asReader = ready(await screenFor(reader.sessionHash, env.tenantId));
    const asApprover = ready(
      await screenFor(approver.sessionHash, env.tenantId)
    );
    const asConfigurer = ready(
      await screenFor(configurer.sessionHash, env.tenantId)
    );

    expect(asReader.canApprove).toBe(false);
    expect(asReader.canConfigure).toBe(false);
    expect(asReader.events.some((e) => e.reviewable)).toBe(false);
    expect(asConfigurer.canConfigure).toBe(true);
    expect(asConfigurer.canApprove).toBe(false);
    expect(asApprover.canApprove).toBe(true);
    expect(asApprover.events.map((e) => e.id).sort()).toEqual(
      [pending, bounce].sort()
    );
    expect(asApprover.events.every((e) => e.reviewable)).toBe(true);

    // The informational and the confirmed events are on their own tabs, never reviewable.
    const informational = ready(
      await screenFor(approver.sessionHash, env.tenantId, {
        reviewStatus: "informational"
      })
    );
    const confirmed = ready(
      await screenFor(approver.sessionHash, env.tenantId, {
        reviewStatus: "confirmed"
      })
    );

    expect(informational.events).toHaveLength(1);
    expect(informational.events[0]!.reviewable).toBe(false);
    expect(confirmed.events).toHaveLength(1);
    expect(confirmed.events[0]!.reviewable).toBe(false);
  });

  test("a caller without webhook.read is denied, not shown an empty page", async () => {
    if (!handlerReady) return;

    const nobody = await seedUser(env.tenantId, "nobody", []);

    expect(await screenFor(nobody.sessionHash, env.tenantId)).toBe("denied");
  });

  test("the event list is keyset-paged without overlap or gap", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId, "Login");
    const callback = await seedCallback(env.tenantId, esp);
    const total = PROVIDER_EVENT_PAGE_LIMIT + 7;
    const ids: string[] = [];

    for (let i = 0; i < total; i += 1) {
      ids.push(
        await seedEvent(env.tenantId, esp, callback, { ageSeconds: i + 1 })
      );
    }

    const first = ready(await screenFor(env.ownerSessionHash, env.tenantId));

    expect(first.events).toHaveLength(PROVIDER_EVENT_PAGE_LIMIT);
    expect(first.nextCursor).not.toBeNull();

    const second = ready(
      await screenFor(env.ownerSessionHash, env.tenantId, {
        cursor: first.nextCursor
      })
    );

    expect(second.events).toHaveLength(7);
    expect(second.nextCursor).toBeNull();

    const seen = [...first.events, ...second.events].map((e) => e.id);

    expect(new Set(seen).size).toBe(total);
    // Newest first: the youngest seed (ageSeconds 1) is first.
    expect(seen).toEqual(ids);
  });

  test("a channel registry switched off reads as such, not as no callbacks", async () => {
    if (!handlerReady) return;

    process.env.CHANNEL_ACCOUNTS_ENABLED = "false";

    const screen = ready(await screenFor(env.ownerSessionHash, env.tenantId));

    expect(screen.channelAccountsEnabled).toBe(false);
    expect(screen.unavailable).toBe(false);
    expect(screen.callbacks).toEqual([]);
  });

  test("an unreadable cursor is the first page and an unknown filter is pending", async () => {
    if (!handlerReady) return;

    const esp = await seedEsp(env.tenantId, "Login");
    const callback = await seedCallback(env.tenantId, esp);

    await seedEvent(env.tenantId, esp, callback);

    const screen = ready(
      await screenFor(env.ownerSessionHash, env.tenantId, {
        reviewStatus: "everything",
        cursor: "not-a-cursor"
      })
    );

    expect(screen.reviewStatus).toBe("pending");
    expect(screen.events).toHaveLength(1);
  });
});
