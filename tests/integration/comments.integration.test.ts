import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { getRegisteredCommentableResources } from "../../src/modules/comments/presentation/commentable-resources";
import { resolvePublishedCommentableResource } from "../../src/modules/comments/application/commentable-resource-engine";
import {
  listApprovedComments,
  requestCommentDeletion,
  submitComment
} from "../../src/modules/comments/application/comment-service";
import { moderateComment } from "../../src/modules/comments/application/comment-moderation";
import { getOrCreateThread } from "../../src/modules/comments/application/comment-thread-directory";
import { DEFAULT_COMMENT_SETTINGS } from "../../src/modules/comments/domain/comment-settings";
import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const AUTHOR = "33333333-3333-3333-3333-333333333333";
const MODERATOR = "44444444-4444-4444-4444-444444444444";

const settings = {
  ...DEFAULT_COMMENT_SETTINGS,
  minSubmitSeconds: 0,
  blockedTerms: []
};

async function seedTenant(id: string, code: string): Promise<void> {
  const admin = getAdminSql();
  await admin`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code + " Name"}, ${code + " Legal"}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function insertPost(
  tenantId: string,
  opts: {
    slug: string;
    status?: string;
    visibility?: string;
    deletedAt?: Date | null;
  }
): Promise<string> {
  const admin = getAdminSql();
  const id = crypto.randomUUID();
  await admin`
    INSERT INTO awcms_blog_posts
      (id, tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, published_at, deleted_at, created_at, updated_at)
    VALUES (
      ${id}, ${tenantId}, ${AUTHOR}, ${"Post " + opts.slug}, ${opts.slug}, '{}'::jsonb, 'body',
      ${opts.status ?? "published"}, ${opts.visibility ?? "public"}, 'en',
      ${new Date("2026-01-01T00:00:00Z")}, ${opts.deletedAt ?? null}, now(), now()
    )
  `;
  return id;
}

async function submit(
  tenantId: string,
  postId: string,
  body: string
): Promise<string | null> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const resolved = await resolvePublishedCommentableResource(
      tx,
      tenantId,
      {
        resourceType: "blog_post",
        resourceId: postId,
        locale: "en",
        tenantCode: "tenant-a"
      },
      getRegisteredCommentableResources()
    );
    if (!resolved) return null;
    const thread = await getOrCreateThread(tx, tenantId, resolved, settings);
    const result = await submitComment(
      tx,
      tenantId,
      resolved,
      thread,
      settings,
      {
        body,
        parentId: null,
        authorKind: "anonymous",
        authorUserId: null,
        authorDisplayName: "Visitor",
        authorEmail: "visitor@example.com",
        honeypot: "",
        elapsedMs: 10000,
        ipHash: "iphash",
        userAgentHash: "uahash"
      }
    );
    return result.accepted ? result.commentId : null;
  });
}

async function publicList(tenantId: string, postId: string): Promise<number> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const resolved = await resolvePublishedCommentableResource(
      tx,
      tenantId,
      {
        resourceType: "blog_post",
        resourceId: postId,
        locale: "en",
        tenantCode: "tenant-a"
      },
      getRegisteredCommentableResources()
    );
    if (!resolved) return 0;
    const thread = await getOrCreateThread(tx, tenantId, resolved, settings);
    const list = await listApprovedComments(tx, tenantId, thread.id, {});
    return list.items.length;
  });
}

suite("comments integration (ADR-0041)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "tenant-a");
    await seedTenant(TENANT_B, "tenant-b");
  }, 30000);

  test("submit is moderation-first: pending, invisible until approved", async () => {
    const post = await insertPost(TENANT_A, { slug: "alpha" });
    const commentId = await submit(TENANT_A, post, "Hello <b>world</b>");
    expect(commentId).not.toBeNull();

    // Not public until approved.
    expect(await publicList(TENANT_A, post)).toBe(0);

    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      moderateComment(
        tx,
        TENANT_A,
        commentId!,
        "approve",
        { reasonCode: null, actorUserId: MODERATOR, note: null },
        async () => {}
      )
    );

    // Now visible, and body is escaped safe HTML (no raw <b>).
    const items = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_A,
      async (tx) => {
        const resolved = await resolvePublishedCommentableResource(
          tx,
          TENANT_A,
          {
            resourceType: "blog_post",
            resourceId: post,
            locale: "en",
            tenantCode: "tenant-a"
          },
          getRegisteredCommentableResources()
        );
        const thread = await getOrCreateThread(
          tx,
          TENANT_A,
          resolved!,
          settings
        );
        return (await listApprovedComments(tx, TENANT_A, thread.id, {})).items;
      }
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.bodyHtml).toContain("&lt;b&gt;");
    expect(items[0]!.bodyHtml).not.toContain("<b>");
  }, 20000);

  test("a draft/private/deleted resource never accepts a comment (publication boundary)", async () => {
    const draft = await insertPost(TENANT_A, {
      slug: "draft",
      status: "draft"
    });
    const priv = await insertPost(TENANT_A, {
      slug: "priv",
      visibility: "private"
    });
    const del = await insertPost(TENANT_A, {
      slug: "del",
      deletedAt: new Date()
    });
    expect(await submit(TENANT_A, draft, "x")).toBeNull();
    expect(await submit(TENANT_A, priv, "x")).toBeNull();
    expect(await submit(TENANT_A, del, "x")).toBeNull();
  }, 20000);

  test("RLS: tenant B cannot see tenant A's comments (IDOR/cross-tenant)", async () => {
    const postA = await insertPost(TENANT_A, { slug: "a1" });
    const commentId = await submit(TENANT_A, postA, "tenant a comment");
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      moderateComment(
        tx,
        TENANT_A,
        commentId!,
        "approve",
        { reasonCode: null, actorUserId: MODERATOR, note: null },
        async () => {}
      )
    );
    // Scoped to tenant B, the comment row is invisible under RLS.
    const seenByB = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_B,
      async (tx) => {
        const rows = (await tx`
        SELECT count(*)::int AS count FROM awcms_comments_comments
      `) as { count: number }[];
        return rows[0]!.count;
      }
    );
    expect(seenByB).toBe(0);
  }, 20000);

  test("approve writes a same-commit domain-event outbox row", async () => {
    const post = await insertPost(TENANT_A, { slug: "evt" });
    const commentId = await submit(TENANT_A, post, "event body");
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      moderateComment(
        tx,
        TENANT_A,
        commentId!,
        "approve",
        { reasonCode: null, actorUserId: MODERATOR, note: null },
        async () => {}
      )
    );
    const events = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_A,
      async (tx) => {
        const rows = (await tx`
        SELECT event_type FROM awcms_domain_events
        WHERE event_type = 'awcms.comments.comment.approved'
      `) as { event_type: string }[];
        return rows.length;
      }
    );
    expect(events).toBeGreaterThanOrEqual(1);
  }, 20000);

  test("author self-delete within window soft-deletes (row retained, hidden)", async () => {
    const post = await insertPost(TENANT_A, { slug: "sd" });
    const commentId = await submit(TENANT_A, post, "delete me");
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      moderateComment(
        tx,
        TENANT_A,
        commentId!,
        "approve",
        { reasonCode: null, actorUserId: MODERATOR, note: null },
        async () => {}
      )
    );
    expect(await publicList(TENANT_A, post)).toBe(1);

    const del = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      requestCommentDeletion(tx, TENANT_A, commentId!, {
        userId: null,
        ipHash: "iphash"
      })
    );
    expect(del.softDeleted).toBe(true);
    expect(await publicList(TENANT_A, post)).toBe(0);

    // Row retained (soft delete), status = deleted.
    const status = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_A,
      async (tx) => {
        const rows = (await tx`
        SELECT status FROM awcms_comments_comments WHERE id = ${commentId}
      `) as { status: string }[];
        return rows[0]?.status;
      }
    );
    expect(status).toBe("deleted");
  }, 20000);
});
