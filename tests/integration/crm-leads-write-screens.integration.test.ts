/**
 * The loaders behind the five crm_leads WRITE screens (`/new`, `/deleted`,
 * `/{id}/edit`, `/{id}/merge`, `/{id}/conversion`), run through the REAL
 * `loadAdminScreen` chokepoint against a real PostgreSQL with real sessions
 * (Issue #1166, ADR-0153).
 *
 * Covers: default-deny per screen entry (a reader with `leads.read` alone is
 * denied on every write screen); the deployment switch; two tenants (a foreign
 * or soft-deleted lead is one `found: false`; another tenant's lead sharing the
 * same e-mail is never a merge candidate and a foreign deleted lead never
 * reaches the restore list); the masked view (no contact value, no customer or
 * evidence reference in anything a loader returns); the merge review end to end
 * through the real routes (candidate, merge, history, undo); the conversion
 * list after a real conversion; and the partial index the restore list depends
 * on.
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
import type { AccessAction } from "../../src/modules/identity-access/domain/access-control";
import type { CrmLeadsCan } from "../../src/modules/crm-leads/application/screen-loaders";
import {
  loadDeletedLeads,
  loadLeadConversion,
  loadLeadCreate,
  loadLeadEdit,
  loadLeadMerge
} from "../../src/modules/crm-leads/application/screen-write-loaders";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { PATCH as patchSettings } from "../../src/pages/api/v1/crm-leads/settings";
import { POST as createPipeline } from "../../src/pages/api/v1/crm-leads/pipelines/index";
import { POST as createLead } from "../../src/pages/api/v1/crm-leads/leads/index";
import { DELETE as deleteLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/index";
import { POST as moveLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/move";
import { POST as restoreLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/restore";
import { POST as mergeLeads } from "../../src/pages/api/v1/crm-leads/leads/merge";
import { POST as revertMerge } from "../../src/pages/api/v1/crm-leads/merges/[id]/revert";
import { POST as convertLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/conversions";

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
const FOREIGN_NAME = "Foreign Tenant Prospect";

const READ = "crm_leads.leads.read";

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

const G = (activityCode: string, action: AccessAction) =>
  ({ moduleKey: "crm_leads", activityCode, action }) as const;
const SCREEN = {
  read: G("leads", "read"),
  create: G("leads", "create"),
  update: G("leads", "update"),
  delete: G("leads", "delete"),
  restore: G("leads", "restore"),
  merge: G("merges", "manage"),
  approve: G("conversions", "approve"),
  manual: G("manual_conversions", "create")
};

/**
 * Runs one of the SCREENS' loaders the way the pages do: the real
 * `loadAdminScreen` chokepoint, one transaction, the viewer's real session.
 */
async function screen<T>(
  token: string,
  entry: ReturnType<typeof G>,
  run: (input: {
    context: Parameters<typeof loadLeadCreate>[0]["context"];
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

const create = (token: string) =>
  screen(token, SCREEN.create, ({ context }) => loadLeadCreate({ context }));
const edit = (token: string, leadId: string | null) =>
  screen(token, SCREEN.update, ({ context, can }) =>
    loadLeadEdit({ context, leadId, deleteGuard: SCREEN.delete, can })
  );
const deleted = (token: string) =>
  screen(token, SCREEN.restore, ({ context }) => loadDeletedLeads({ context }));
const merge = (token: string, leadId: string | null) =>
  screen(token, SCREEN.merge, ({ context }) =>
    loadLeadMerge({ context, leadId })
  );
const conversion = (token: string, leadId: string | null) =>
  screen(token, SCREEN.read, ({ context, can }) =>
    loadLeadConversion({
      context,
      leadId,
      approveGuard: SCREEN.approve,
      manualGuard: SCREEN.manual,
      can
    })
  );

/** Nothing a loader returns may carry a contact value or a reference the screens must not show. */
function expectNoSecrets(value: unknown, extra: string[] = []) {
  const text = JSON.stringify(value).toLowerCase();

  for (const secret of [
    SECRET_EMAIL,
    "externalcustomerref",
    "evidenceref",
    "value_encrypted",
    "value_hash",
    ...extra
  ]) {
    expect(text).not.toContain(secret.toLowerCase());
  }
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("crm_leads write screens (#1166, ADR-0153)", () => {
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

  test("default-deny: a reader with leads.read alone is denied on every write screen", async () => {
    const nobody = await seedUser(tenantId, "nobody", []);
    const reader = await seedUser(tenantId, "reader", [READ]);
    const id = crypto.randomUUID();

    for (const token of [nobody.token, reader.token]) {
      expect(await create(token)).toBe("denied");
      expect(await edit(token, id)).toBe("denied");
      expect(await deleted(token)).toBe("denied");
      expect(await merge(token, id)).toBe("denied");
    }

    // The conversion screen's entry is read; its AFFORDANCES are the probes.
    expect(await conversion(nobody.token, id)).toBe("denied");

    const shown = (await conversion(reader.token, id)) as any;

    expect(shown).toEqual({ enabled: true, found: false });
  });

  test("off by default: every write screen says so instead of failing, and reads nothing", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const lead = await newLead(pipeline.id, tenantId, ownerToken);

    process.env.CRM_LEADS_ENABLED = "false";

    expect(((await create(ownerToken)) as any).enabled).toBe(false);
    expect(((await create(ownerToken)) as any).pipelines).toEqual([]);
    expect(await edit(ownerToken, lead.id)).toEqual({ enabled: false });
    expect(((await deleted(ownerToken)) as any).leads).toEqual([]);
    expect(await merge(ownerToken, lead.id)).toEqual({ enabled: false });
    expect(await conversion(ownerToken, lead.id)).toEqual({ enabled: false });
  });

  test("create offers ACTIVE pipelines of the viewer's tenant only, and reports the tenant switch", async () => {
    const other = await newTenantWithPipeline();
    const mine = await newPipeline(tenantId, ownerToken, "mine");

    const off = (await create(ownerToken)) as any;

    expect(off.tenantEnabled).toBe(false);

    await enableTenant(tenantId, ownerToken);

    const on = (await create(ownerToken)) as any;

    expect(on.tenantEnabled).toBe(true);
    expect(on.pipelines.map((p: any) => p.id)).toEqual([mine.id]);
    expect(JSON.stringify(on)).not.toContain(other.pipelineId);
  });

  test("edit: a foreign, unknown and soft-deleted lead are one answer; no customer reference; the delete probe follows the chokepoint", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const mine = await newLead(pipeline.id, tenantId, ownerToken);
    const gone = await newLead(pipeline.id, tenantId, ownerToken);
    const other = await newTenantWithPipeline();
    const editor = await seedUser(tenantId, "editor", [
      "crm_leads.leads.update"
    ]);
    const remover = await seedUser(tenantId, "remover", [
      "crm_leads.leads.update",
      "crm_leads.leads.delete"
    ]);

    const removed = await call(deleteLead, {
      method: "DELETE",
      path: `${BASE}/leads/${gone.id}`,
      params: { id: gone.id },
      headers: { "if-match": `"${gone.version}"` }
    });

    expect(removed.status).toBe(200);

    const shown = (await edit(editor.token, mine.id)) as any;

    expect(shown.found).toBe(true);
    expect(shown.lead.displayName).toBe(SECRET_NAME);
    expect(shown.lead.contactPoints[0].masked).not.toContain("Screen.Prospect");
    expect("externalCustomerRef" in shown.lead).toBe(false);
    expect(shown.canDelete).toBe(false);
    expectNoSecrets(shown);
    expect(((await edit(remover.token, mine.id)) as any).canDelete).toBe(true);

    const answers = [
      await edit(editor.token, other.leadId),
      await edit(editor.token, gone.id),
      await edit(editor.token, crypto.randomUUID()),
      await edit(editor.token, null)
    ];

    for (const answer of answers) {
      expect(answer).toEqual({ enabled: true, found: false });
    }
  });

  test("deleted list: this tenant's soft-deleted leads only, masked; a restore through the real route removes it", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const live = await newLead(pipeline.id, tenantId, ownerToken, {
      displayName: "Still Live"
    });
    const gone = await newLead(pipeline.id, tenantId, ownerToken, {
      displayName: "Deleted Prospect"
    });
    const other = await newTenantWithPipeline({ deleteIt: true });

    expect(
      (
        await call(deleteLead, {
          method: "DELETE",
          path: `${BASE}/leads/${gone.id}`,
          params: { id: gone.id },
          headers: { "if-match": `"${gone.version}"` }
        })
      ).status
    ).toBe(200);

    const before = (await deleted(ownerToken)) as any;
    const ids = before.leads.map((lead: any) => lead.id);

    expect(ids).toEqual([gone.id]);
    expect(ids).not.toContain(live.id);
    expect(ids).not.toContain(other.leadId);
    expect(before.more).toBe(false);
    expect(before.leads[0].contactPoints[0].masked).not.toContain(
      "Screen.Prospect"
    );
    expectNoSecrets(before, [FOREIGN_NAME]);

    const restored = await call(restoreLead, {
      method: "POST",
      path: `${BASE}/leads/${gone.id}/restore`,
      params: { id: gone.id },
      body: { expectedVersion: before.leads[0].version }
    });

    expect(restored.status).toBe(200);
    expect(((await deleted(ownerToken)) as any).leads).toEqual([]);
  });

  test("the restore list's index is the partial one of sql/430", async () => {
    const rows = (await admin()`
      SELECT pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'awcms_crm_leads_deleted_list_idx'
    `) as { def: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.def).toContain("(tenant_id, created_at DESC, id DESC)");
    expect(rows[0]!.def).toContain("WHERE (deleted_at IS NOT NULL)");
  });

  test("merge review: candidates by exact contact, same tenant only, masked; merge and undo through the real routes", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken, "sales");
    const second = await newPipeline(tenantId, ownerToken, "support");
    const a = await newLead(pipeline.id, tenantId, ownerToken, {
      displayName: "Lead A"
    });
    const b = await newLead(pipeline.id, tenantId, ownerToken, {
      displayName: "Lead B"
    });
    const crossPipeline = await newLead(second.id, tenantId, ownerToken, {
      displayName: "Lead C"
    });
    const foreign = await newTenantWithPipeline({ sameEmail: true });
    const reviewer = await seedUser(tenantId, "reviewer", [
      "crm_leads.merges.manage"
    ]);

    const before = (await merge(reviewer.token, a.id)) as any;
    const ids = before.candidates.map((c: any) => c.lead.id);

    expect(before.found).toBe(true);
    expect(ids.sort()).toEqual([b.id, crossPipeline.id].sort());
    expect(ids).not.toContain(foreign.leadId);
    expect(
      before.candidates.find((c: any) => c.lead.id === b.id).samePipeline
    ).toBe(true);
    expect(
      before.candidates.find((c: any) => c.lead.id === crossPipeline.id)
        .samePipeline
    ).toBe(false);
    expect(before.candidates[0].matchedKinds).toEqual(["email"]);
    expect(before.merges).toEqual([]);
    expectNoSecrets(before, [FOREIGN_NAME]);

    const merged = await call(mergeLeads, {
      method: "POST",
      path: `${BASE}/leads/merge`,
      body: {
        survivorLeadId: a.id,
        absorbedLeadId: b.id,
        survivorVersion: a.version,
        absorbedVersion: b.version,
        note: "Same person, same address."
      }
    });

    expect(merged.status).toBe(201);

    const during = (await merge(reviewer.token, a.id)) as any;

    expect(during.merges).toHaveLength(1);
    expect(during.merges[0].survivorLeadId).toBe(a.id);
    expect(during.merges[0].absorbedLeadId).toBe(b.id);
    expect(during.merges[0].revertedAt).toBeNull();
    // The absorbed lead is no longer open, so it offers no candidate and shows the same merge.
    const absorbed = (await merge(reviewer.token, b.id)) as any;

    expect(absorbed.candidates).toEqual([]);
    expect(absorbed.merges[0].id).toBe(during.merges[0].id);

    const undone = await call(revertMerge, {
      method: "POST",
      path: `${BASE}/merges/${during.merges[0].id}/revert`,
      params: { id: during.merges[0].id }
    });

    expect(undone.status).toBe(200);

    const after = (await merge(reviewer.token, a.id)) as any;

    expect(after.merges[0].revertedAt).not.toBeNull();
    expect(after.candidates.map((c: any) => c.lead.id)).toContain(b.id);
  });

  test("conversion: the converted stages and the list, with no customer or evidence reference; affordances follow the chokepoint", async () => {
    await enableTenant(tenantId, ownerToken);
    const pipeline = await newPipeline(tenantId, ownerToken);
    const lead = await newLead(pipeline.id, tenantId, ownerToken);
    const moved = await call(moveLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/move`,
      params: { id: lead.id },
      body: { expectedVersion: lead.version, toStageKey: "contacted" }
    });

    expect(moved.status).toBe(200);

    const approver = await seedUser(tenantId, "approver", [
      READ,
      "crm_leads.conversions.approve"
    ]);
    const reader = await seedUser(tenantId, "reader", [READ]);
    const first = (await conversion(approver.token, lead.id)) as any;

    expect(first.found).toBe(true);
    expect(first.convertedStages.map((s: any) => s.key)).toEqual(["won"]);
    expect(first.conversions).toEqual([]);
    expect(first.canApprove).toBe(true);
    expect(first.canManual).toBe(false);

    const read = (await conversion(reader.token, lead.id)) as any;

    expect(read.canApprove).toBe(false);
    expect(read.canManual).toBe(false);

    const converted = await call(convertLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/conversions`,
      params: { id: lead.id },
      body: {
        mode: "authority_confirmed",
        expectedVersion: moved.body.data!.version,
        externalCustomerRef: "cust-secret-ref-77",
        evidenceRef: "evidence-secret-ref-88",
        toStageKey: "won"
      }
    });

    expect(converted.status).toBe(201);

    const after = (await conversion(approver.token, lead.id)) as any;

    expect(after.conversions).toHaveLength(1);
    expect(Object.keys(after.conversions[0]).sort()).toEqual([
      "id",
      "mode",
      "occurredAt",
      "reversedAt"
    ]);
    expect(after.conversions[0].mode).toBe("authority_confirmed");
    expectNoSecrets(after, ["cust-secret-ref-77", "evidence-secret-ref-88"]);
  });

  test("a foreign lead is 'not found' on the merge and conversion screens", async () => {
    await enableTenant(tenantId, ownerToken);
    const foreign = await newTenantWithPipeline();

    expect(await merge(ownerToken, foreign.leadId)).toEqual({
      enabled: true,
      found: false
    });
    expect(await conversion(ownerToken, foreign.leadId)).toEqual({
      enabled: true,
      found: false
    });
  });
});

/**
 * A second tenant with its own pipeline and one lead (optionally deleted, or
 * carrying the SAME e-mail as the viewer's leads), written as the admin role
 * so the viewer's session never sees it.
 */
async function newTenantWithPipeline(
  options: { deleteIt?: boolean; sameEmail?: boolean } = {}
): Promise<{ pipelineId: string; leadId: string }> {
  const sql = admin();
  const exists = (await sql`
    SELECT 1 AS present FROM awcms_tenants WHERE id = ${OTHER_TENANT}
  `) as unknown[];

  if (exists.length === 0) {
    await sql`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${OTHER_TENANT}, 'crm-write-other', 'Other Tenant')
    `;
  }

  const otherOwner = await seedUser(OTHER_TENANT, "other-owner", [
    "crm_leads.pipelines.configure",
    "crm_leads.leads.create",
    "crm_leads.leads.delete"
  ]);

  await enableTenant(OTHER_TENANT, otherOwner.token);
  const pipeline = await newPipeline(OTHER_TENANT, otherOwner.token, "other");
  const lead = await newLead(pipeline.id, OTHER_TENANT, otherOwner.token, {
    displayName: FOREIGN_NAME,
    contactPoints: [
      {
        kind: "email",
        value: options.sameEmail ? SECRET_EMAIL : "foreign@example.test"
      }
    ]
  });

  if (options.deleteIt) {
    const removed = await call(deleteLead, {
      method: "DELETE",
      path: `${BASE}/leads/${lead.id}`,
      params: { id: lead.id },
      token: otherOwner.token,
      tenant: OTHER_TENANT,
      headers: { "if-match": `"${lead.version}"` }
    });

    expect(removed.status).toBe(200);
  }

  return { pipelineId: pipeline.id, leadId: lead.id };
}
