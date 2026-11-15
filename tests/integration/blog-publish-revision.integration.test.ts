/**
 * Revision history around PUBLISH and body-only edits, through the real route
 * handlers (WORLD 2, harness.ts: the handlers reach for `getDatabaseClient()`
 * internally, so this runs against the migrated `DATABASE_URL` database).
 *
 * ## The two defects this pins
 *
 * 1. A body-only correction recorded nothing. `isSignificantContentChange`
 *    judged significance from `title`/`contentJson`/`contentText` and never
 *    saw `bodyPortableText`, the canonical body since ADR-0100 — and a PATCH
 *    carrying ONLY that field is exactly what the admin editor and the
 *    preview overlay send.
 * 2. Nothing snapshotted the content AS PUBLISHED. `createBlogRevision` ran
 *    from the two PATCH handlers and revision restore only, so the sequence
 *    create -> publish -> edit left a history whose first row already held the
 *    post-edit text; the version readers had seen was unrecoverable.
 *
 * MUTATION PROOFS this shape catches:
 * - Removing `bodyPortableText` from `isSignificantContentChange` -> "a
 *   body-only PATCH records a revision" goes RED.
 * - Removing the `createBlogRevision` call from either publish route -> the
 *   matching "publishing writes a revision" test goes RED.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
import { POST as postPublish } from "../../src/pages/api/v1/blog/posts/[id]/publish";
import { POST as pagePublish } from "../../src/pages/api/v1/blog/pages/[id]/publish";

const TENANT = "13113113-1311-4311-8311-131131131131";
const PROFILE = "13113113-0000-4311-8311-131131131101";
const IDENTITY = "13113113-0000-4311-8311-131131131102";
const EDITOR = "13113113-0000-4311-8311-131131131103";
const POST_ID = "13113113-0000-4311-8311-131131131901";
const PAGE_ID = "13113113-0000-4311-8311-131131131902";

const BODY_V1 = [
  {
    _type: "block",
    _key: "k1",
    style: "normal",
    markDefs: [],
    children: [{ _type: "span", _key: "s1", text: "As published", marks: [] }]
  }
];
const BODY_V2 = [
  {
    _type: "block",
    _key: "k1",
    style: "normal",
    markDefs: [],
    children: [{ _type: "span", _key: "s1", text: "Corrected", marks: [] }]
  }
];

let handlerReady = false;
let sessionToken = "";
let keySeq = 0;

async function seed(): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'blog-rev-publish', 'Blog Revision Publish', 'active')
  `;
  await sql`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
    VALUES (${PROFILE}, ${TENANT}, 'person', 'Editor')
  `;
  await sql`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${IDENTITY}, ${TENANT}, ${PROFILE}, 'editor-rev@example.test',
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
    VALUES (${TENANT}, 'blog-publisher', 'Blog Publisher') RETURNING id
  `) as { id: string }[];

  for (const [activity, action] of [
    ["posts", "publish"],
    ["posts", "update"],
    ["pages", "publish"]
  ] as const) {
    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT ${TENANT}, ${role[0]!.id}, id FROM awcms_permissions
      WHERE module_key = 'blog_content' AND activity_code = ${activity}
        AND action = ${action}
    `;
  }

  await withTenantOrThrow(getHandlerDatabaseClient(), TENANT, (tx) =>
    grantRolePolicy(tx, TENANT, {
      tenantUserId: EDITOR,
      roleId: role[0]!.id,
      grantedByTenantUserId: null,
      reason: "blog revision fixture"
    })
  );

  await sql`
    INSERT INTO awcms_blog_posts
      (id, tenant_id, author_tenant_user_id, title, slug, content_json,
       content_text, body_portable_text, status, visibility, locale)
    VALUES
      (${POST_ID}, ${TENANT}, ${EDITOR}, 'A post', 'a-post', '{}'::jsonb,
       'As published', ${BODY_V1}::jsonb, 'draft', 'public', 'id')
  `;
  await sql`
    INSERT INTO awcms_blog_pages
      (id, tenant_id, author_tenant_user_id, title, slug, content_json,
       content_text, body_portable_text, status, visibility, locale)
    VALUES
      (${PAGE_ID}, ${TENANT}, ${EDITOR}, 'A page', 'a-page', '{}'::jsonb,
       'As published', ${BODY_V1}::jsonb, 'draft', 'public', 'id')
  `;
}

function headers(withKey: boolean): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": TENANT,
    authorization: `Bearer ${sessionToken}`,
    ...(withKey ? { "idempotency-key": `rev-${(keySeq += 1)}` } : {})
  };
}

type RevisionRow = {
  resource_type: string;
  revision_number: number;
  status: string;
  change_note: string | null;
  created_by_tenant_user_id: string;
  body_portable_text: unknown;
};

async function revisions(
  resourceType: "post" | "page",
  resourceId: string
): Promise<RevisionRow[]> {
  return (await getHandlerAdminSql()`
    SELECT resource_type, revision_number, status, change_note,
           created_by_tenant_user_id, body_portable_text
    FROM awcms_blog_revisions
    WHERE tenant_id = ${TENANT} AND resource_type = ${resourceType}
      AND resource_id = ${resourceId}
    ORDER BY revision_number ASC
  `) as RevisionRow[];
}

const describeOrSkip = integrationEnabled ? describe : describe.skip;

describeOrSkip(
  "blog revisions: publish snapshots, body-only edits count",
  () => {
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

    test("a body-only PATCH records a revision holding the new body", async () => {
      if (!handlerReady) return;

      const res = await invoke(postsPatch, {
        method: "PATCH",
        path: `/api/v1/blog/posts/${POST_ID}`,
        params: { id: POST_ID },
        headers: headers(false),
        body: { bodyPortableText: BODY_V2 }
      });

      expect(res.status).toBe(200);

      const rows = await revisions("post", POST_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body_portable_text).toEqual(BODY_V2);
    });

    test("a cosmetic-only PATCH still records nothing", async () => {
      if (!handlerReady) return;

      const res = await invoke(postsPatch, {
        method: "PATCH",
        path: `/api/v1/blog/posts/${POST_ID}`,
        params: { id: POST_ID },
        headers: headers(false),
        body: { seoTitle: "Only SEO" }
      });

      expect(res.status).toBe(200);
      expect(await revisions("post", POST_ID)).toHaveLength(0);
    });

    test("publishing a post writes a revision of the text AS PUBLISHED, and a later edit keeps it", async () => {
      if (!handlerReady) return;

      const published = await invoke(postPublish, {
        method: "POST",
        path: `/api/v1/blog/posts/${POST_ID}/publish`,
        params: { id: POST_ID },
        headers: headers(true)
      });

      expect(published.status).toBe(200);

      const afterPublish = await revisions("post", POST_ID);
      expect(afterPublish).toHaveLength(1);
      expect(afterPublish[0]).toMatchObject({
        revision_number: 1,
        status: "published",
        change_note: "Published.",
        created_by_tenant_user_id: EDITOR
      });
      expect(afterPublish[0]!.body_portable_text).toEqual(BODY_V1);

      const edited = await invoke(postsPatch, {
        method: "PATCH",
        path: `/api/v1/blog/posts/${POST_ID}`,
        params: { id: POST_ID },
        headers: headers(false),
        body: { bodyPortableText: BODY_V2 }
      });

      expect(edited.status).toBe(200);

      const afterEdit = await revisions("post", POST_ID);
      expect(afterEdit.map((row) => row.revision_number)).toEqual([1, 2]);
      // The text readers saw is still recoverable from revision 1.
      expect(afterEdit[0]!.body_portable_text).toEqual(BODY_V1);
      expect(afterEdit[1]!.body_portable_text).toEqual(BODY_V2);
    });

    test("an Idempotency-Key replay of publish does not write a second revision", async () => {
      if (!handlerReady) return;

      const key = "rev-replay-1";
      const call = () =>
        invoke(postPublish, {
          method: "POST",
          path: `/api/v1/blog/posts/${POST_ID}/publish`,
          params: { id: POST_ID },
          headers: { ...headers(false), "idempotency-key": key }
        });

      expect((await call()).status).toBe(200);
      expect((await call()).status).toBe(200);
      expect(await revisions("post", POST_ID)).toHaveLength(1);
    });

    test("publishing a page writes a page revision", async () => {
      if (!handlerReady) return;

      const published = await invoke(pagePublish, {
        method: "POST",
        path: `/api/v1/blog/pages/${PAGE_ID}/publish`,
        params: { id: PAGE_ID },
        headers: headers(true)
      });

      expect(published.status).toBe(200);

      const rows = await revisions("page", PAGE_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        resource_type: "page",
        status: "published",
        change_note: "Published."
      });
      expect(rows[0]!.body_portable_text).toEqual(BODY_V1);
    });
  }
);
