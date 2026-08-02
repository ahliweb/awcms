/**
 * `listMediaObjects` (ADR-0056 §C) against a real PostgreSQL.
 *
 * This is the function `GET /api/v1/media/objects/list` is built on, and it is
 * the first LIST over `awcms_news_media_objects` — every other read in this
 * module is a point lookup. Three properties need a real database to prove:
 *
 * 1. **The keyset cursor does not skip rows sharing a millisecond.** A media
 *    registry walks straight into Issue #158's trap: a batch upload writes many
 *    rows inside one millisecond, and a cursor built from a JS `Date` (which
 *    drops the microseconds PostgreSQL stores) denotes an instant strictly
 *    EARLIER than the row it came from, silently skipping every sibling. Only a
 *    real `timestamptz` shows this — a mock cannot.
 * 2. **The three-way deletion filter really partitions.** `live` and `deleted`
 *    must be disjoint and must sum to `all`.
 * 3. **RLS still holds.** The listing runs under the runtime role, so a tenant
 *    must not see another's objects even though the function is designed to
 *    return rows in ANY status — the widest read this module has.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { decodeKeysetCursor } from "../../src/modules/_shared/keyset-pagination";
import {
  listMediaObjects,
  MEDIA_OBJECT_LIST_LIMIT,
  type NewsMediaObjectView
} from "../../src/modules/media-library/application/media-object-directory";

const TENANT_A = "a3333333-3333-4333-8333-333333333333";
const TENANT_B = "b3333333-3333-4333-8333-333333333333";
const AUTHOR_A = "a3000000-0000-4000-8000-000000000001";
const AUTHOR_B = "b3000000-0000-4000-8000-000000000001";

/** Two full pages plus a partial one, so `nextCursor` is exercised both ways. */
const BATCH = MEDIA_OBJECT_LIST_LIMIT * 2 + 7;

async function seedTenant(
  tenantId: string,
  code: string,
  userId: string
): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${code})
  `;
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', 'Uploader')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${code}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
  `;
}

/**
 * ONE statement inserting every row, so they genuinely share a transaction
 * timestamp — `now()` is fixed for the whole transaction, which is the harshest
 * possible version of the millisecond-collision case and exactly what a batch
 * upload produces.
 *
 * `module_key`/`storage_driver`/`object_key` shapes are CHECK constraints on
 * `sql/041` and are verified per-row against the row's OWN `tenant_id`, so a
 * fixture cannot use a convenient short key.
 */
async function seedBatch(
  tenantId: string,
  userId: string,
  count: number
): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_news_media_objects
      (tenant_id, module_key, storage_driver, bucket_name, object_key,
       public_url, mime_type, status, created_by_tenant_user_id)
    SELECT ${tenantId}, 'news_portal', 'cloudflare_r2', 'bucket',
           'news-media/' || ${tenantId} || '/2026/08/' || gen_random_uuid() || '.png',
           'https://cdn.example.test/' || g || '.png',
           CASE WHEN g % 4 = 0 THEN 'image/webp' ELSE 'image/png' END,
           CASE WHEN g % 3 = 0 THEN 'verified' ELSE 'uploaded' END,
           ${userId}
    FROM generate_series(1, ${count}) AS g
  `;
}

async function walkEveryPage(tenantId: string): Promise<{
  ids: string[];
  pages: number;
}> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const ids: string[] = [];
    let cursor = undefined;
    let pages = 0;

    for (;;) {
      const page = await listMediaObjects(tx, tenantId, {}, cursor);
      pages += 1;
      ids.push(...page.items.map((item) => item.id));

      if (!page.nextCursor) break;

      cursor = decodeKeysetCursor(page.nextCursor) ?? undefined;
      expect(cursor).toBeDefined();

      // A cursor that never terminates is the other failure mode, and an
      // unbounded loop here would hang the suite rather than fail it.
      if (pages > 20) throw new Error("cursor did not terminate");
    }

    return { ids, pages };
  });
}

async function listOnce(
  tenantId: string,
  filter: Parameters<typeof listMediaObjects>[2]
): Promise<NewsMediaObjectView[]> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const page = await listMediaObjects(tx, tenantId, filter);
    return page.items;
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("media object listing", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "media-list-a", AUTHOR_A);
    await seedTenant(TENANT_B, "media-list-b", AUTHOR_B);
    await seedBatch(TENANT_A, AUTHOR_A, BATCH);
    await seedBatch(TENANT_B, AUTHOR_B, 5);
  });

  test("paging visits every row exactly once, even when they share a timestamp", async () => {
    const { ids, pages } = await walkEveryPage(TENANT_A);

    // The property that matters: nothing skipped and nothing repeated. With a
    // millisecond-precision cursor this comes back short — measured at 4 of 105
    // when the bug was live (Issue #158).
    expect(ids.length).toBe(BATCH);
    expect(new Set(ids).size).toBe(BATCH);
    expect(pages).toBe(3);
  });

  test("a full page yields a cursor and a partial page does not", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
      const first = await listMediaObjects(tx, TENANT_A, {});

      expect(first.items.length).toBe(MEDIA_OBJECT_LIST_LIMIT);
      expect(first.nextCursor).not.toBeNull();

      const last = await listMediaObjects(
        tx,
        TENANT_A,
        {},
        decodeKeysetCursor(
          (await listMediaObjects(
            tx,
            TENANT_A,
            {},
            decodeKeysetCursor(first.nextCursor!)!
          ))!.nextCursor!
        )!
      );

      expect(last.items.length).toBe(BATCH - MEDIA_OBJECT_LIST_LIMIT * 2);
      expect(last.nextCursor).toBeNull();
    });
  });

  test("rows come back newest first", async () => {
    const items = await listOnce(TENANT_A, {});
    const timestamps = items.map((item) => item.createdAt.getTime());

    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  test("status and mimeType filters narrow the result", async () => {
    const verified = await listOnce(TENANT_A, { status: "verified" });
    const webp = await listOnce(TENANT_A, { mimeType: "image/webp" });

    expect(verified.length).toBeGreaterThan(0);
    expect(verified.every((item) => item.status === "verified")).toBe(true);

    expect(webp.length).toBeGreaterThan(0);
    expect(webp.every((item) => item.mimeType === "image/webp")).toBe(true);

    // A filter matching nothing is an empty page, not an unfiltered one — the
    // failure mode where an ignored filter looks like a working one.
    expect(await listOnce(TENANT_A, { mimeType: "image/avif" })).toEqual([]);
  });

  test("unlike the resolver, unhealthy statuses are INCLUDED", async () => {
    // `isNewsMediaObjectSafeForPublicReference` admits only verified/attached.
    // This listing must not: an administrator opens it precisely because of the
    // objects that are not healthy.
    const statuses = new Set(
      (await listOnce(TENANT_A, {})).map((i) => i.status)
    );

    expect(statuses.has("uploaded")).toBe(true);
  });

  test("the deletion filter partitions live and deleted, and `all` is their union", async () => {
    const [target] = await listOnce(TENANT_A, {});
    expect(target).toBeDefined();

    await getAdminSql()`
      UPDATE awcms_news_media_objects
      SET deleted_at = now(), delete_reason = 'integration'
      WHERE id = ${target!.id}
    `;

    const live = await walkEveryPage(TENANT_A);
    expect(live.ids).not.toContain(target!.id);
    expect(live.ids.length).toBe(BATCH - 1);

    const deleted = await listOnce(TENANT_A, { deletion: "deleted" });
    expect(deleted.map((item) => item.id)).toEqual([target!.id]);
    expect(deleted[0]!.deleteReason).toBe("integration");

    const all = await listOnce(TENANT_A, { deletion: "all" });
    expect(all.length).toBe(MEDIA_OBJECT_LIST_LIMIT);
    expect(all.some((item) => item.id === target!.id)).toBe(true);
  });

  test("a tenant never sees another tenant's objects", async () => {
    const a = await walkEveryPage(TENANT_A);
    const b = await walkEveryPage(TENANT_B);

    expect(a.ids.length).toBe(BATCH);
    expect(b.ids.length).toBe(5);
    expect(a.ids.some((id) => b.ids.includes(id))).toBe(false);
  });
});
