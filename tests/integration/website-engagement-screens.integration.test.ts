/**
 * The `/admin/website-engagement` screens' loaders, run the way the pages run
 * them against a real PostgreSQL (Issue #1153, ADR-0155 section 8, ADR-0149).
 *
 * `tests/admin-website-engagement-page-contract.test.ts` pins the SOURCE of the
 * pages; this is the behavioural half. Each loader runs inside the real
 * `loadAdminScreen` chokepoint, with a real session, in one tenant-scoped
 * transaction, exactly as an `.astro` frontmatter does. It proves:
 *
 *   * default-deny: a person with no role, and one holding only the OTHER
 *     screen's key, get `denied` and no data;
 *   * tenant isolation: another tenant's sources, submissions and ids never
 *     appear, and another tenant's submission id is the same "not found" as an
 *     unknown id;
 *   * no secret and no personal data in what the screens read: no ciphertext,
 *     no token hash and no unmasked address in the serialised loader output;
 *   * every affordance follows its own permission: a read-only viewer gets no
 *     withdraw and no revoke, a withdrawn submission offers no withdraw;
 *   * filters narrow in SQL, a hand-edited filter value is ignored rather than
 *     failing, and a tenant with more than the bound reports `more` instead of
 *     claiming a total;
 *   * the key-ring state is reported (intake refused) without failing the read.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test
} from "bun:test";
import { randomBytes } from "node:crypto";

import {
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { loadAdminScreen } from "../../src/lib/auth/admin-screen";
import type { SsrContext } from "../../src/lib/auth/ssr-session";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import {
  LOAD_PAGE_LIMIT,
  LOAD_PAGE_SIZE,
  loadSourceList,
  loadSubmissionDetail,
  loadSubmissionList,
  type EngagementCan
} from "../../src/modules/website-engagement/application/screen-loaders";
import { WEBSITE_ENGAGEMENT_GUARDS as G } from "../../src/modules/website-engagement/domain/website-engagement-constants";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";

setDefaultTimeout(60_000);

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const ENCRYPTION_RING = `e1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 251)
).toString("base64")}`;
const HASH_RING = `h1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 7) % 251)
).toString("base64")}`;
const READ_SUBMISSIONS = "website_engagement.submissions.read";
const READ_SOURCES = "website_engagement.sources.read";
const WITHDRAW = "website_engagement.submissions.withdraw";
const MANAGE_SOURCES = "website_engagement.sources.manage";
/** A recognisable token hash and ciphertext: neither may reach a loader's output. */
const TOKEN_HASH = `h1:${"ab".repeat(32)}`;
const CIPHERTEXT = "v1.SECRET-CIPHERTEXT-MARKER";
const FULL_EMAIL = "visitor.fullname@private-domain.example";

let tenantId = "";
let counter = 0;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "we-screens-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "WE Screens Co",
      tenantCode: "we-screens",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);
  tenantId = setup.body.data.tenantId;

  const login = await invoke(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier, password: OWNER_PASSWORD },
    cookies: createCookieJar()
  });

  expect(login.status).toBe(200);
}

async function seedUser(
  tenant: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string }> {
  counter += 1;
  const sql = admin();
  const tag = `${label}-${counter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenant}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenant}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenant}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `wes-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenant}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenant}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
    `) as { id: string }[];

    for (const key of permissionKeys) {
      const [moduleKey, activityCode, action] = key.split(".");
      const permission = (await sql`
        SELECT id FROM awcms_permissions
        WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
          AND action = ${action!}
      `) as { id: string }[];

      if (!permission[0]) {
        throw new Error(`fixture: permission ${key} is not in the catalogue`);
      }

      await sql`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${tenant}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), tenant, (tx) =>
      grantRolePolicy(tx, tenant, {
        tenantUserId: tenantUser[0]!.id,
        roleId: role[0]!.id,
        grantedByTenantUserId: null,
        reason: "website engagement screens fixture"
      })
    );
  }

  return { token };
}

let sourceSerial = 0;

async function seedSource(
  tenant: string,
  code: string,
  status: "active" | "revoked" = "active"
): Promise<string> {
  sourceSerial += 1;
  const rows = (await admin()`
    INSERT INTO awcms_engagement_sources
      (tenant_id, code, name, status, consent_copy_version, token_hash,
       token_prefix, revoked_at)
    VALUES (${tenant}, ${code}, ${`Site ${code}`}, ${status}, 'v1',
            ${TOKEN_HASH}, ${`pre${String(sourceSerial).padStart(3, "0")}`},
            ${status === "revoked" ? new Date() : null})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

let eventSerial = 0;

/** A received contact, with ciphertext, hashes and masked projections. */
async function seedContact(
  tenant: string,
  sourceId: string,
  receivedAt = new Date()
): Promise<string> {
  eventSerial += 1;
  const rows = (await admin()`
    INSERT INTO awcms_engagement_submissions
      (tenant_id, source_id, event_id, kind, privacy_class, occurred_at,
       received_at, contact_encrypted, email_hash, email_masked,
       consent_purposes, consent_copy_version, consent_at, origin_host,
       origin_via, challenge_outcome)
    VALUES (${tenant}, ${sourceId}, ${`evt-contact-${eventSerial}-xxxx`},
            'contact', 'personal', ${receivedAt}, ${receivedAt}, ${CIPHERTEXT},
            ${TOKEN_HASH}, 'v***@private-domain.example',
            ARRAY['respond_to_inquiry'], 'v1', ${receivedAt},
            'www.owner-site.example', 'origin', 'source_none')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function seedInteractions(
  tenant: string,
  sourceId: string,
  count: number
): Promise<void> {
  eventSerial += 1;
  const base = eventSerial;

  await admin()`
    INSERT INTO awcms_engagement_submissions
      (tenant_id, source_id, event_id, kind, interaction_type, privacy_class,
       occurred_at, received_at, origin_host, origin_via, challenge_outcome)
    SELECT ${tenant}, ${sourceId}, 'evt-bulk-' || ${base} || '-' || n,
           'interaction', 'cta_click', 'anonymous', now(),
           now() - (n || ' seconds')::interval, 'www.owner-site.example',
           'origin', 'source_none'
    FROM generate_series(1, ${count}) AS n
  `;
}

type Loaded<T> = T | "denied" | "error";

/**
 * Runs one of the SCREENS' loaders the way the pages do: the real
 * `loadAdminScreen` chokepoint, one transaction, the viewer's real session.
 */
async function screen<T>(
  token: string,
  entry: (typeof G)[keyof typeof G],
  run: (input: {
    tx: Bun.SQL;
    tenantId: string;
    can: EngagementCan;
  }) => Promise<T>
): Promise<Loaded<T>> {
  const outcome = await loadAdminScreen({
    ssr: {
      tenantId,
      tokenHash: hashSessionToken(token)
    } as unknown as SsrContext,
    sql: getHandlerDatabaseClient(),
    workClass: "interactive",
    authorize: entry,
    load: ({ tx, can }) => run({ tx, tenantId, can }),
    onError: () => {}
  });

  return outcome.state === "allowed" ? outcome.data : outcome.state;
}

const listAs = (token: string, filters = {}) =>
  screen(token, G.readSubmissions, ({ tx, tenantId, can }) =>
    loadSubmissionList({
      tx,
      tenantId,
      filters,
      readSourcesGuard: G.readSources,
      can
    })
  );
const detailAs = (token: string, id: string | null) =>
  screen(token, G.readSubmissions, ({ tx, tenantId, can }) =>
    loadSubmissionDetail({
      tx,
      tenantId,
      submissionId: id,
      withdrawGuard: G.withdrawSubmissions,
      can
    })
  );
const sourcesAs = (token: string) =>
  screen(token, G.readSources, ({ tx, tenantId, can }) =>
    loadSourceList({ tx, tenantId, manageGuard: G.manageSources, can })
  );

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("website engagement screens (#1153, ADR-0155)", () => {
  beforeAll(async () => {
    for (const name of [
      "WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS",
      "WEBSITE_ENGAGEMENT_HASH_KEYS",
      "WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS",
      "WEBSITE_ENGAGEMENT_KEYS"
    ]) {
      savedEnv[name] = process.env[name];
    }

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
    expect(handlerReady, "the handler database must be available").toBe(true);
    process.env.WEBSITE_ENGAGEMENT_ENCRYPTION_KEYS = ENCRYPTION_RING;
    process.env.WEBSITE_ENGAGEMENT_HASH_KEYS = HASH_RING;
    delete process.env.WEBSITE_ENGAGEMENT_LEGACY_HASH_KEYS;
    delete process.env.WEBSITE_ENGAGEMENT_KEYS;
    sourceSerial = 0;
    eventSerial = 0;
    await resetHandlerDatabase();
    await bootstrap();
  });

  async function twoTenants() {
    const other = crypto.randomUUID();

    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${other}, 'we-screens-two', 'We Screens Two')
    `;

    const mine = await seedSource(tenantId, "mine");
    const theirs = await seedSource(other, "theirs");
    const mySubmission = await seedContact(tenantId, mine);
    const theirSubmission = await seedContact(other, theirs);

    return { other, mine, theirs, mySubmission, theirSubmission };
  }

  test("default-deny: no role, and the other screen's key alone, get nothing", async () => {
    await twoTenants();
    const noRole = await seedUser(tenantId, "norole", []);
    const sourcesOnly = await seedUser(tenantId, "srconly", [READ_SOURCES]);
    const submissionsOnly = await seedUser(tenantId, "subonly", [
      READ_SUBMISSIONS
    ]);

    expect(await listAs(noRole.token)).toBe("denied");
    expect(await sourcesAs(noRole.token)).toBe("denied");
    expect(await listAs(sourcesOnly.token)).toBe("denied");
    expect(await sourcesAs(submissionsOnly.token)).toBe("denied");
  });

  test("two tenants: only this tenant's sources and submissions load, and a foreign id is 'not found'", async () => {
    const { theirSubmission, mySubmission, mine } = await twoTenants();
    const viewer = await seedUser(tenantId, "viewer", [
      READ_SUBMISSIONS,
      READ_SOURCES
    ]);
    const list = await listAs(viewer.token);

    expect(list).not.toBe("denied");

    if (typeof list === "string") throw new Error("unreachable");

    expect(list.submissions.map((row) => row.id)).toEqual([mySubmission]);
    expect(list.submissions.map((row) => row.sourceCode)).toEqual(["mine"]);
    expect(list.sourceOptions).toEqual([{ id: mine, code: "mine" }]);

    const sources = await sourcesAs(viewer.token);

    if (typeof sources === "string") throw new Error("unreachable");

    expect(sources.sources.map((row) => row.code)).toEqual(["mine"]);

    // Another tenant's id, an unknown id and no id are one answer.
    expect(await detailAs(viewer.token, theirSubmission)).toEqual({
      found: false
    });
    expect(await detailAs(viewer.token, crypto.randomUUID())).toEqual({
      found: false
    });
    expect(await detailAs(viewer.token, null)).toEqual({ found: false });

    const own = await detailAs(viewer.token, mySubmission);

    expect(own).toMatchObject({ found: true });
  });

  test("a viewer holding only submissions.read still gets source options from the rows, never from the sources table", async () => {
    await twoTenants();
    const viewer = await seedUser(tenantId, "subonly", [READ_SUBMISSIONS]);
    const list = await listAs(viewer.token);

    if (typeof list === "string") throw new Error("unreachable");

    expect(list.canSeeSources).toBe(false);
    expect(list.sourceOptions.map((option) => option.code)).toEqual(["mine"]);
  });

  test("no ciphertext, token hash or unmasked address reaches what the screens read", async () => {
    const { mySubmission } = await twoTenants();
    const viewer = await seedUser(tenantId, "all", [
      READ_SUBMISSIONS,
      READ_SOURCES,
      WITHDRAW,
      MANAGE_SOURCES
    ]);
    const outputs = [
      await listAs(viewer.token),
      await detailAs(viewer.token, mySubmission),
      await sourcesAs(viewer.token)
    ];
    const serialised = JSON.stringify(outputs);

    expect(serialised).toContain("v***@private-domain.example");
    expect(serialised).toContain("pre001");
    expect(serialised).not.toContain(CIPHERTEXT);
    expect(serialised).not.toContain(TOKEN_HASH);
    expect(serialised).not.toContain(TOKEN_HASH.slice(3, 20));
    expect(serialised).not.toContain(FULL_EMAIL);
    expect(serialised).not.toMatch(/token_hash|contact_encrypted|email_hash/);
  });

  test("every affordance follows its own permission, and a withdrawn submission offers no withdraw", async () => {
    const { mine, mySubmission } = await twoTenants();
    const readOnly = await seedUser(tenantId, "ro", [
      READ_SUBMISSIONS,
      READ_SOURCES
    ]);
    const full = await seedUser(tenantId, "full", [
      READ_SUBMISSIONS,
      READ_SOURCES,
      WITHDRAW,
      MANAGE_SOURCES
    ]);

    expect(await detailAs(readOnly.token, mySubmission)).toMatchObject({
      found: true,
      canWithdraw: false
    });
    expect(await detailAs(full.token, mySubmission)).toMatchObject({
      found: true,
      canWithdraw: true
    });
    expect(await sourcesAs(readOnly.token)).toMatchObject({
      canManage: false
    });
    expect(await sourcesAs(full.token)).toMatchObject({ canManage: true });

    await admin()`
      UPDATE awcms_engagement_submissions
      SET status = 'withdrawn', withdrawn_at = now(),
          withdrawal_reason = 'controller_decision', contact_encrypted = NULL,
          email_hash = NULL, email_masked = NULL
      WHERE id = ${mySubmission}
    `;

    expect(await detailAs(full.token, mySubmission)).toMatchObject({
      found: true,
      canWithdraw: false
    });
    expect(mine).not.toBe("");
  });

  test("filters narrow in SQL, and a hand-edited filter value is ignored", async () => {
    const { mine, mySubmission } = await twoTenants();
    const second = await seedSource(tenantId, "second");

    await seedInteractions(tenantId, second, 3);

    const viewer = await seedUser(tenantId, "filter", [
      READ_SUBMISSIONS,
      READ_SOURCES
    ]);
    const all = await listAs(viewer.token);
    const byKind = await listAs(viewer.token, { kind: "interaction" });
    const bySource = await listAs(viewer.token, { source: mine });
    const byStatus = await listAs(viewer.token, { status: "withdrawn" });
    const garbage = await listAs(viewer.token, {
      source: "not-a-uuid",
      kind: "evil",
      status: "x"
    });

    if (
      [all, byKind, bySource, byStatus, garbage].some(
        (value) => typeof value === "string"
      )
    ) {
      throw new Error("unreachable");
    }

    const rows = (value: unknown) =>
      (value as { submissions: { id: string; kind: string }[] }).submissions;

    expect(rows(all)).toHaveLength(4);
    expect(rows(byKind)).toHaveLength(3);
    expect(rows(byKind).every((row) => row.kind === "interaction")).toBe(true);
    expect(rows(bySource).map((row) => row.id)).toEqual([mySubmission]);
    expect(rows(byStatus)).toHaveLength(0);
    // An unknown value is dropped, not a failure and not an empty page.
    expect(rows(garbage)).toHaveLength(4);
  });

  test("a tenant with more than the bound reports `more` and loads exactly the bound, newest first", async () => {
    const { mine } = await twoTenants();
    const bound = LOAD_PAGE_SIZE * LOAD_PAGE_LIMIT;

    await seedInteractions(tenantId, mine, bound + 5);

    const viewer = await seedUser(tenantId, "many", [READ_SUBMISSIONS]);
    const list = await listAs(viewer.token);

    if (typeof list === "string") throw new Error("unreachable");

    expect(list.submissions).toHaveLength(bound);
    expect(list.more).toBe(true);

    const times = list.submissions.map((row) => Date.parse(row.receivedAt));

    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(new Set(list.submissions.map((row) => row.id)).size).toBe(bound);
  });

  test("a revoked source is listed as revoked; the key-ring state is reported without failing the read", async () => {
    await twoTenants();
    await seedSource(tenantId, "gone", "revoked");

    const viewer = await seedUser(tenantId, "ring", [
      READ_SUBMISSIONS,
      READ_SOURCES
    ]);
    const healthy = await sourcesAs(viewer.token);

    if (typeof healthy === "string") throw new Error("unreachable");

    expect(healthy.intakeAvailable).toBe(true);
    expect(healthy.sources.find((row) => row.code === "gone")?.status).toBe(
      "revoked"
    );

    delete process.env.WEBSITE_ENGAGEMENT_HASH_KEYS;

    const broken = await listAs(viewer.token);

    if (typeof broken === "string") throw new Error("unreachable");

    expect(broken.intakeAvailable).toBe(false);
    // Reads keep working: the rows received earlier are still listed.
    expect(broken.submissions.length).toBeGreaterThan(0);
  });
});
