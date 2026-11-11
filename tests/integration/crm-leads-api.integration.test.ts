/**
 * The HTTP surface of `crm_leads`, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #1166, ADR-0153 test matrix).
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every route,
 *     and every guard BITES (a user holding every permission but one is refused
 *     that action), which also proves each guard names a seeded permission;
 *   * the three switches: deployment (503 after authorization), tenant (409);
 *   * T-D1 duplicate intake (same source key) and Idempotency-Key replay;
 *   * T-S1 stage transition race: two concurrent moves, one wins, the other 409;
 *     an edge that does not exist and an unmet guard are refused;
 *   * versioned catalog: a revision that removes an occupied stage is refused
 *     unless the leads are migrated explicitly; the database refuses editing a
 *     published stage;
 *   * T-C1 conversion confirmation, replay, reversal, flagged manual conversion;
 *   * T-M1 merge, rollback, second rollback refused;
 *   * T-I1 two tenants with the same email: no cross-tenant candidate, a
 *     cross-tenant merge is a 404;
 *   * T-P1 no contact value, name, reason or note in any event, audit row or
 *     idempotency row; anonymising erasure keeps the funnel facts.
 *
 * Gated on `DATABASE_URL`.
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
import { crmLeadsModule } from "../../src/modules/crm-leads/module";
import { createCrmLeadPortAdapter } from "../../src/modules/crm-leads/application/crm-lead-port-adapter";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import {
  GET as getSettings,
  PATCH as patchSettings
} from "../../src/pages/api/v1/crm-leads/settings";
import {
  GET as listPipelines,
  POST as createPipeline
} from "../../src/pages/api/v1/crm-leads/pipelines/index";
import { GET as getPipeline } from "../../src/pages/api/v1/crm-leads/pipelines/[id]/index";
import { POST as publishRevision } from "../../src/pages/api/v1/crm-leads/pipelines/[id]/revisions";
import {
  GET as listLeads,
  POST as createLead
} from "../../src/pages/api/v1/crm-leads/leads/index";
import { POST as lookupLeads } from "../../src/pages/api/v1/crm-leads/leads/lookup";
import { POST as mergeLeads } from "../../src/pages/api/v1/crm-leads/leads/merge";
import {
  DELETE as deleteLead,
  GET as getLead,
  PATCH as patchLead
} from "../../src/pages/api/v1/crm-leads/leads/[id]/index";
import { POST as restoreLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/restore";
import { POST as anonymizeLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/anonymize";
import { POST as addTouch } from "../../src/pages/api/v1/crm-leads/leads/[id]/touches";
import { POST as moveLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/move";
import { POST as assignLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/assign";
import { GET as getCandidates } from "../../src/pages/api/v1/crm-leads/leads/[id]/candidates";
import { POST as convertLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/conversions";
import { POST as manualConvertLead } from "../../src/pages/api/v1/crm-leads/leads/[id]/manual-conversions";
import { POST as reverseConversion } from "../../src/pages/api/v1/crm-leads/conversions/[id]/reverse";
import { POST as revertMerge } from "../../src/pages/api/v1/crm-leads/merges/[id]/revert";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const BASE = "/api/v1/crm-leads";
const RING_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const HASH_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 17) % 251)
).toString("base64");
const OTHER_TENANT = "a1166000-0000-4000-8000-0000000000bb";
const SECRET_EMAIL = "Prospect.Person@Example.test";
const SECRET_NAME = "Prospect Secretname";
const SECRET_NOTE = "confidential-note-zebra";

type Envelope<T = any> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: any };
};

let env: { tenantId: string; token: string };
let keyCounter = 0;
let userCounter = 0;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();
const nextKey = () => `idem-${(keyCounter += 1)}-${crypto.randomUUID()}`;

async function bootstrap() {
  const loginIdentifier = "crm-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "CRM Co",
      tenantCode: "crm-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
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

  return { tenantId, token: login.body.data.token };
}

async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `crm-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level, last_authenticated_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  if (permissionKeys.length > 0) {
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

      if (!permission[0]) {
        throw new Error(`fixture: permission ${key} is not in the catalogue`);
      }

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
        reason: "crm leads fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

const ALL_PERMISSIONS = (crmLeadsModule.permissions ?? []).map(
  (p) => `crm_leads.${p.activityCode}.${p.action}`
);

function call<T = any>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string | null;
    idempotencyKey?: string | null;
    query?: string;
    headers?: Record<string, string>;
    tenantId?: string;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? nextKey()
      : options.idempotencyKey;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": options.tenantId ?? env.tenantId,
    ...(options.headers ?? {})
  };

  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-api-1166" }
  });
}

/** A NEUTRAL example catalog (ADR-0153 T-L1): no product vocabulary. */
const DEFINITION = {
  initialStageKey: "new",
  stages: [
    { key: "new", name: "New", category: "new" },
    { key: "contacted", name: "Contacted", category: "working" },
    { key: "qualified", name: "Qualified", category: "qualified" },
    { key: "won", name: "Won", category: "converted" },
    { key: "lost", name: "Lost", category: "lost" }
  ],
  transitions: [
    { from: "new", to: "contacted" },
    { from: "contacted", to: "qualified", guards: ["owner_assigned"] },
    { from: "qualified", to: "won" },
    { from: "new", to: "lost", guards: ["reason_required"] },
    { from: "contacted", to: "lost" }
  ]
};

async function enableTenant(token?: string) {
  const res = await call(patchSettings, {
    method: "PATCH",
    path: `${BASE}/settings`,
    body: { enabled: true },
    token
  });
  expect(res.status).toBe(200);
}

async function newPipeline(code = "sales"): Promise<any> {
  const res = await call(createPipeline, {
    method: "POST",
    path: `${BASE}/pipelines`,
    body: {
      code,
      name: "Sales",
      timeZone: "Asia/Jakarta",
      definition: DEFINITION
    }
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function newLead(
  pipelineId: string,
  over: Record<string, unknown> = {},
  source: Record<string, unknown> = { kind: "manual" }
): Promise<any> {
  const res = await call(createLead, {
    method: "POST",
    path: `${BASE}/leads`,
    body: {
      pipelineId,
      displayName: SECRET_NAME,
      contactPoints: [{ kind: "email", value: SECRET_EMAIL }],
      source,
      ...over
    }
  });
  expect([200, 201]).toContain(res.status);
  return res.body.data;
}

async function move(
  lead: { id: string; version: number },
  to: string,
  extra: Record<string, unknown> = {}
) {
  return call(moveLead, {
    method: "POST",
    path: `${BASE}/leads/${lead.id}/move`,
    params: { id: lead.id },
    body: { expectedVersion: lead.version, toStageKey: to, ...extra }
  });
}

async function persistedText(): Promise<string> {
  const rows = (await admin()`
    SELECT to_jsonb(t)::text AS row FROM awcms_audit_events t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_idempotency_keys t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_domain_events t
  `) as { row: string }[];

  return rows.map((entry) => entry.row).join("\n");
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("crm_leads HTTP surface (Issue #1166)", () => {
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
    if (!handlerReady) return;

    process.env.CRM_LEADS_ENABLED = "true";
    process.env.CRM_LEADS_ENCRYPTION_KEYS = `k1:${RING_KEY}`;
    process.env.CRM_LEADS_HASH_KEYS = `h1:${HASH_KEY}`;
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  const routes = (ids: { lead: string; other: string }) => [
    {
      name: "settings get",
      permission: "crm_leads.leads.read",
      run: (t: string | null) =>
        call(getSettings, { path: `${BASE}/settings`, token: t })
    },
    {
      name: "settings patch",
      permission: "crm_leads.pipelines.configure",
      run: (t: string | null) =>
        call(patchSettings, {
          method: "PATCH",
          path: `${BASE}/settings`,
          body: { enabled: true },
          token: t
        })
    },
    {
      name: "pipelines list",
      permission: "crm_leads.leads.read",
      run: (t: string | null) =>
        call(listPipelines, { path: `${BASE}/pipelines`, token: t })
    },
    {
      name: "pipeline create",
      permission: "crm_leads.pipelines.configure",
      run: (t: string | null) =>
        call(createPipeline, {
          method: "POST",
          path: `${BASE}/pipelines`,
          body: { code: "x1", name: "X", definition: DEFINITION },
          token: t
        })
    },
    {
      name: "pipeline get",
      permission: "crm_leads.leads.read",
      run: (t: string | null) =>
        call(getPipeline, {
          path: `${BASE}/pipelines/${ids.other}`,
          params: { id: ids.other },
          token: t
        })
    },
    {
      name: "revision publish",
      permission: "crm_leads.pipelines.configure",
      run: (t: string | null) =>
        call(publishRevision, {
          method: "POST",
          path: `${BASE}/pipelines/${ids.other}/revisions`,
          params: { id: ids.other },
          body: { expectedVersion: 1, definition: DEFINITION },
          token: t
        })
    },
    {
      name: "leads list",
      permission: "crm_leads.leads.read",
      run: (t: string | null) =>
        call(listLeads, { path: `${BASE}/leads`, token: t })
    },
    {
      name: "lead create",
      permission: "crm_leads.leads.create",
      run: (t: string | null) =>
        call(createLead, {
          method: "POST",
          path: `${BASE}/leads`,
          body: { pipelineId: ids.other, source: { kind: "manual" } },
          token: t
        })
    },
    {
      name: "lookup",
      permission: "crm_leads.leads.read",
      run: (t: string | null) =>
        call(lookupLeads, {
          method: "POST",
          path: `${BASE}/leads/lookup`,
          body: { kind: "email", value: "a@b.test" },
          token: t
        })
    },
    {
      name: "merge",
      permission: "crm_leads.merges.manage",
      run: (t: string | null) =>
        call(mergeLeads, {
          method: "POST",
          path: `${BASE}/leads/merge`,
          body: {
            survivorLeadId: ids.lead,
            absorbedLeadId: ids.other,
            survivorVersion: 1,
            absorbedVersion: 1,
            note: "n"
          },
          token: t
        })
    },
    {
      name: "lead get",
      permission: "crm_leads.leads.read",
      run: (t: string | null) =>
        call(getLead, {
          path: `${BASE}/leads/${ids.lead}`,
          params: { id: ids.lead },
          token: t
        })
    },
    {
      name: "lead patch",
      permission: "crm_leads.leads.update",
      run: (t: string | null) =>
        call(patchLead, {
          method: "PATCH",
          path: `${BASE}/leads/${ids.lead}`,
          params: { id: ids.lead },
          body: { expectedVersion: 1, displayName: "X" },
          token: t
        })
    },
    {
      name: "lead delete",
      permission: "crm_leads.leads.delete",
      run: (t: string | null) =>
        call(deleteLead, {
          method: "DELETE",
          path: `${BASE}/leads/${ids.lead}`,
          params: { id: ids.lead },
          headers: { "if-match": '"1"' },
          token: t
        })
    },
    {
      name: "lead restore",
      permission: "crm_leads.leads.restore",
      run: (t: string | null) =>
        call(restoreLead, {
          method: "POST",
          path: `${BASE}/leads/${ids.lead}/restore`,
          params: { id: ids.lead },
          body: { expectedVersion: 1 },
          token: t
        })
    },
    {
      name: "lead anonymize",
      permission: "crm_leads.leads.delete",
      run: (t: string | null) =>
        call(anonymizeLead, {
          method: "POST",
          path: `${BASE}/leads/${ids.lead}/anonymize`,
          params: { id: ids.lead },
          token: t
        })
    },
    {
      name: "touch",
      permission: "crm_leads.leads.update",
      run: (t: string | null) =>
        call(addTouch, {
          method: "POST",
          path: `${BASE}/leads/${ids.lead}/touches`,
          params: { id: ids.lead },
          body: { source: { kind: "manual" } },
          token: t
        })
    },
    {
      name: "move",
      permission: "crm_leads.stages.update",
      run: (t: string | null) =>
        call(moveLead, {
          method: "POST",
          path: `${BASE}/leads/${ids.lead}/move`,
          params: { id: ids.lead },
          body: { expectedVersion: 1, toStageKey: "contacted" },
          token: t
        })
    },
    {
      name: "assign",
      permission: "crm_leads.leads.assign",
      run: (t: string | null) =>
        call(assignLead, {
          method: "POST",
          path: `${BASE}/leads/${ids.lead}/assign`,
          params: { id: ids.lead },
          body: { expectedVersion: 1, ownerTenantUserId: null },
          token: t
        })
    },
    {
      name: "candidates",
      permission: "crm_leads.leads.read",
      run: (t: string | null) =>
        call(getCandidates, {
          path: `${BASE}/leads/${ids.lead}/candidates`,
          params: { id: ids.lead },
          token: t
        })
    },
    {
      name: "convert",
      permission: "crm_leads.conversions.approve",
      run: (t: string | null) =>
        call(convertLead, {
          method: "POST",
          path: `${BASE}/leads/${ids.lead}/conversions`,
          params: { id: ids.lead },
          body: {
            mode: "authority_confirmed",
            expectedVersion: 1,
            externalCustomerRef: "c-1",
            evidenceRef: "e-1"
          },
          token: t
        })
    },
    {
      name: "manual convert",
      permission: "crm_leads.manual_conversions.create",
      run: (t: string | null) =>
        call(manualConvertLead, {
          method: "POST",
          path: `${BASE}/leads/${ids.lead}/manual-conversions`,
          params: { id: ids.lead },
          body: {
            mode: "authority_unconfirmed",
            expectedVersion: 1,
            evidenceRef: "e-2",
            note: "n"
          },
          token: t
        })
    },
    {
      name: "reverse",
      permission: "crm_leads.conversions.approve",
      run: (t: string | null) =>
        call(reverseConversion, {
          method: "POST",
          path: `${BASE}/conversions/${ids.other}/reverse`,
          params: { id: ids.other },
          body: { evidenceRef: "r-1" },
          token: t
        })
    },
    {
      name: "revert merge",
      permission: "crm_leads.merges.manage",
      run: (t: string | null) =>
        call(revertMerge, {
          method: "POST",
          path: `${BASE}/merges/${ids.other}/revert`,
          params: { id: ids.other },
          token: t
        })
    }
  ];

  test("default deny: 401 without a token, 403 without a role, and every guard bites", async () => {
    const ids = { lead: crypto.randomUUID(), other: crypto.randomUUID() };
    const nobody = await seedUser(env.tenantId, "nobody", []);

    for (const route of routes(ids)) {
      expect({
        route: route.name,
        status: (await route.run(null)).status
      }).toEqual({ route: route.name, status: 401 });
      expect({
        route: route.name,
        status: (await route.run(nobody.token)).status
      }).toEqual({ route: route.name, status: 403 });

      const allButOne = await seedUser(
        env.tenantId,
        "allbut",
        ALL_PERMISSIONS.filter((p) => p !== route.permission)
      );
      expect({
        route: route.name,
        status: (await route.run(allButOne.token)).status
      }).toEqual({ route: route.name, status: 403 });
    }
  });

  test("deployment switch answers 503 after authorization; tenant switch refuses lead writes", async () => {
    process.env.CRM_LEADS_ENABLED = "false";
    const nobody = await seedUser(env.tenantId, "nobody", []);

    expect(
      (await call(listLeads, { path: `${BASE}/leads`, token: nobody.token }))
        .status
    ).toBe(403);
    expect((await call(listLeads, { path: `${BASE}/leads` })).status).toBe(503);

    process.env.CRM_LEADS_ENABLED = "true";
    const pipeline = await newPipeline();
    const refused = await call(createLead, {
      method: "POST",
      path: `${BASE}/leads`,
      body: { pipelineId: pipeline.id, source: { kind: "manual" } }
    });

    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("CRM_LEADS_TENANT_DISABLED");
  });

  test("T-D1: a duplicate source event yields the same lead; an Idempotency-Key replay answers the stored response", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const source = { kind: "api", externalEventId: "hook-123" };
    const first = await newLead(pipeline.id, {}, source);
    const second = await newLead(pipeline.id, { displayName: "Other" }, source);

    expect(second.id).toBe(first.id);
    expect(second.duplicate).toBe(true);
    // L6: a replay tells a `leads.create` holder the id, nothing more.
    expect(Object.keys(second).sort()).toEqual(["duplicate", "id"]);

    const count =
      (await admin()`SELECT count(*)::int AS n FROM awcms_crm_leads`) as {
        n: number;
      }[];
    expect(count[0]!.n).toBe(1);

    const key = nextKey();
    const body = { pipelineId: pipeline.id, source: { kind: "manual" } };
    const a = await call(createLead, {
      method: "POST",
      path: `${BASE}/leads`,
      body,
      idempotencyKey: key
    });
    const b = await call(createLead, {
      method: "POST",
      path: `${BASE}/leads`,
      body,
      idempotencyKey: key
    });
    const c = await call(createLead, {
      method: "POST",
      path: `${BASE}/leads`,
      body: { ...body, displayName: "Z" },
      idempotencyKey: key
    });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(c.status).toBe(409);

    // An import or api source must carry its own event id.
    const missing = await call(createLead, {
      method: "POST",
      path: `${BASE}/leads`,
      body: { pipelineId: pipeline.id, source: { kind: "import" } }
    });
    expect(missing.status).toBe(400);
  });

  test("T-S1: an edge that does not exist and an unmet guard are refused; two concurrent moves, one wins", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const lead = await newLead(pipeline.id);

    const noEdge = await move(lead, "qualified");
    expect(noEdge.body.error?.code).toBe("TRANSITION_NOT_ALLOWED");

    const guard = await move(lead, "lost");
    expect(guard.status).toBe(409);
    expect(guard.body.error?.details?.guards).toEqual(["reason_required"]);

    const intoConverted = await call(moveLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/move`,
      params: { id: lead.id },
      body: { expectedVersion: lead.version, toStageKey: "won" }
    });
    expect(intoConverted.body.error?.code).toBe("CONVERSION_REQUIRED");

    const [left, right] = await Promise.all([
      move(lead, "contacted"),
      move(lead, "lost", { reason: "not now" })
    ]);
    const statuses = [left.status, right.status].sort();

    expect(statuses).toEqual([200, 409]);
    const loser = left.status === 409 ? left : right;
    expect(loser.body.error?.code).toBe("VERSION_CONFLICT");

    const transitions = (await admin()`
      SELECT count(*)::int AS n FROM awcms_crm_lead_transitions WHERE lead_id = ${lead.id}
    `) as { n: number }[];
    expect(transitions[0]!.n).toBe(2);
  });

  test("versioned catalog: removing an occupied stage needs an explicit migration; published stages are immutable", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const lead = await newLead(pipeline.id);
    const moved = await move(lead, "contacted");
    expect(moved.status).toBe(200);

    const next = {
      ...DEFINITION,
      stages: DEFINITION.stages
        .filter((s) => s.key !== "contacted")
        .concat([{ key: "engaged", name: "Engaged", category: "working" }]),
      transitions: [
        { from: "new", to: "engaged" },
        { from: "engaged", to: "qualified" },
        { from: "qualified", to: "won" }
      ]
    };
    const refused = await call(publishRevision, {
      method: "POST",
      path: `${BASE}/pipelines/${pipeline.id}/revisions`,
      params: { id: pipeline.id },
      body: { expectedVersion: 1, definition: next }
    });

    expect(refused.status).toBe(409);
    expect(refused.body.error?.details?.stageKeys).toEqual(["contacted"]);

    const published = await call(publishRevision, {
      method: "POST",
      path: `${BASE}/pipelines/${pipeline.id}/revisions`,
      params: { id: pipeline.id },
      body: {
        expectedVersion: 1,
        definition: next,
        stageMigrations: { contacted: "engaged" }
      }
    });

    expect(published.status).toBe(201);
    expect(published.body.data.currentRevisionNumber).toBe(2);
    expect(published.body.data.migratedLeadCount).toBe(1);

    const after = await call(getLead, {
      path: `${BASE}/leads/${lead.id}`,
      params: { id: lead.id }
    });
    expect(after.body.data.stageKey).toBe("engaged");
    expect(after.body.data.history.transitions.map((t: any) => t.kind)).toEqual(
      ["created", "moved", "stage_migrated"]
    );

    const stale = await call(publishRevision, {
      method: "POST",
      path: `${BASE}/pipelines/${pipeline.id}/revisions`,
      params: { id: pipeline.id },
      body: { expectedVersion: 1, definition: DEFINITION }
    });
    expect(stale.body.error?.code).toBe("VERSION_CONFLICT");

    await expect(
      admin()`UPDATE awcms_crm_pipeline_stages SET name = 'Hacked' WHERE stage_key = 'new'`
    ).rejects.toThrow();
  });

  test("T-C1: confirmation, replay, reversal and a flagged manual conversion", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const owner = await seedUser(env.tenantId, "owner", []);
    let lead = await newLead(pipeline.id, {
      ownerTenantUserId: owner.tenantUserId
    });

    lead = (await move(lead, "contacted")).body.data;
    lead = (await move(lead, "qualified")).body.data;

    const confirm = (version: number) =>
      call(convertLead, {
        method: "POST",
        path: `${BASE}/leads/${lead.id}/conversions`,
        params: { id: lead.id },
        body: {
          mode: "authority_confirmed",
          expectedVersion: version,
          externalCustomerRef: "cust-9",
          evidenceRef: "invoice-77"
        }
      });
    const converted = await confirm(lead.version);

    expect(converted.status).toBe(201);
    expect(converted.body.data.stageCategory).toBe("converted");
    expect(converted.body.data.externalCustomerRef).toBe("cust-9");

    const replay = await confirm(lead.version);
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);

    const conversionId = converted.body.data.conversionId;
    const reversed = await call(reverseConversion, {
      method: "POST",
      path: `${BASE}/conversions/${conversionId}/reverse`,
      params: { id: conversionId },
      body: { evidenceRef: "refund-1" }
    });

    expect(reversed.status).toBe(200);
    expect(reversed.body.data.stageKey).toBe("qualified");
    expect(reversed.body.data.externalCustomerRef).toBeNull();

    const again = await call(reverseConversion, {
      method: "POST",
      path: `${BASE}/conversions/${conversionId}/reverse`,
      params: { id: conversionId },
      body: { evidenceRef: "refund-2" }
    });
    expect(again.body.error?.code).toBe("ALREADY_REVERSED");

    const manual = await call(manualConvertLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/manual-conversions`,
      params: { id: lead.id },
      body: {
        mode: "authority_unconfirmed",
        expectedVersion: reversed.body.data.version,
        evidenceRef: "signed-form-3",
        note: SECRET_NOTE
      }
    });
    expect(manual.status).toBe(201);

    const modes = (await admin()`
      SELECT mode FROM awcms_crm_lead_conversions WHERE lead_id = ${lead.id} ORDER BY recorded_at
    `) as { mode: string }[];
    expect(modes.map((m) => m.mode)).toEqual([
      "authority_confirmed",
      "authority_unconfirmed"
    ]);

    // History is never edited: the conversion record cannot be rewritten.
    await expect(
      admin()`UPDATE awcms_crm_lead_conversions SET evidence_ref = 'x' WHERE lead_id = ${lead.id}`
    ).rejects.toThrow();

    // The port answers the same lead state with opaque ids only.
    const state = await withTenantOrThrow(
      getHandlerDatabaseClient(),
      env.tenantId,
      (tx) =>
        createCrmLeadPortAdapter().readLeadState(tx, env.tenantId, lead.id)
    );
    expect(state?.stageCategory).toBe("converted");
    expect(JSON.stringify(state)).not.toContain(SECRET_NAME);
  });

  test("T-M1 and T-I1: merge, rollback, second rollback refused; another tenant's lead is never a candidate or a merge target", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const a = await newLead(pipeline.id);
    const b = await newLead(pipeline.id, {
      contactPoints: [{ kind: "email", value: SECRET_EMAIL.toLowerCase() }]
    });

    // The other tenant holds the SAME email.
    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${OTHER_TENANT}, 'crm-other', 'crm-other')
    `;
    const otherOwner = await seedUser(OTHER_TENANT, "other", ALL_PERMISSIONS);
    await call(patchSettings, {
      method: "PATCH",
      path: `${BASE}/settings`,
      body: { enabled: true },
      token: otherOwner.token,
      tenantId: OTHER_TENANT
    });
    const otherPipeline = await call(createPipeline, {
      method: "POST",
      path: `${BASE}/pipelines`,
      body: { code: "sales", name: "S", definition: DEFINITION },
      token: otherOwner.token,
      tenantId: OTHER_TENANT
    });
    const foreign = await call(createLead, {
      method: "POST",
      path: `${BASE}/leads`,
      body: {
        pipelineId: otherPipeline.body.data.id,
        contactPoints: [{ kind: "email", value: SECRET_EMAIL }],
        source: { kind: "manual" }
      },
      token: otherOwner.token,
      tenantId: OTHER_TENANT
    });
    expect(foreign.status).toBe(201);

    const candidates = await call(getCandidates, {
      path: `${BASE}/leads/${a.id}/candidates`,
      params: { id: a.id }
    });
    expect(candidates.body.data.items.map((c: any) => c.leadId)).toEqual([
      b.id
    ]);
    expect(candidates.body.data.items[0].matchedKinds).toEqual(["email"]);

    const lookup = await call(lookupLeads, {
      method: "POST",
      path: `${BASE}/leads/lookup`,
      body: { kind: "email", value: SECRET_EMAIL }
    });
    expect(lookup.body.data.items.map((m: any) => m.leadId).sort()).toEqual(
      [a.id, b.id].sort()
    );

    const crossTenant = await call(mergeLeads, {
      method: "POST",
      path: `${BASE}/leads/merge`,
      body: {
        survivorLeadId: a.id,
        absorbedLeadId: foreign.body.data.id,
        survivorVersion: 1,
        absorbedVersion: 1,
        note: "x"
      }
    });
    expect(crossTenant.status).toBe(404);

    const merged = await call(mergeLeads, {
      method: "POST",
      path: `${BASE}/leads/merge`,
      body: {
        survivorLeadId: a.id,
        absorbedLeadId: b.id,
        survivorVersion: a.version,
        absorbedVersion: b.version,
        note: SECRET_NOTE
      }
    });
    expect(merged.status).toBe(201);

    const absorbed = await call(getLead, {
      path: `${BASE}/leads/${b.id}`,
      params: { id: b.id }
    });
    expect(absorbed.body.data.status).toBe("merged");

    const mergeId = merged.body.data.mergeId;
    const revert = () =>
      call(revertMerge, {
        method: "POST",
        path: `${BASE}/merges/${mergeId}/revert`,
        params: { id: mergeId }
      });
    expect((await revert()).status).toBe(200);

    const restored = await call(getLead, {
      path: `${BASE}/leads/${b.id}`,
      params: { id: b.id }
    });
    expect(restored.body.data.status).toBe("open");
    expect(restored.body.data.contactPoints).toHaveLength(1);

    const second = await revert();
    expect(second.body.error?.code).toBe("ALREADY_REVERTED");
  });

  test("T-P1: no contact value, name or note in any event, audit or idempotency row; erasure keeps funnel facts", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const lead = await newLead(pipeline.id);
    const moved = await move(lead, "lost", { reason: SECRET_NOTE });
    expect(moved.status).toBe(200);

    const list = await call(listLeads, { path: `${BASE}/leads` });
    const masked = list.body.data.items[0].contactPoints[0].masked as string;
    expect(masked).not.toContain("prospect.person");
    expect(masked).toContain("@example.test");

    const anonymized = await call(anonymizeLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/anonymize`,
      params: { id: lead.id }
    });
    expect(anonymized.status).toBe(200);

    const after = await call(getLead, {
      path: `${BASE}/leads/${lead.id}`,
      params: { id: lead.id }
    });
    expect(after.body.data.displayName).toBeNull();
    expect(after.body.data.status).toBe("anonymized");
    expect(after.body.data.contactPoints[0].erased).toBe(true);
    expect(after.body.data.history.transitions).toHaveLength(2);
    expect(after.body.data.history.transitions[1].reason).toBeNull();
    expect(after.body.data.history.touches).toHaveLength(1);

    const text = (await persistedText()).toLowerCase();
    expect(text).not.toContain(SECRET_EMAIL.toLowerCase());
    expect(text).not.toContain(SECRET_NAME.toLowerCase());
    expect(text).not.toContain(SECRET_NOTE);
    // L1: not even the MASKED form survives in a stored replay body.
    expect(text).not.toContain(masked.toLowerCase());
    expect(text).not.toContain("@example.test");

    const events = (await admin()`
      SELECT event_type, payload FROM awcms_domain_events
      WHERE producer_module = 'crm_leads' ORDER BY event_sequence
    `) as { event_type: string; payload: Record<string, unknown> }[];
    expect(events.map((e) => e.event_type)).toEqual([
      "awcms.crm_leads.lead.created",
      "awcms.crm_leads.lead.stage_changed",
      "awcms.crm_leads.lead.lost"
    ]);
    for (const event of events) {
      expect(event.payload.privacyClass).toBe("pseudonymous");
    }

    const ciphertext = (await admin()`
      SELECT count(*)::int AS n FROM awcms_crm_lead_contact_points
      WHERE lead_id = ${lead.id} AND value_encrypted IS NOT NULL
    `) as { n: number }[];
    expect(ciphertext[0]!.n).toBe(0);
  });

  test("soft delete needs If-Match and is restorable; assignment validates the owner", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const lead = await newLead(pipeline.id);

    const noMatch = await call(deleteLead, {
      method: "DELETE",
      path: `${BASE}/leads/${lead.id}`,
      params: { id: lead.id }
    });
    expect(noMatch.status).toBe(428);

    const deleted = await call(deleteLead, {
      method: "DELETE",
      path: `${BASE}/leads/${lead.id}`,
      params: { id: lead.id },
      headers: { "if-match": `"${lead.version}"` }
    });
    expect(deleted.status).toBe(200);
    expect(
      (await call(listLeads, { path: `${BASE}/leads` })).body.data.items
    ).toHaveLength(0);

    const restored = await call(restoreLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/restore`,
      params: { id: lead.id },
      body: { expectedVersion: lead.version + 1 }
    });
    expect(restored.status).toBe(200);

    const bogus = await call(assignLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/assign`,
      params: { id: lead.id },
      body: {
        expectedVersion: lead.version + 2,
        ownerTenantUserId: crypto.randomUUID()
      }
    });
    expect(bogus.body.error?.code).toBe("OWNER_NOT_FOUND");

    const owner = await seedUser(env.tenantId, "own", []);
    const assigned = await call(assignLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/assign`,
      params: { id: lead.id },
      body: {
        expectedVersion: lead.version + 2,
        ownerTenantUserId: owner.tenantUserId
      }
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.ownerTenantUserId).toBe(owner.tenantUserId);

    const touch = await call(addTouch, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/touches`,
      params: { id: lead.id },
      body: {
        source: {
          kind: "api",
          externalEventId: "later-1",
          utmSource: "newsletter"
        }
      }
    });
    expect(touch.status).toBe(201);
    expect(touch.body.data.touchNumber).toBe(2);
    const replay = await call(addTouch, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/touches`,
      params: { id: lead.id },
      body: { source: { kind: "api", externalEventId: "later-1" } }
    });
    expect(replay.body.data.duplicate).toBe(true);

    await expect(
      admin()`UPDATE awcms_crm_lead_source_touches SET utm_source = 'x' WHERE touch_number = 1`
    ).rejects.toThrow();
  });

  /** A lead walked to `qualified` (with an owner, for the guard) and optionally converted. */
  async function qualifiedLead(pipelineId: string): Promise<any> {
    const owner = await seedUser(env.tenantId, "own", []);
    let lead = await newLead(pipelineId, {
      ownerTenantUserId: owner.tenantUserId,
      contactPoints: []
    });
    lead = (await move(lead, "contacted")).body.data;
    return (await move(lead, "qualified")).body.data;
  }

  function convert(lead: any, evidenceRef: string) {
    return call(convertLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/conversions`,
      params: { id: lead.id },
      body: {
        mode: "authority_confirmed",
        expectedVersion: lead.version,
        externalCustomerRef: "cust-1",
        evidenceRef
      }
    });
  }

  test("audit M1: a revision migration never moves a converted lead out of converted; the database enforces converted <=> live conversion", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const lead = await qualifiedLead(pipeline.id);
    const converted = await convert(lead, "inv-1");
    expect(converted.status).toBe(201);

    // `won` is replaced by `won2`: the converted lead must go to a converted stage.
    const next = {
      ...DEFINITION,
      stages: DEFINITION.stages
        .filter((s) => s.key !== "won")
        .concat([{ key: "won2", name: "Won 2", category: "converted" }]),
      transitions: DEFINITION.transitions
        .filter((t) => t.to !== "won")
        .concat([{ from: "qualified", to: "won2" }])
    };
    const publish = (stageMigrations: Record<string, string>) =>
      call(publishRevision, {
        method: "POST",
        path: `${BASE}/pipelines/${pipeline.id}/revisions`,
        params: { id: pipeline.id },
        body: { expectedVersion: 1, definition: next, stageMigrations }
      });

    for (const target of ["contacted", "lost"]) {
      const refused = await publish({ won: target });
      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe(
        "CONVERTED_STAGE_MIGRATION_REFUSED"
      );
      expect(refused.body.error?.details?.stageKeys).toEqual(["won"]);
    }

    const stillConverted = (await admin()`
      SELECT stage_key, stage_category, external_customer_ref
      FROM awcms_crm_leads WHERE id = ${lead.id}
    `) as any[];
    expect(stillConverted[0]).toEqual({
      stage_key: "won",
      stage_category: "converted",
      external_customer_ref: "cust-1"
    });

    const lostEvents = (await admin()`
      SELECT count(*)::int AS n FROM awcms_domain_events
      WHERE event_type = 'awcms.crm_leads.lead.lost'
    `) as { n: number }[];
    expect(lostEvents[0]!.n).toBe(0);

    // converted -> converted (a renamed won stage) is allowed.
    const ok = await publish({ won: "won2" });
    expect(ok.status).toBe(201);
    const moved = (await admin()`
      SELECT stage_key, stage_category FROM awcms_crm_leads WHERE id = ${lead.id}
    `) as any[];
    expect(moved[0]).toEqual({
      stage_key: "won2",
      stage_category: "converted"
    });

    // The database refuses an inconsistent lead even from a privileged role
    // (deferred constraint triggers, checked at commit): a customer reference
    // without a live conversion, and a converted lead whose conversion is
    // reversed behind its back.
    const plain = await qualifiedLead(pipeline.id);

    await expect(
      admin().begin(async (tx) => {
        await tx`
          UPDATE awcms_crm_leads SET external_customer_ref = 'x-1'
          WHERE id = ${plain.id}
        `;
      })
    ).rejects.toThrow();

    await expect(
      admin().begin(async (tx) => {
        await tx`
          UPDATE awcms_crm_lead_conversions
          SET reversed_at = now(), reversal_evidence_ref = 'r-x',
              reversal_occurred_at = now(), reversed_by = recorded_by
          WHERE lead_id = ${lead.id}
        `;
      })
    ).rejects.toThrow();
  });

  test("audit L3: concurrent conversions with one evidence reference answer 201 and 409, never 500", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const a = await qualifiedLead(pipeline.id);
    const b = await qualifiedLead(pipeline.id);
    const [x, y] = await Promise.all([
      convert(a, "same-ev"),
      convert(b, "same-ev")
    ]);

    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect((x.status === 409 ? x : y).body.error?.code).toBe("EVIDENCE_REUSED");
  });

  test("audit L4: includeDeleted needs leads.restore or leads.delete on top of leads.read", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const lead = await newLead(pipeline.id);
    const deleted = await call(deleteLead, {
      method: "DELETE",
      path: `${BASE}/leads/${lead.id}`,
      params: { id: lead.id },
      headers: { "if-match": `"${lead.version}"` }
    });
    expect(deleted.status).toBe(200);

    const reader = await seedUser(env.tenantId, "reader", [
      "crm_leads.leads.read"
    ]);
    const restorer = await seedUser(env.tenantId, "restorer", [
      "crm_leads.leads.read",
      "crm_leads.leads.restore"
    ]);
    const query = "includeDeleted=true";

    expect(
      (
        await call(listLeads, {
          path: `${BASE}/leads`,
          query,
          token: reader.token
        })
      ).status
    ).toBe(403);
    expect(
      (await call(listLeads, { path: `${BASE}/leads`, token: reader.token }))
        .body.data.items
    ).toHaveLength(0);

    const visible = await call(listLeads, {
      path: `${BASE}/leads`,
      query,
      token: restorer.token
    });
    expect(visible.status).toBe(200);
    expect(visible.body.data.items).toHaveLength(1);
  });

  test("audit L5: the tenant switch refuses soft delete and restore, but never erasure", async () => {
    await enableTenant();
    const pipeline = await newPipeline();
    const lead = await newLead(pipeline.id);
    const off = await call(patchSettings, {
      method: "PATCH",
      path: `${BASE}/settings`,
      body: { enabled: false }
    });
    expect(off.status).toBe(200);

    const deleted = await call(deleteLead, {
      method: "DELETE",
      path: `${BASE}/leads/${lead.id}`,
      params: { id: lead.id },
      headers: { "if-match": `"${lead.version}"` }
    });
    expect(deleted.body.error?.code).toBe("CRM_LEADS_TENANT_DISABLED");

    const restored = await call(restoreLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/restore`,
      params: { id: lead.id },
      body: { expectedVersion: lead.version }
    });
    expect(restored.body.error?.code).toBe("CRM_LEADS_TENANT_DISABLED");

    const erased = await call(anonymizeLead, {
      method: "POST",
      path: `${BASE}/leads/${lead.id}/anonymize`,
      params: { id: lead.id }
    });
    expect(erased.status).toBe(200);
  });

  test("audit L7: a body over the module's 32 KiB ceiling is refused before any work", async () => {
    await enableTenant();
    const big = await call(createLead, {
      method: "POST",
      path: `${BASE}/leads`,
      body: {
        pipelineId: crypto.randomUUID(),
        displayName: "x".repeat(40 * 1024),
        source: { kind: "manual" }
      }
    });
    expect(big.status).toBe(413);
  });
});
