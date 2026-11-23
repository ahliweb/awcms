/**
 * `GET /api/v1/omnichannel-inbox/conversations/{id}/eligible-assignees` and the
 * shared `listEligibleStaff` behind it (Issue #1486, #1164).
 *
 * The properties that make a staff picker safe, each measured against a real
 * database with real sessions:
 *
 * - the list is exactly the people the assignment rule accepts: it is compared,
 *   person by person and scope by scope, with `assigneeEligibility` (the
 *   write-time authority), so the SET form cannot drift wider;
 * - it is never a directory: inactive people, people without the tenant-wide
 *   permission (read-only, scoped grant), people whose confinement does not
 *   cover the conversation (or has not started yet), and other tenants' staff
 *   are absent;
 * - a caller with a narrow permission (assign, confined to one brand) cannot use
 *   it to look beyond that brand, and a caller without `assign` is refused;
 * - unknown, foreign-tenant and invisible conversations are ONE answer;
 * - the page size is bounded and the cursor walks every person exactly once.
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
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { assigneeEligibility } from "../../src/modules/omnichannel-inbox/application/assignee-eligibility";
import { officeScopeHierarchyPortAdapter } from "../../src/modules/tenant-admin/application/office-scope-hierarchy-port-adapter";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { GET as eligibleRoute } from "../../src/pages/api/v1/omnichannel-inbox/conversations/[id]/eligible-assignees";

setDefaultTimeout(60_000);

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const READ = "omnichannel_inbox.conversations.read";
const UPDATE = "omnichannel_inbox.conversations.update";
const ASSIGN = "omnichannel_inbox.conversations.assign";

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};
type Page = {
  items: { tenantUserId: string; displayName: string }[];
  nextCursor: string | null;
};
type Seeded = { token: string; tenantUserId: string };

let tenantId = "";
let ownerTenantUserId = "";
let counter = 0;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "eligible-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Eligible Co",
      tenantCode: "eligible-one",
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

  const owner = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  ownerTenantUserId = owner[0]!.id;
}

async function seedUser(
  tenant: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<Seeded> {
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
  const token = `el-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenant}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

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
      reason: "eligible fixture"
    })
  );

  return { token, tenantUserId: tenantUser[0]!.id };
}

async function seedOffice(tenant: string, code: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${tenant}, ${code}, ${`Office ${code}`}) RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function holdScope(
  tenant: string,
  tenantUserId: string,
  officeId: string,
  startsIn = "-1 minute"
) {
  await admin()`
    INSERT INTO awcms_business_scope_assignments
      (tenant_id, tenant_user_id, scope_type, scope_id,
       granted_by_tenant_user_id, effective_from)
    VALUES (${tenant}, ${tenantUserId}, 'office', ${officeId},
            ${ownerTenantUserId}, now() + ${startsIn}::interval)
  `;
}

/** A website conversation (no bot account needed), scoped or tenant-wide. */
async function seedConversation(
  tenant: string,
  officeId: string | null,
  customerState = "active"
): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_inbox_conversations
      (tenant_id, source_kind, source_ref, business_scope_type,
       business_scope_id, first_inbound_at, last_inbound_at, customer_state,
       status)
    VALUES (${tenant}, 'website', ${crypto.randomUUID()},
            ${officeId ? "office" : null}, ${officeId}, now(), now(),
            ${customerState},
            ${customerState === "active" ? "open" : "closed"})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

function headers(token: string, tenant = tenantId) {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": tenant,
    authorization: `Bearer ${token}`
  };
}

async function eligible(token: string, id: string, query = "") {
  return invoke<Envelope<Page>>(eligibleRoute, {
    path: `/api/v1/omnichannel-inbox/conversations/${id}/eligible-assignees${query}`,
    params: { id },
    headers: headers(token)
  });
}

const ids = (response: { body: Envelope<Page> }) =>
  response.body.data!.items.map((item) => item.tenantUserId).sort();

async function allPages(token: string, id: string, limit: number) {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const query: string = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await eligible(token, id, query);

    expect(page.status).toBe(200);
    expect(page.body.data!.items.length).toBeLessThanOrEqual(limit);
    seen.push(...page.body.data!.items.map((item) => item.tenantUserId));
    cursor = page.body.data!.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(50);
  } while (cursor);

  return seen;
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("eligible staff directory (#1486)", () => {
  beforeAll(async () => {
    for (const name of [
      "OMNICHANNEL_INBOX_ENABLED",
      "CHANNEL_ACCOUNTS_ENABLED"
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
    process.env.OMNICHANNEL_INBOX_ENABLED = "true";
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    await resetHandlerDatabase();
    await bootstrap();
  });

  /** One tenant, two brands, and a person for every way of (not) being eligible. */
  async function world() {
    const brandA = await seedOffice(tenantId, "el-a");
    const brandB = await seedOffice(tenantId, "el-b");
    const lead = await seedUser(tenantId, "lead", [READ, UPDATE, ASSIGN]);
    const wide = await seedUser(tenantId, "wide", [READ, UPDATE]);
    const inA = await seedUser(tenantId, "in-a", [UPDATE]);
    const inB = await seedUser(tenantId, "in-b", [UPDATE]);
    const pendingA = await seedUser(tenantId, "pending-a", [UPDATE]);
    const readOnly = await seedUser(tenantId, "read-only", [READ]);
    const inactive = await seedUser(tenantId, "inactive", [UPDATE]);
    const scopedGrant = await seedUser(tenantId, "scoped-grant", [UPDATE]);
    const narrow = await seedUser(tenantId, "narrow", [READ, ASSIGN]);

    await holdScope(tenantId, inA.tenantUserId, brandA);
    await holdScope(tenantId, inB.tenantUserId, brandB);
    await holdScope(tenantId, pendingA.tenantUserId, brandA, "1 hour");
    await holdScope(tenantId, narrow.tenantUserId, brandA);
    await admin()`
      UPDATE awcms_tenant_users SET status = 'inactive'
      WHERE id = ${inactive.tenantUserId}
    `;
    await admin()`
      UPDATE awcms_access_policies SET scope_type = 'office', scope_id = ${brandA}
      WHERE tenant_id = ${tenantId} AND tenant_user_id = ${scopedGrant.tenantUserId}
    `;

    return {
      brandA,
      brandB,
      lead,
      wide,
      inA,
      inB,
      pendingA,
      readOnly,
      inactive,
      scopedGrant,
      narrow,
      convA: await seedConversation(tenantId, brandA),
      convB: await seedConversation(tenantId, brandB),
      convWide: await seedConversation(tenantId, null)
    };
  }

  test("lists exactly the people the assignment rule accepts, per conversation scope", async () => {
    const w = await world();
    const sorted = (...people: { tenantUserId: string }[]) =>
      [
        ownerTenantUserId,
        ...people.map((person) => person.tenantUserId)
      ].sort();

    expect(ids(await eligible(w.lead.token, w.convA))).toEqual(
      sorted(w.lead, w.wide, w.inA)
    );
    expect(ids(await eligible(w.lead.token, w.convB))).toEqual(
      sorted(w.lead, w.wide, w.inB)
    );
    // A tenant-wide conversation is never offered to a confined person.
    expect(ids(await eligible(w.lead.token, w.convWide))).toEqual(
      sorted(w.lead, w.wide)
    );

    // Never wider than the write-time authority: person by person, scope by scope.
    const everyone = (await admin()`
      SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId}
    `) as { id: string }[];

    for (const [conversation, scope] of [
      [w.convA, { type: "office", id: w.brandA }],
      [w.convB, { type: "office", id: w.brandB }],
      [w.convWide, null]
    ] as const) {
      const listed = new Set(ids(await eligible(w.lead.token, conversation)));

      for (const person of everyone) {
        const verdict = await withTenantOrThrow(
          getHandlerDatabaseClient(),
          tenantId,
          (tx) =>
            assigneeEligibility(
              tx,
              tenantId,
              person.id,
              scope,
              new Date(),
              officeScopeHierarchyPortAdapter
            )
        );

        // The list may be NARROWER than the rule (it also drops delegated
        // actors), but never wider.
        if (listed.has(person.id)) expect(verdict.eligible).toBe(true);
        else if (verdict.eligible) {
          // The only eligible-but-unlisted principals would be non-persons.
          const kind = (await admin()`
            SELECT principal_kind FROM awcms_tenant_users WHERE id = ${person.id}
          `) as { principal_kind: string }[];

          expect(kind[0]!.principal_kind).not.toBe("user");
        }
      }
    }
  });

  test("items carry a display name and an id and nothing else; no login identifier leaks", async () => {
    const w = await world();
    const page = await eligible(w.lead.token, w.convA);

    for (const item of page.body.data!.items) {
      expect(Object.keys(item).sort()).toEqual(["displayName", "tenantUserId"]);
    }
    expect(JSON.stringify(page.body)).not.toContain("@example.com");
  });

  test("a narrow caller (assign, confined to brand A) sees only brand A's candidates and never other brands or tenant-wide conversations", async () => {
    const w = await world();

    expect(ids(await eligible(w.narrow.token, w.convA))).toEqual(
      ids(await eligible(w.lead.token, w.convA))
    );

    const other = await eligible(w.narrow.token, w.convB);
    const wide = await eligible(w.narrow.token, w.convWide);
    const unknown = await eligible(w.narrow.token, crypto.randomUUID());

    expect(other.status).toBe(404);
    expect(wide.status).toBe(404);
    // Unknown and invisible are indistinguishable.
    expect(other.body).toEqual(unknown.body);
    expect(wide.body).toEqual(unknown.body);
  });

  test("a caller without `assign` is refused; another tenant's conversation is the same 404 as an unknown one", async () => {
    const w = await world();

    expect((await eligible(w.wide.token, w.convA)).status).toBe(403);
    expect((await eligible(w.readOnly.token, w.convA)).status).toBe(403);

    const tenant2 = crypto.randomUUID();

    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${tenant2}, 'eligible-two', 'Eligible Two')
    `;

    const foreignStaff = await seedUser(tenant2, "foreign", [UPDATE]);
    const foreignConversation = await seedConversation(tenant2, null);
    const foreign = await eligible(w.lead.token, foreignConversation);
    const unknown = await eligible(w.lead.token, crypto.randomUUID());

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(unknown.body);

    // Tenant B's staff never appear in tenant A's lists.
    expect(ids(await eligible(w.lead.token, w.convWide))).not.toContain(
      foreignStaff.tenantUserId
    );
  });

  test("deactivating a person removes them at once; a withdrawn customer's conversation offers nobody", async () => {
    const w = await world();

    expect(ids(await eligible(w.lead.token, w.convA))).toContain(
      w.inA.tenantUserId
    );

    await admin()`
      UPDATE awcms_tenant_users SET status = 'inactive'
      WHERE id = ${w.inA.tenantUserId}
    `;

    expect(ids(await eligible(w.lead.token, w.convA))).not.toContain(
      w.inA.tenantUserId
    );

    const withdrawn = await seedConversation(tenantId, w.brandA, "withdrawn");
    const page = await eligible(w.lead.token, withdrawn);

    expect(page.status).toBe(200);
    expect(page.body.data).toEqual({ items: [], nextCursor: null });
  });

  test("pagination is bounded and walks every person exactly once; bad queries are 400", async () => {
    const w = await world();

    for (let n = 0; n < 7; n += 1) {
      await seedUser(tenantId, `extra-${n}`, [UPDATE]);
    }

    const full = ids(await eligible(w.lead.token, w.convWide));
    const walked = await allPages(w.lead.token, w.convWide, 3);

    expect(walked.length).toBe(full.length);
    expect(new Set(walked).size).toBe(walked.length);
    expect([...walked].sort()).toEqual(full);
    expect(full.length).toBeGreaterThan(9);

    for (const query of [
      "?limit=0",
      "?limit=51",
      "?limit=x",
      "?cursor=not-a-cursor",
      "?q=anna"
    ]) {
      expect((await eligible(w.lead.token, w.convA, query)).status).toBe(400);
    }
  });
});
