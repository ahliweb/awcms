/**
 * The loaders behind `/admin/crm-leads`, `/admin/crm-leads/[id]` and
 * `/admin/crm-leads/settings`, run through the REAL `loadAdminScreen`
 * chokepoint against a real PostgreSQL with real sessions (Issue #1166,
 * ADR-0153, ADR-0149).
 *
 * Covers: default-deny (a user with no role is `denied`, and the settings
 * screen needs `pipelines.configure`, not just `leads.read`); the deployment
 * switch (the screens say "off", they do not fail); two tenants (the other
 * tenant's lead, pipeline and settings never reach the viewer, and a foreign or
 * unknown id is the same `found: false` as a soft-deleted lead); the masked
 * view (no contact value, name-free staff identity, no customer reference in
 * anything a loader returns); the affordances (`canMove`/`canAssign` follow the
 * chokepoint per permission); the filters and the first-source column; and the
 * history after a real move through the real route.
 *
 * The lead pipeline has no business-scope confinement today (every permission
 * is tenant-wide, ADR-0153 README "Not built"), so there is no confined viewer
 * to test: the confinement that exists is the TENANT, and it is what the
 * mutation-sensitive assertions below hold.
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
  loadCrmSettings,
  loadLeadDetail,
  loadLeadList,
  type CrmLeadsCan
} from "../../src/modules/crm-leads/application/screen-loaders";
import { CRM_LEADS_GUARDS } from "../../src/modules/crm-leads/domain/crm-leads-constants";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { PATCH as patchSettings } from "../../src/pages/api/v1/crm-leads/settings";
import { POST as createPipeline } from "../../src/pages/api/v1/crm-leads/pipelines/index";
import { POST as createLead } from "../../src/pages/api/v1/crm-leads/leads/index";
import { DELETE as deleteLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/index";
import { POST as moveLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/move";
import { POST as assignLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/assign";

setDefaultTimeout(60_000);

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const BASE = "/api/v1/crm-leads";
const RING_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const HASH_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 17) % 251)
).toString("base64");
const OTHER_TENANT = "a1166000-0000-4000-8000-0000000000cc";
const SECRET_EMAIL = "Screen.Prospect@Example.test";
const SECRET_NAME = "Screen Prospect";
const SECRET_REASON = "reason-typed-by-staff";
const FOREIGN_NAME = "Foreign Tenant Prospect";

const READ = "crm_leads.leads.read";
const MOVE = "crm_leads.stages.update";
const ASSIGN = "crm_leads.leads.assign";
const CONFIGURE = "crm_leads.pipelines.configure";
const ALL = [
  READ,
  MOVE,
  ASSIGN,
  CONFIGURE,
  "crm_leads.leads.create",
  "crm_leads.leads.delete"
];

type Envelope<T = any> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: any };
};

let tenantId = "";
let ownerToken = "";
let keyCounter = 0;
let userCounter = 0;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();
const nextKey = () => `idem-${(keyCounter += 1)}-${crypto.randomUUID()}`;

async function bootstrap() {
  const loginIdentifier = "crm-screen-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "CRM Screens Co",
      tenantCode: "crm-screens",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  tenantId = setup.body.data.tenantId;

  const login = await invoke<{ data: { token: string } }>(authLogin, {
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
  ownerToken = login.body.data.token;
}

async function seedUser(
  forTenant: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${forTenant}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${forTenant}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${forTenant}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `crmscr-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level, last_authenticated_at)
    VALUES (${forTenant}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${forTenant}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
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
        VALUES (${forTenant}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), forTenant, (tx) =>
      grantRolePolicy(tx, forTenant, {
        tenantUserId: tenantUser[0]!.id,
        roleId: role[0]!.id,
        grantedByTenantUserId: null,
        reason: "crm leads screens fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

function call<T = any>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string;
    tenant?: string;
    headers?: Record<string, string>;
  }
) {
  const mutating = (options.method ?? "GET") !== "GET";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": options.tenant ?? tenantId,
    authorization: `Bearer ${options.token ?? ownerToken}`,
    ...(options.headers ?? {})
  };

  if (mutating) headers["idempotency-key"] = nextKey();

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.path,
    headers,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-screens-1166" }
  });
}

/** A NEUTRAL example catalogue (ADR-0153 T-L1): no product vocabulary. */
const DEFINITION = {
  initialStageKey: "new",
  stages: [
    { key: "new", name: "New", category: "new" },
    { key: "contacted", name: "Contacted", category: "working" },
    { key: "won", name: "Won", category: "converted" },
    { key: "lost", name: "Lost", category: "lost" }
  ],
  transitions: [
    { from: "new", to: "contacted" },
    { from: "contacted", to: "won" },
    { from: "contacted", to: "lost", guards: ["owner_assigned"] }
  ]
};

async function enableTenant(forTenant: string, token: string) {
  const res = await call(patchSettings, {
    method: "PATCH",
    path: `${BASE}/settings`,
    body: { enabled: true },
    token,
    tenant: forTenant
  });

  expect(res.status).toBe(200);
}

async function newPipeline(
  forTenant: string,
  token: string,
  code = "sales"
): Promise<any> {
  const res = await call(createPipeline, {
    method: "POST",
    path: `${BASE}/pipelines`,
    body: {
      code,
      name: `Pipeline ${code}`,
      timeZone: "Asia/Jakarta",
      definition: DEFINITION
    },
    token,
    tenant: forTenant
  });

  expect(res.status).toBe(201);

  return res.body.data;
}

async function newLead(
  pipelineId: string,
  forTenant: string,
  token: string,
  over: Record<string, unknown> = {}
): Promise<any> {
  const res = await call(createLead, {
    method: "POST",
    path: `${BASE}/leads`,
    body: {
      pipelineId,
      displayName: SECRET_NAME,
      contactPoints: [{ kind: "email", value: SECRET_EMAIL }],
      source: { kind: "manual" },
      ...over
    },
    token,
    tenant: forTenant
  });

  expect(res.status).toBe(201);

  return res.body.data;
}

const G = (
  activityCode: string,
  action: "read" | "update" | "assign" | "configure"
) => ({ moduleKey: "crm_leads", activityCode, action }) as const;
const SCREEN = {
  read: G("leads", "read"),
  move: G("stages", "update"),
  assign: G("leads", "assign"),
  configure: G("pipelines", "configure")
};

/**
 * Runs one of the SCREENS' loaders the way the pages do: the real
 * `loadAdminScreen` chokepoint, one transaction, the viewer's real session.
 */
async function screen<T>(
  token: string,
  entry: ReturnType<typeof G>,
  run: (input: {
    context: Parameters<typeof loadLeadList>[0]["context"];
    can: CrmLeadsCan;
  }) => Promise<T>
): Promise<T | "denied" | "error"> {
  const tokenHash = hashSessionToken(token);
  const outcome = await loadAdminScreen({
    ssr: { tenantId, tokenHash } as unknown as SsrContext,
    sql: getHandlerDatabaseClient(),
    workClass: "interactive",
    authorize: entry,
    load: ({ tx, auth, can }) =>
      run({
        context: { tx, tenantId, me: auth.context.tenantUserId },
        can
      }),
    onError: () => {}
  });

  return outcome.state === "allowed" ? outcome.data : outcome.state;
}

const list = (token: string, filters: Record<string, string> = {}) =>
  screen(token, SCREEN.read, ({ context, can }) =>
    loadLeadList({
      context,
      filters,
      configureGuard: SCREEN.configure,
      can
    })
  );
const detail = (token: string, leadId: string | null) =>
  screen(token, SCREEN.read, ({ context, can }) =>
    loadLeadDetail({
      context,
      leadId,
      moveGuard: SCREEN.move,
      assignGuard: SCREEN.assign,
      can
    })
  );
const settingsScreen = (token: string, pipelineId: string | null = null) =>
  screen(token, SCREEN.configure, ({ context }) =>
    loadCrmSettings({ context, pipelineId })
  );

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("crm_leads admin screens (#1166, ADR-0153)", () => {
  beforeAll(async () => {
    for (const name of [
      "CRM_LEADS_ENABLED",
      "CRM_LEADS_ENCRYPTION_KEYS",
      "CRM_LEADS_HASH_KEYS"
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
    process.env.CRM_LEADS_ENABLED = "true";
    process.env.CRM_LEADS_ENCRYPTION_KEYS = `k1:${RING_KEY}`;
    process.env.CRM_LEADS_HASH_KEYS = `h1:${HASH_KEY}`;
    await resetHandlerDatabase();
    await bootstrap();
  });

  test("the screens' guards are the module's own", () => {
    expect(SCREEN.read).toEqual(CRM_LEADS_GUARDS.readLeads);
    expect(SCREEN.move).toEqual(CRM_LEADS_GUARDS.moveLeads);
    expect(SCREEN.assign).toEqual(CRM_LEADS_GUARDS.assignLeads);
    expect(SCREEN.configure).toEqual(CRM_LEADS_GUARDS.configurePipelines);
  });

  test("default-deny: no role is denied everywhere, and settings need configure, not read", async () => {
    const nobody = await seedUser(tenantId, "nobody", []);
    const reader = await seedUser(tenantId, "reader", [READ]);

    expect(await list(nobody.token)).toBe("denied");
    expect(await detail(nobody.token, crypto.randomUUID())).toBe("denied");
    expect(await settingsScreen(nobody.token)).toBe("denied");
    expect(await settingsScreen(reader.token)).toBe("denied");
    expect(await list(reader.token)).not.toBe("denied");
  });

  test("off by default: every screen says so instead of failing, and reads nothing", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const lead = await newLead(pipeline.id, tenantId, ownerToken);

    process.env.CRM_LEADS_ENABLED = "false";

    const listed = (await list(ownerToken)) as any;
    const shown = (await detail(ownerToken, lead.id)) as any;
    const configured = (await settingsScreen(ownerToken)) as any;

    expect(listed.enabled).toBe(false);
    expect(listed.leads).toEqual([]);
    expect(shown).toEqual({ enabled: false });
    expect(configured.enabled).toBe(false);
    expect(configured.settings).toBeNull();
    expect(configured.pipelines).toEqual([]);
  });

  test("the list shows the viewer's tenant only, live leads only, masked, with the first source", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const mine = await newLead(pipeline.id, tenantId, ownerToken);
    const gone = await newLead(pipeline.id, tenantId, ownerToken, {
      displayName: "Deleted Prospect",
      contactPoints: [{ kind: "email", value: "gone@example.test" }]
    });
    const del = await call(deleteLead, {
      method: "DELETE",
      path: `${BASE}/leads/${gone.id}`,
      params: { id: gone.id },
      headers: { "if-match": `"${gone.version}"` }
    });

    expect(del.status).toBe(200);

    // The same email in ANOTHER tenant, with its own lead.
    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${OTHER_TENANT}, 'crm-screens-other', 'crm-screens-other')
    `;
    const other = await seedUser(OTHER_TENANT, "other", ALL);
    await enableTenant(OTHER_TENANT, other.token);
    const otherPipeline = await newPipeline(OTHER_TENANT, other.token);
    const foreign = await newLead(otherPipeline.id, OTHER_TENANT, other.token, {
      displayName: FOREIGN_NAME
    });

    const viewer = (await list(ownerToken)) as any;
    const ids = viewer.leads.map((lead: any) => lead.id);

    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(foreign.id);
    expect(viewer.pipelines.map((entry: any) => entry.id)).toEqual([
      pipeline.id
    ]);
    expect(viewer.tenantEnabled).toBe(true);
    expect(viewer.me).toBeTruthy();

    const row = viewer.leads.find((lead: any) => lead.id === mine.id);

    expect(row.sourceKind).toBe("manual");
    expect(row.stageCategory).toBe("new");
    expect(row.contactPoints).toHaveLength(1);
    expect(row.contactPoints[0].masked).not.toContain("Screen.Prospect");

    // Nothing a loader returns carries the contact value, the other tenant's
    // name, or a ciphertext/hash.
    const serialized = JSON.stringify(viewer);

    expect(serialized).not.toContain(SECRET_EMAIL);
    expect(serialized.toLowerCase()).not.toContain(SECRET_EMAIL.toLowerCase());
    expect(serialized).not.toContain(FOREIGN_NAME);
    expect(serialized).not.toMatch(/valueHash|valueEncrypted|value_hash/);

    // A soft-deleted lead is not listed (it is not asked for).
    expect(ids).not.toContain(gone.id);

    // The other tenant sees only its own.
    const tokenHash = hashSessionToken(other.token);
    const foreignView = await loadAdminScreen({
      ssr: { tenantId: OTHER_TENANT, tokenHash } as unknown as SsrContext,
      sql: getHandlerDatabaseClient(),
      workClass: "interactive",
      authorize: SCREEN.read,
      load: ({ tx, auth, can }) =>
        loadLeadList({
          context: {
            tx,
            tenantId: OTHER_TENANT,
            me: auth.context.tenantUserId
          },
          filters: {},
          configureGuard: SCREEN.configure,
          can
        }),
      onError: () => {}
    });

    expect(foreignView.state).toBe("allowed");
    expect(
      foreignView.state === "allowed"
        ? foreignView.data.leads.map((lead) => lead.id)
        : []
    ).toEqual([foreign.id]);
  });

  test("filters: pipeline, stage category and owner are applied in SQL; an unknown value is no filter", async () => {
    await enableTenant(tenantId, ownerToken);
    const one = await newPipeline(tenantId, ownerToken, "one");
    const two = await newPipeline(tenantId, ownerToken, "two");
    const first = await newLead(one.id, tenantId, ownerToken, {
      displayName: "In One"
    });
    const second = await newLead(two.id, tenantId, ownerToken, {
      displayName: "In Two",
      contactPoints: [{ kind: "email", value: "two@example.test" }]
    });
    const moved = await call(moveLead, {
      method: "POST",
      path: `${BASE}/leads/${second.id}/move`,
      params: { id: second.id },
      body: { expectedVersion: second.version, toStageKey: "contacted" }
    });

    expect(moved.status).toBe(200);

    const byPipeline = (await list(ownerToken, { pipeline: one.id })) as any;
    const byCategory = (await list(ownerToken, { category: "working" })) as any;
    const junk = (await list(ownerToken, {
      pipeline: "not-a-uuid",
      category: "bogus",
      owner: "someone"
    })) as any;

    expect(byPipeline.leads.map((lead: any) => lead.id)).toEqual([first.id]);
    expect(byCategory.leads.map((lead: any) => lead.id)).toEqual([second.id]);
    expect(junk.leads).toHaveLength(2);

    // Owner "me": nobody owns anything yet; after assigning one lead to the viewer, only it.
    expect(((await list(ownerToken, { owner: "me" })) as any).leads).toEqual(
      []
    );

    const viewer = (await list(ownerToken)) as any;
    const assigned = await call(assignLead, {
      method: "POST",
      path: `${BASE}/leads/${first.id}/assign`,
      params: { id: first.id },
      body: { expectedVersion: first.version, ownerTenantUserId: viewer.me }
    });

    expect(assigned.status).toBe(200);
    expect(
      ((await list(ownerToken, { owner: "me" })) as any).leads.map(
        (lead: any) => lead.id
      )
    ).toEqual([first.id]);
  });

  test("the detail: history after a real move, the pipeline's edges, and a foreign, deleted or unknown id is one answer", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const lead = await newLead(pipeline.id, tenantId, ownerToken);

    const moved = await call(moveLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/move`,
      params: { id: lead.id },
      body: {
        expectedVersion: lead.version,
        toStageKey: "contacted",
        reason: SECRET_REASON
      }
    });

    expect(moved.status).toBe(200);

    const shown = (await detail(ownerToken, lead.id)) as any;

    expect(shown.enabled).toBe(true);
    expect(shown.found).toBe(true);
    expect(shown.lead.stageKey).toBe("contacted");
    expect(shown.lead.version).toBe(moved.body.data.version);
    expect(shown.canMove).toBe(true);
    expect(shown.canAssign).toBe(true);
    expect(shown.tenantEnabled).toBe(true);
    expect(shown.history.transitions.map((row: any) => row.kind)).toEqual([
      "created",
      "moved"
    ]);
    expect(shown.history.touches).toHaveLength(1);
    expect(
      shown.revision.transitions.map((e: any) => `${e.from}>${e.to}`)
    ).toContain("contacted>lost");
    expect(JSON.stringify(shown)).not.toContain(SECRET_EMAIL);

    // Unknown, null and soft-deleted ids answer identically.
    const missing = await detail(ownerToken, crypto.randomUUID());
    const nothing = await detail(ownerToken, null);

    expect(missing).toEqual({ enabled: true, found: false });
    expect(nothing).toEqual({ enabled: true, found: false });

    const deleted = await call(deleteLead, {
      method: "DELETE",
      path: `${BASE}/leads/${lead.id}`,
      params: { id: lead.id },
      headers: { "if-match": `"${moved.body.data.version}"` }
    });

    expect(deleted.status).toBe(200);
    expect(await detail(ownerToken, lead.id)).toEqual({
      enabled: true,
      found: false
    });
  });

  test("merged and anonymised leads are not listed, and the detail never carries the customer reference (audit L-1, L-2)", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const survivor = await newLead(pipeline.id, tenantId, ownerToken, {
      displayName: "Survivor"
    });
    const absorbed = await newLead(pipeline.id, tenantId, ownerToken, {
      displayName: "Absorbed",
      contactPoints: [{ kind: "email", value: "absorbed@example.test" }]
    });
    const anon = await newLead(pipeline.id, tenantId, ownerToken, {
      displayName: "Erased",
      contactPoints: [{ kind: "email", value: "erased@example.test" }]
    });

    await admin()`
      UPDATE awcms_crm_leads
      SET status = 'merged', merged_into_lead_id = ${survivor.id}
      WHERE tenant_id = ${tenantId} AND id = ${absorbed.id}
    `;
    await admin()`
      UPDATE awcms_crm_leads
      SET status = 'anonymized', anonymized_at = now(), display_name = NULL
      WHERE tenant_id = ${tenantId} AND id = ${anon.id}
    `;
    // A customer reference is only legal beside a live conversion; the guard is
    // bypassed for this fixture so the detail has a value it must not return.
    await admin().begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        UPDATE awcms_crm_leads SET external_customer_ref = 'cust-ref-1'
        WHERE tenant_id = ${tenantId} AND id = ${survivor.id}
      `;
    });

    const shown = (await list(ownerToken)) as any;

    expect(shown.leads.map((lead: any) => lead.id)).toEqual([survivor.id]);

    const one = (await detail(ownerToken, survivor.id)) as any;

    expect(one.found).toBe(true);
    expect("externalCustomerRef" in one.lead).toBe(false);
    expect(JSON.stringify(one)).not.toContain("cust-ref-1");
  });

  test("a lead of another tenant is 'not found', not an error and not data", async () => {
    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${OTHER_TENANT}, 'crm-screens-other', 'crm-screens-other')
    `;
    const other = await seedUser(OTHER_TENANT, "other", ALL);
    await enableTenant(OTHER_TENANT, other.token);
    const otherPipeline = await newPipeline(OTHER_TENANT, other.token);
    const foreign = await newLead(otherPipeline.id, OTHER_TENANT, other.token, {
      displayName: FOREIGN_NAME
    });

    expect(await detail(ownerToken, foreign.id)).toEqual({
      enabled: true,
      found: false
    });

    // The settings screen does not follow a pipeline id from another tenant.
    await enableTenant(tenantId, ownerToken);
    const mine = await newPipeline(tenantId, ownerToken, "mine");
    const shown = (await settingsScreen(ownerToken, otherPipeline.id)) as any;

    expect(shown.selected.id).toBe(mine.id);
    expect(shown.pipelines.map((entry: any) => entry.id)).toEqual([mine.id]);
    expect(JSON.stringify(shown)).not.toContain(otherPipeline.id);
  });

  test("the affordances follow the chokepoint per permission", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const lead = await newLead(pipeline.id, tenantId, ownerToken);
    const readOnly = await seedUser(tenantId, "read-only", [READ]);
    const mover = await seedUser(tenantId, "mover", [READ, MOVE]);
    const assigner = await seedUser(tenantId, "assigner", [READ, ASSIGN]);

    const asReadOnly = (await detail(readOnly.token, lead.id)) as any;
    const asMover = (await detail(mover.token, lead.id)) as any;
    const asAssigner = (await detail(assigner.token, lead.id)) as any;

    expect([asReadOnly.canMove, asReadOnly.canAssign]).toEqual([false, false]);
    expect([asMover.canMove, asMover.canAssign]).toEqual([true, false]);
    expect([asAssigner.canMove, asAssigner.canAssign]).toEqual([false, true]);

    // The list links to settings only for someone who may configure.
    expect(((await list(readOnly.token)) as any).canConfigure).toBe(false);
    expect(((await list(ownerToken)) as any).canConfigure).toBe(true);
  });

  test("the tenant switch is reported, and the settings screen shows one catalogue with its edges", async () => {
    const pipeline = await newPipeline(tenantId, ownerToken, "catalogue");
    const off = (await settingsScreen(ownerToken)) as any;

    expect(off.enabled).toBe(true);
    expect(off.settings.enabled).toBe(false);
    expect(off.selected.id).toBe(pipeline.id);
    expect(off.selected.currentRevision.stages.map((s: any) => s.key)).toEqual([
      "new",
      "contacted",
      "won",
      "lost"
    ]);
    expect(off.selected.currentRevision.transitions).toHaveLength(3);

    await enableTenant(tenantId, ownerToken);

    expect(((await settingsScreen(ownerToken)) as any).settings.enabled).toBe(
      true
    );
    expect(((await list(ownerToken)) as any).tenantEnabled).toBe(true);
  });
});
