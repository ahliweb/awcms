/**
 * The ROUTES carry `regionCode` (Issue #1312 audit follow-up).
 *
 * `blog-post-region-code.integration.test.ts` calls the directory directly, so
 * a refactor of a route that drops `regionCode` before validation would still
 * pass it. This file goes through the real `POST /api/v1/blog/posts` and
 * `PATCH /api/v1/blog/posts/{id}` handlers: set, leave untouched when absent,
 * clear with `null`, and refuse a malformed code.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { PATCH as postsPatch } from "../../src/pages/api/v1/blog/posts/[id]";
import { POST as postsPost } from "../../src/pages/api/v1/blog/posts/index";

const TENANT = "15515515-1551-4551-8551-155155155155";
const PROFILE = "15515515-0000-4551-8551-155155155101";
const IDENTITY = "15515515-0000-4551-8551-155155155102";
const EDITOR = "15515515-0000-4551-8551-155155155103";

let handlerReady = false;
let sessionToken = "";

async function seed(): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'blog-region-routes', 'Blog Region Routes', 'active')
  `;
  await sql`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
    VALUES (${PROFILE}, ${TENANT}, 'person', 'Editor')
  `;
  await sql`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${IDENTITY}, ${TENANT}, ${PROFILE}, 'editor-region@example.test',
            'not-a-real-hash', 'active')
  `;
  await sql`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${EDITOR}, ${TENANT}, ${IDENTITY}, 'active')
  `;

  sessionToken = generateSessionToken();

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level, last_authenticated_at)
    VALUES (${TENANT}, ${IDENTITY}, ${hashSessionToken(sessionToken)},
            now() + interval '1 hour', 'aal1', now())
  `;

  const role = (await sql`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${TENANT}, 'blog-editor', 'Blog Editor') RETURNING id
  `) as { id: string }[];

  for (const action of ["create", "update"] as const) {
    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT ${TENANT}, ${role[0]!.id}, id FROM awcms_permissions
      WHERE module_key = 'blog_content' AND activity_code = 'posts'
        AND action = ${action}
    `;
  }

  await withTenantOrThrow(getHandlerDatabaseClient(), TENANT, (tx) =>
    grantRolePolicy(tx, TENANT, {
      tenantUserId: EDITOR,
      roleId: role[0]!.id,
      grantedByTenantUserId: null,
      reason: "blog region route fixture"
    })
  );
}

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": TENANT,
    authorization: `Bearer ${sessionToken}`
  };
}

async function storedRegion(postId: string): Promise<string | null> {
  const rows = (await getHandlerAdminSql()`
    SELECT region_code FROM awcms_blog_posts
    WHERE tenant_id = ${TENANT} AND id = ${postId}
  `) as { region_code: string | null }[];

  return rows[0]!.region_code;
}

const describeOrSkip = integrationEnabled ? describe : describe.skip;

describeOrSkip("blog post regionCode through the routes (Issue #1312)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    if (handlerReady) await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    await seed();
  });

  afterEach(async () => {
    if (handlerReady) await resetHandlerDatabase();
  });

  test("POST persists regionCode, PATCH sets, preserves, clears and refuses it", async () => {
    if (!handlerReady) return;

    const created = await invoke(postsPost, {
      method: "POST",
      path: "/api/v1/blog/posts",
      headers: headers(),
      body: {
        title: "Judul",
        slug: "judul",
        bodyPortableText: [],
        regionCode: "62.71.01"
      }
    });

    expect(created.status).toBe(200);

    const postId = (created.body as { data: { id: string } }).data.id;
    expect(await storedRegion(postId)).toBe("62.71.01");

    const patch = (body: Record<string, unknown>) =>
      invoke(postsPatch, {
        method: "PATCH",
        path: `/api/v1/blog/posts/${postId}`,
        params: { id: postId },
        headers: headers(),
        body
      });

    // Set to another value.
    expect((await patch({ regionCode: "62.71" })).status).toBe(200);
    expect(await storedRegion(postId)).toBe("62.71");

    // Absent: untouched.
    expect((await patch({ title: "Judul baru" })).status).toBe(200);
    expect(await storedRegion(postId)).toBe("62.71");

    // Malformed: refused, stored value unchanged.
    expect((await patch({ regionCode: "not a code" })).status).toBe(400);
    expect(await storedRegion(postId)).toBe("62.71");

    // `null` clears.
    expect((await patch({ regionCode: null })).status).toBe(200);
    expect(await storedRegion(postId)).toBeNull();
  });
});
