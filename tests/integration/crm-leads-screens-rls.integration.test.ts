/**
 * The RLS layer under the `/admin/crm-leads` loaders, as the REAL runtime role
 * (Issue #1166, audit L-3).
 *
 * `crm-leads-screens.integration.test.ts` drives the handler database, where
 * the connection may be a superuser and RLS cannot be observed: dropping a
 * loader's explicit `tenant_id` predicate stays green there. This file runs the
 * same loaders on world 1 as the non-superuser `awcms_app`, with the tenant
 * GUC on the WRONG tenant and the loaders asked about tenant A's rows. Each
 * must answer empty, which only the policy can cause.
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
  appRoleActivated,
  getAdminSql,
  getAppRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { CRM_LEADS_GUARDS } from "../../src/modules/crm-leads/domain/crm-leads-constants";
import {
  loadCrmSettings,
  loadLeadDetail,
  loadLeadList
} from "../../src/modules/crm-leads/application/screen-loaders";

const TENANT_A = "a1166000-0000-4000-8000-0000000000a1";
const TENANT_B = "a1166000-0000-4000-8000-0000000000b1";
const USER_A = "a1166000-0000-4000-8000-0000000000a2";
const USER_B = "a1166000-0000-4000-8000-0000000000b2";
let leadId = "";
let pipelineId = "";
let savedEnabled: string | undefined;

async function seed(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'crm-rls-a', 'CRM RLS A'),
           (${TENANT_B}, 'crm-rls-b', 'CRM RLS B')
  `;

  for (const [id, tenant, label] of [
    [USER_A, TENANT_A, "a"],
    [USER_B, TENANT_B, "b"]
  ] as const) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenant}, 'person', ${`Profile ${label}`})
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenant}, ${profile[0]!.id}, ${`crm-rls-${label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${id}, ${tenant}, ${identity[0]!.id})
    `;
  }

  // The revision and its first stage reference each other and the guards make
  // a published revision immutable, so this fixture is written in ONE
  // transaction with triggers and deferred checks off (superuser seed only;
  // every READ below is by awcms_app, under RLS).
  await admin.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;

    const pipeline = (await tx`
      INSERT INTO awcms_crm_pipelines (tenant_id, code, name, current_revision_number)
      VALUES (${TENANT_A}, 'rls-pipe', 'RLS pipeline', 1)
      RETURNING id
    `) as { id: string }[];

    pipelineId = pipeline[0]!.id;

    const revision = (await tx`
      INSERT INTO awcms_crm_pipeline_revisions
        (tenant_id, pipeline_id, revision_number, initial_stage_key,
         definition_hash, published_by)
      VALUES (${TENANT_A}, ${pipelineId}, 1, 'new_lead',
              ${"0".repeat(64)}, ${USER_A})
      RETURNING id
    `) as { id: string }[];

    await tx`
      INSERT INTO awcms_crm_pipeline_stages
        (tenant_id, revision_id, stage_key, name, position, category)
      VALUES (${TENANT_A}, ${revision[0]!.id}, 'new_lead', 'New', 1, 'new')
    `;

    const lead = (await tx`
      INSERT INTO awcms_crm_leads
        (tenant_id, pipeline_id, revision_id, stage_key, stage_category,
         display_name)
      VALUES (${TENANT_A}, ${pipelineId}, ${revision[0]!.id}, 'new_lead',
              'new', 'RLS Prospect')
      RETURNING id
    `) as { id: string }[];

    leadId = lead[0]!.id;
  });
}

const suite = integrationEnabled ? describe : describe.skip;
const can = async () => true;
const guard = CRM_LEADS_GUARDS.configurePipelines;

suite("crm_leads screens: RLS as awcms_app (#1166 audit L-3)", () => {
  beforeAll(async () => {
    savedEnabled = process.env.CRM_LEADS_ENABLED;
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    if (savedEnabled === undefined) delete process.env.CRM_LEADS_ENABLED;
    else process.env.CRM_LEADS_ENABLED = savedEnabled;

    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    process.env.CRM_LEADS_ENABLED = "true";
    await resetDatabase();
    await seed();
  });

  test("with the GUC on the wrong tenant, the loaders asked about tenant A see nothing", async () => {
    if (!appRoleActivated) {
      console.warn("SKIP awcms_app RLS assertion: role not activated.");
      return;
    }

    const app = getAppRoleSql();

    // Control: the right GUC sees the lead, so the empty answers below are the
    // policy's doing and not a broken fixture.
    const own = await withTenantOrThrow(app, TENANT_A, async (tx) => ({
      list: await loadLeadList({
        context: { tx, tenantId: TENANT_A, me: USER_A },
        filters: {},
        configureGuard: guard,
        can
      }),
      detail: await loadLeadDetail({
        context: { tx, tenantId: TENANT_A, me: USER_A },
        leadId,
        moveGuard: guard,
        assignGuard: guard,
        can
      })
    }));

    expect((own.list as any).leads).toHaveLength(1);
    expect((own.detail as any).found).toBe(true);

    const foreign = await withTenantOrThrow(app, TENANT_B, async (tx) => {
      const context = { tx, tenantId: TENANT_A, me: USER_B };

      return {
        list: await loadLeadList({
          context,
          filters: {},
          configureGuard: guard,
          can
        }),
        detail: await loadLeadDetail({
          context,
          leadId,
          moveGuard: guard,
          assignGuard: guard,
          can
        }),
        settings: await loadCrmSettings({ context, pipelineId })
      };
    });

    expect((foreign.list as any).leads).toEqual([]);
    expect((foreign.list as any).pipelines).toEqual([]);
    expect(foreign.detail).toEqual({ enabled: true, found: false });
    expect((foreign.settings as any).pipelines).toEqual([]);
    expect((foreign.settings as any).selected).toBeNull();
  });
});
