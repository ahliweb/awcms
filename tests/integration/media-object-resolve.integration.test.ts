/**
 * Batch media resolution (`GET /api/v1/media/objects`) against a real
 * PostgreSQL — driven through the port adapter the route calls, so the safety
 * rule under test is the same one the endpoint enforces.
 *
 * The rule that matters: an object resolves ONLY when it is verified/attached,
 * same-tenant, and not soft-deleted. Everything else lands in `unresolved`,
 * never in `items` — a media URL is a public reference, and handing one out for
 * an unverified upload publishes whatever a caller managed to put in the bucket.
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
import { mediaLibraryPortAdapter } from "../../src/modules/media-library/application/media-library-port-adapter";

const TENANT_A = "a2222222-2222-4222-8222-222222222222";
const TENANT_B = "b2222222-2222-4222-8222-222222222222";
const AUTHOR_A = "a2000000-0000-4000-8000-000000000001";
const AUTHOR_B = "b2000000-0000-4000-8000-000000000001";

type Seeded = Record<string, string>;
let ids: Seeded = {};

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
 * `module_key = 'news_portal'` and `storage_driver = 'cloudflare_r2'` are CHECK
 * constraints on the table (`sql/041`), never relaxed since. ADR-0036 moved the
 * registry's OWNERSHIP to `media_library` and ADR-0044 folded `news_portal`
 * into `blog_content`, but both deliberately kept the physical names — so these
 * literals are what a real row still carries, not leftovers in the fixture.
 */
async function seedMedia(
  tenantId: string,
  userId: string,
  label: string,
  status: string,
  options: { deleted?: boolean } = {}
): Promise<string> {
  // `object_key` is CHECK-constrained to `news-media/<tenant_id>/YYYY/MM/<uuid>.<ext>`,
  // verified per-row against the row's OWN tenant_id — so a fixture cannot use a
  // convenient short key, and a cross-tenant key is rejected by the database
  // rather than by application code.
  const objectKey = `news-media/${tenantId}/2026/08/${crypto.randomUUID()}.png`;

  // `status='attached'` REQUIRES both owner columns and anything else requires
  // them null (`owner_consistency_check`), so the fixture cannot flip status
  // alone — the database will not hold a half-attached row.
  const attached = status === "attached";

  const rows = (await getAdminSql()`
    INSERT INTO awcms_news_media_objects
      (tenant_id, module_key, storage_driver, bucket_name, object_key,
       public_url, mime_type, alt_text, status, owner_resource_type,
       owner_resource_id, created_by_tenant_user_id, deleted_at)
    VALUES (
      ${tenantId}, 'news_portal', 'cloudflare_r2', 'bucket', ${objectKey},
      ${`https://cdn.example.test/${label}.png`}, 'image/png', ${`alt ${label}`},
      ${status}, ${attached ? "blog_post" : null},
      ${attached ? crypto.randomUUID() : null},
      ${userId}, ${options.deleted ? new Date() : null}
    )
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function resolve(
  tenantId: string,
  requested: string[]
): Promise<{ items: string[]; unresolved: string[] }> {
  const resolved = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    mediaLibraryPortAdapter.resolveMediaReferences(tx, tenantId, requested)
  );

  return {
    items: requested.filter((id) => resolved.has(id)),
    unresolved: requested.filter((id) => !resolved.has(id))
  };
}

const suite = integrationEnabled ? describe : describe.skip;

suite("media object batch resolution", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "media-a", AUTHOR_A);
    await seedTenant(TENANT_B, "media-b", AUTHOR_B);

    ids = {
      verified: await seedMedia(TENANT_A, AUTHOR_A, "verified", "verified"),
      attached: await seedMedia(TENANT_A, AUTHOR_A, "attached", "attached"),
      pending: await seedMedia(TENANT_A, AUTHOR_A, "pending", "pending_upload"),
      deletedRow: await seedMedia(TENANT_A, AUTHOR_A, "deleted", "verified", {
        deleted: true
      }),
      otherTenant: await seedMedia(TENANT_B, AUTHOR_B, "other", "verified")
    };
  });

  test("verified and attached objects resolve with their public reference", async () => {
    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      mediaLibraryPortAdapter.resolveMediaReferences(tx, TENANT_A, [
        ids.verified!,
        ids.attached!
      ])
    );

    expect(result.size).toBe(2);
    expect(result.get(ids.verified!)?.publicUrl).toBe(
      "https://cdn.example.test/verified.png"
    );
    expect(result.get(ids.verified!)?.altText).toBe("alt verified");
    expect(result.get(ids.attached!)?.mimeType).toBe("image/png");
  });

  // Each of these would publish a URL that must not be public. They are the
  // reason the endpoint cannot simply be "SELECT public_url WHERE id = ANY".
  test.each([
    ["an unverified upload", "pending"],
    ["a soft-deleted object", "deletedRow"],
    ["another tenant's object", "otherTenant"]
  ])("%s never resolves", async (_label, key) => {
    const result = await resolve(TENANT_A, [ids[key]!]);

    expect(result.items).toEqual([]);
    expect(result.unresolved).toEqual([ids[key]!]);
  });

  test("an unknown id is unresolved, not an error", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    const result = await resolve(TENANT_A, [ids.verified!, unknown]);

    expect(result.items).toEqual([ids.verified!]);
    expect(result.unresolved).toEqual([unknown]);
  });

  test("a mixed batch resolves partially rather than failing whole", async () => {
    const result = await resolve(TENANT_A, [
      ids.verified!,
      ids.pending!,
      ids.otherTenant!,
      ids.attached!
    ]);

    expect(result.items).toEqual([ids.verified!, ids.attached!]);
    expect(result.unresolved).toEqual([ids.pending!, ids.otherTenant!]);
  });

  test("the same object is resolvable from its OWN tenant", async () => {
    // Pins that the cross-tenant miss above is tenant scoping, not a broken row.
    const result = await resolve(TENANT_B, [ids.otherTenant!]);

    expect(result.items).toEqual([ids.otherTenant!]);
  });
});
