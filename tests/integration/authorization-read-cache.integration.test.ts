/**
 * An admin screen makes eleven authorization decisions and reads the same rows
 * eleven times — finding B1 of the 17 August 2026 audit round.
 *
 * ## Measured, on a real database
 *
 * `/admin/blog` calls `can()` ten times on top of its entry decision. Each is a
 * full `authorizeInTransaction`, on ONE reserved `interactive` connection out of
 * eight process-wide:
 *
 *   | | queries | wall time |
 *   | --- | --- | --- |
 *   | before | **89** | 47 ms |
 *   | after  | **29** | 23 ms |
 *
 * ## The two things this file has to prove, in this order
 *
 * 1. **The decisions do not change.** A cache that is faster and answers
 *    differently is not an optimisation, it is a security defect with a
 *    benchmark attached. Every case below compares the cached run against the
 *    uncached one decision by decision, including a DENY.
 * 2. **The cache is opt-in for a reason.** A caller that writes and then
 *    re-authorizes must see its own write. That is asserted directly: grant a
 *    permission mid-transaction, re-authorize without a cache, and watch the
 *    answer change — which is exactly what would NOT happen if the cache lived
 *    inside `authorizeInTransaction`.
 *
 * Only then does the query count matter, and it is asserted in both directions
 * so neither number can drift into meaninglessness.
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
import { countQueries } from "./query-budget";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import { createAuthorizationReadCache } from "../../src/modules/identity-access/application/authorization-read-cache";
import type { AccessRequest } from "../../src/modules/identity-access/domain/access-control";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";

const TENANT = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";

/** The eleven decisions `/admin/blog` actually makes, in its own order. */
const BLOG_SCREEN_GUARDS: readonly AccessRequest[] = [
  { moduleKey: "blog_content", activityCode: "posts", action: "read" },
  { moduleKey: "blog_content", activityCode: "revisions", action: "read" },
  { moduleKey: "blog_content", activityCode: "posts", action: "update" },
  { moduleKey: "blog_content", activityCode: "revisions", action: "restore" },
  { moduleKey: "blog_content", activityCode: "posts", action: "create" },
  { moduleKey: "blog_content", activityCode: "posts", action: "publish" },
  { moduleKey: "blog_content", activityCode: "posts", action: "schedule" },
  { moduleKey: "blog_content", activityCode: "posts", action: "archive" },
  { moduleKey: "blog_content", activityCode: "posts", action: "delete" },
  { moduleKey: "blog_content", activityCode: "posts", action: "restore" },
  { moduleKey: "blog_content", activityCode: "posts", action: "purge" }
];

let sessionToken = "";
let ownerRoleId = "";
let editorRoleId = "";
let editorTenantUserId = "";
let editorToken = "";

async function seed(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'b1-cache', 'B1 Cache', 'active')
  `;

  const makeMember = async (
    label: string,
    roleId: string | null
  ): Promise<{ tenantUserId: string; token: string }> => {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', ${label})
      RETURNING id
    `) as { id: string }[];

    const identity = (await admin`
      INSERT INTO awcms_identities
        (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];

    const tenantUser = (await admin`
      INSERT INTO awcms_tenant_users (tenant_id, identity_id)
      VALUES (${TENANT}, ${identity[0]!.id})
      RETURNING id
    `) as { id: string }[];

    if (roleId) {
      await admin`
        INSERT INTO awcms_access_policies
          (tenant_id, tenant_user_id, role_id, scope_type, scope_id,
           granted_by_tenant_user_id)
        VALUES (${TENANT}, ${tenantUser[0]!.id}, ${roleId}, 'tenant', ${TENANT},
                ${tenantUser[0]!.id})
      `;
    }

    const token = generateSessionToken();

    await admin`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
      VALUES (${TENANT}, ${identity[0]!.id}, ${hashSessionToken(token)},
              now() + interval '1 hour')
    `;

    return { tenantUserId: tenantUser[0]!.id, token };
  };

  const roles = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
    VALUES (${TENANT}, 'owner', 'Owner', true),
           (${TENANT}, 'editor', 'Editor', false)
    RETURNING id, role_code
  `) as { id: string; role_code: string }[];

  ownerRoleId = roles.find((row) => row.role_code === "owner")!.id;
  editorRoleId = roles.find((row) => row.role_code === "editor")!.id;

  // The owner holds every permission; the editor holds NONE, which is what
  // makes the deny comparison below non-vacuous.
  await admin.unsafe(
    `INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
     SELECT $1, $2, id FROM awcms_permissions`,
    [TENANT, ownerRoleId]
  );

  sessionToken = (await makeMember("owner", ownerRoleId)).token;

  const editor = await makeMember("editor", editorRoleId);
  editorTenantUserId = editor.tenantUserId;
  editorToken = editor.token;
}

type Run = { decisions: boolean[]; queries: number };

async function renderScreen(options: {
  token: string;
  cached: boolean;
}): Promise<Run> {
  return withTenantOrThrow(
    getRuntimeSql(),
    TENANT,
    async (tx) => {
      const { result, queries } = await countQueries(tx, async (counting) => {
        const readCache = options.cached
          ? createAuthorizationReadCache()
          : undefined;
        const decisions: boolean[] = [];

        for (const guard of BLOG_SCREEN_GUARDS) {
          const outcome = await authorizeInTransaction(
            counting,
            TENANT,
            hashSessionToken(options.token),
            new Date(),
            guard,
            readCache ? { readCache } : undefined
          );

          decisions.push(outcome.allowed);
        }

        return decisions;
      });

      return { decisions: result, queries };
    },
    { workClass: "interactive" }
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("the authorization read cache (finding B1)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seed();
  });

  test("an ALLOWED render reaches the same eleven decisions either way", async () => {
    const uncached = await renderScreen({ token: sessionToken, cached: false });
    const cached = await renderScreen({ token: sessionToken, cached: true });

    expect(cached.decisions).toEqual(uncached.decisions);
    // NON-VACUOUS: eleven `false`s would also be "the same".
    expect(uncached.decisions.every(Boolean)).toBe(true);
  });

  test("a DENIED render reaches the same eleven decisions either way", async () => {
    // The direction that matters. A cache that made a refusal into an allow
    // would be a security defect with a benchmark attached.
    const uncached = await renderScreen({ token: editorToken, cached: false });
    const cached = await renderScreen({ token: editorToken, cached: true });

    expect(cached.decisions).toEqual(uncached.decisions);
    expect(uncached.decisions.some(Boolean)).toBe(false);
  });

  test("and it costs far fewer queries", async () => {
    const uncached = await renderScreen({ token: sessionToken, cached: false });
    const cached = await renderScreen({ token: sessionToken, cached: true });

    // Asserted in BOTH directions: a floor on the uncached run so the ceiling
    // below cannot pass because the whole pipeline got shorter for some
    // unrelated reason, and a ceiling on the cached one.
    expect(uncached.queries).toBeGreaterThan(70);
    expect(cached.queries).toBeLessThan(40);
    expect(cached.queries).toBeLessThan(uncached.queries / 2);
  });

  test("every decision is still logged — the cache memoises inputs, not answers", async () => {
    await renderScreen({ token: sessionToken, cached: true });

    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_abac_decision_logs
      WHERE tenant_id = ${TENANT}
    `) as { n: number }[];

    expect(rows[0]!.n).toBe(BLOG_SCREEN_GUARDS.length);
  });

  test("two principals in one cache do not see each other's answers", async () => {
    // The keys carry the token hash and the tenant user id. If they did not, an
    // affordance probe for one person could be answered from another's
    // permission set — which is the worst thing a cache like this could do.
    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        const readCache = createAuthorizationReadCache();
        const guard = BLOG_SCREEN_GUARDS[0]!;

        const owner = await authorizeInTransaction(
          tx,
          TENANT,
          hashSessionToken(sessionToken),
          new Date(),
          guard,
          { readCache }
        );

        const editor = await authorizeInTransaction(
          tx,
          TENANT,
          hashSessionToken(editorToken),
          new Date(),
          guard,
          { readCache }
        );

        return { owner: owner.allowed, editor: editor.allowed };
      },
      { workClass: "interactive" }
    );

    expect(outcome.owner).toBe(true);
    expect(outcome.editor).toBe(false);
  });

  test("a caller WITHOUT a cache sees its own write — which is why the cache is opt-in", async () => {
    // The safety argument, executed. If this memo lived inside
    // `authorizeInTransaction` keyed on `tx`, the second decision below would
    // still be `false`: the grant would be invisible to the transaction that
    // made it. Every route reads fresh precisely because none of them passes a
    // cache.
    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        const guard = BLOG_SCREEN_GUARDS[0]!;

        const before = await authorizeInTransaction(
          tx,
          TENANT,
          hashSessionToken(editorToken),
          new Date(),
          guard
        );

        await tx`
          INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
          SELECT ${TENANT}, ${editorRoleId}, id FROM awcms_permissions
          WHERE module_key = ${guard.moduleKey}
            AND activity_code = ${guard.activityCode}
            AND action = ${guard.action}
        `;

        const after = await authorizeInTransaction(
          tx,
          TENANT,
          hashSessionToken(editorToken),
          new Date(),
          guard
        );

        return { before: before.allowed, after: after.allowed };
      },
      { workClass: "interactive" }
    );

    expect(outcome.before).toBe(false);
    expect(outcome.after).toBe(true);
    expect(editorTenantUserId).not.toBe("");
  });
});
