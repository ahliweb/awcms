/**
 * The scheduled publish sweep evaluates the content quality checklist TWICE,
 * and the second evaluation is the one that decides.
 *
 * ## Why this needs its own file
 *
 * The re-evaluation exists because the post rows are locked by the batch's
 * `FOR UPDATE` and the R2 media objects they reference are NOT: an editor can
 * detach or invalidate a referenced image between the first evaluation and the
 * `UPDATE`. Re-running immediately before the write keeps that window at one
 * query round trip.
 *
 * Every part of that is invisible to the other suites. A budget counts queries
 * and would be just as happy if the second pass were deleted — happier, in
 * fact, since the number would drop. A correctness test that seeds a stable
 * fixture cannot tell the two passes apart, because both see the same media.
 * So the mitigation has always been a comment with nothing holding it, and
 * batching the sweep is exactly the kind of change that would have quietly
 * removed it while looking like a tidy-up: reusing the first pass's verdicts is
 * one line shorter and reads as obviously equivalent.
 *
 * ## How it is proven
 *
 * A `MediaLibraryPort` stub that resolves the post's featured media on the
 * FIRST call and stops resolving on the second — the detachment, made
 * deterministic. Under it the sweep must leave the post `scheduled` and write a
 * blocked audit row. The control case, the same stub resolving every time,
 * must publish: without it, a test that "passes" because the checklist never
 * passed at all would look identical.
 *
 * The stub also answers the enforcement question directly, so this file needs
 * no `NEWS_MEDIA_R2_*` environment at all — the port is the seam, and using it
 * is what makes the media state controllable in the first place.
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
import { publishDueScheduledPosts } from "../../src/modules/blog-content/application/blog-scheduled-publish";
import type {
  MediaLibraryPort,
  ResolvedMediaReferenceDTO
} from "../../src/modules/_shared/ports/media-library-port";

const TENANT = "fa000000-0000-4000-8000-000000000001";
const AUTHOR = "fa000000-0000-4000-8000-000000000002";
const MEDIA = "fa000000-0000-4000-8000-000000000003";

const RESOLVED: ResolvedMediaReferenceDTO = {
  publicUrl: "https://media.example.test/a.jpg",
  altText: "A photograph of something",
  mimeType: "image/jpeg",
  width: 1200,
  height: 800,
  sizeBytes: 240_000
};

/**
 * `stopResolvingAfter` calls. `Infinity` is the control: media that never goes
 * away. `1` is the race: resolvable when the sweep first looks, gone when it
 * looks again.
 */
function stubMediaPort(stopResolvingAfter: number): {
  port: MediaLibraryPort;
  resolveCalls: () => number;
} {
  let calls = 0;

  return {
    resolveCalls: () => calls,
    port: {
      async isManagedMediaEnforcementActiveForTenant(): Promise<boolean> {
        return true;
      },
      async isMediaReferenceSafe(): Promise<boolean> {
        return true;
      },
      async resolveMediaReferences(
        _tx: Bun.SQL,
        _tenantId: string,
        mediaObjectIds: readonly string[]
      ): Promise<ReadonlyMap<string, ResolvedMediaReferenceDTO>> {
        calls += 1;

        const resolved = new Map<string, ResolvedMediaReferenceDTO>();

        if (calls > stopResolvingAfter) {
          return resolved;
        }

        for (const id of mediaObjectIds) {
          resolved.set(id, RESOLVED);
        }

        return resolved;
      }
    }
  };
}

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'sweep-toctou', 'Sweep TOCTOU Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Author')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'sweep-toctou@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${AUTHOR}, ${TENANT}, ${identity[0]!.id})
  `;

  await admin`
    INSERT INTO awcms_blog_posts
      (tenant_id, author_tenant_user_id, title, slug, content_json, content_text,
       status, visibility, locale, scheduled_at, featured_media_id)
    VALUES (${TENANT}, ${AUTHOR}, 'Due', 'due', '{}'::jsonb, 'body',
            'scheduled', 'public', 'id', now() - interval '1 hour', ${MEDIA})
  `;
}

async function postStatus(): Promise<string> {
  const rows = (await getAdminSql()`
    SELECT status FROM awcms_blog_posts WHERE tenant_id = ${TENANT}
  `) as { status: string }[];

  return rows[0]!.status;
}

async function auditActions(): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT action FROM awcms_audit_events WHERE tenant_id = ${TENANT}
    ORDER BY action
  `) as { action: string }[];

  return rows.map((row) => row.action);
}

const suite = integrationEnabled ? describe : describe.skip;

suite("the sweep re-checks the checklist before it writes", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("media that survives both looks: the post publishes", async () => {
    const { port, resolveCalls } = stubMediaPort(Number.POSITIVE_INFINITY);

    const result = await publishDueScheduledPosts(
      getRuntimeSql(),
      TENANT,
      port
    );

    expect(result.publishedCount).toBe(1);
    expect(await postStatus()).toBe("published");

    // Two looks, not one: this is the control that gives the case below its
    // meaning. If the sweep only ever resolved once, the test below would pass
    // for the wrong reason.
    expect(resolveCalls()).toBe(2);
  });

  test("media detached between the two looks: the post is BLOCKED, not published", async () => {
    const { port, resolveCalls } = stubMediaPort(1);

    const result = await publishDueScheduledPosts(
      getRuntimeSql(),
      TENANT,
      port
    );

    // The first evaluation passed — that is what made this post a candidate at
    // all — and the second one refused. Reusing the first verdict would have
    // published an article whose featured image no longer resolves.
    expect(resolveCalls()).toBe(2);
    expect(result.publishedCount).toBe(0);
    expect(result.blockedCount).toBe(1);
    expect(await postStatus()).toBe("scheduled");
    expect(await auditActions()).toEqual([
      "blog.post.scheduled_publish_blocked",
      "blog.post.scheduled_publish_executed"
    ]);
  });

  test("media already gone at the first look never reaches the second", async () => {
    const { port, resolveCalls } = stubMediaPort(0);

    const result = await publishDueScheduledPosts(
      getRuntimeSql(),
      TENANT,
      port
    );

    expect(result.blockedCount).toBe(1);
    expect(await postStatus()).toBe("scheduled");

    // One look. A post the first pass already refused is not a candidate, so
    // the second pass has nothing to re-check — the batch of zero costs
    // nothing rather than issuing an empty query.
    expect(resolveCalls()).toBe(1);
  });
});
