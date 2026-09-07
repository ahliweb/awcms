/**
 * Issue #787 (sibling of #784) — `PATCH /api/v1/blog/pages/{id}` used to
 * change `slug` in place with nothing recording the OLD value anywhere: not
 * on the page row, not in `awcms_blog_revisions` (no `slug` column, see
 * `revision-policy.ts`). Every previously-shared link to that page 404ed the
 * moment an editor fixed a slug, silently.
 *
 * `captureBlogPageSlugChangeRedirect` (`blog-content/application/
 * slug-change-redirect-capture.ts`) closes that gap by driving the ADR-0039
 * seam (`captureUrlChangeRedirect`) from inside the SAME transaction as the
 * page update. These tests prove the actual wiring end to end, through the
 * real `PATCH` handler — not just the extracted function — because the
 * property that most needs proving ("an unrelated field-only update produces
 * no redirect row at all") lives in the ROUTE's own guard
 * (`input.slug !== undefined && input.slug !== page.slug`), not in the
 * function that only runs once that guard has already passed.
 *
 * This is the page-shaped mirror of
 * `tests/integration/blog-post-slug-change-redirect.integration.test.ts`
 * (Issue #784) — same shape of proof, aimed at `awcms_blog_pages` and the
 * page public path `/blog/{tenantCode}/pages/{slug}` instead of the post's
 * bare `/blog/{tenantCode}/{slug}`.
 *
 * ## Why this needs a real database
 *
 * The outcome depends on `awcms_seo_redirect_settings.url_change_auto_policy`,
 * on `checkRedirectSafety`'s conflict/loop/chain lookups against OTHER rows in
 * `awcms_seo_redirects`, and on `awcms_tenant_modules.enabled` — three real
 * tables a mock `Bun.SQL` would only be echoing back.
 *
 * MUTATION PROOFS this shape would catch:
 * - Deleting the route's `input.slug !== page.slug` guard → "an unrelated
 *   field-only update produces no redirect row" goes RED (every PATCH would
 *   start proposing a self-redirect).
 * - Making a `rejected`/`invalid` outcome `throw` instead of returning →
 *   "a conflicting existing rule doesn't block the page update" goes RED.
 * - Dropping the `resolveModuleEnabled(tx, tenantId, "seo_distribution")`
 *   guard → the module-disabled test starts creating a row it must not.
 *
 * WORLD 2 (harness.ts) — the real route handler reaches for
 * `getDatabaseClient()` internally, so this runs against the migrated
 * `DATABASE_URL` database. Skipped unless one is configured.
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
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { PATCH as pagesPatch } from "../../src/pages/api/v1/blog/pages/[id]";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { withPublicLocalePrefix } from "../../src/lib/i18n/public-locale-path";

const TENANT = "78778778-7877-4877-8877-877787787877";
const TENANT_CODE = "slug-redirect-787";
const PROFILE = "78778778-0000-4877-8877-877787787701";
const IDENTITY = "78778778-0000-4877-8877-877787787702";
const AUTHOR = "78778778-0000-4877-8877-877787787703";
const PAGE_ID = "78778778-0000-4877-8877-877787787999";

const OLD_SLUG = "halaman-lama";
const NEW_SLUG = "halaman-baru";
/** The page's locale is 'id' throughout — `withPublicLocalePrefix` mirrors exactly what production builds. */
const OLD_PATH = withPublicLocalePrefix(
  `/blog/${TENANT_CODE}/pages/${OLD_SLUG}`,
  "id"
);
const NEW_PATH = withPublicLocalePrefix(
  `/blog/${TENANT_CODE}/pages/${NEW_SLUG}`,
  "id"
);

let handlerReady = false;
let sessionToken = "";

async function seed(): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, ${TENANT_CODE}, 'Slug Redirect 787', 'active')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
    VALUES (${PROFILE}, ${TENANT}, 'person', 'Author 787')
  `;

  await sql`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${IDENTITY}, ${TENANT}, ${PROFILE}, 'author-787@example.test',
            'not-a-real-hash', 'active')
  `;

  await sql`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${AUTHOR}, ${TENANT}, ${IDENTITY}, 'active')
  `;

  sessionToken = generateSessionToken();

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${IDENTITY}, ${hashSessionToken(sessionToken)},
            now() + interval '1 hour')
  `;

  // `status = 'draft'` + `author_tenant_user_id = AUTHOR` is deliberate: it
  // lets `evaluatePageUpdateAccess`'s ownership carve-out (an author may edit
  // their own unpublished page) authorize the PATCH below without seeding a
  // role/permission grant — this suite is about the redirect-capture wiring,
  // not about RBAC, and the carve-out is real production behavior either way.
  await sql`
    INSERT INTO awcms_blog_pages
      (id, tenant_id, author_tenant_user_id, title, slug, content_json,
       content_text, body_portable_text, status, visibility, locale)
    VALUES
      (${PAGE_ID}, ${TENANT}, ${AUTHOR}, 'Judul Halaman Awal', ${OLD_SLUG}, '{}'::jsonb,
       'Isi awal', '[]'::jsonb, 'draft', 'public', 'id')
  `;
}

function authHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": TENANT,
    authorization: `Bearer ${sessionToken}`
  };
}

async function patchSlug(body: Record<string, unknown>) {
  return invoke<{
    data: {
      slug: string;
      redirectCapture?: {
        outcome: string;
        code?: string;
        message?: string;
        redirectId?: string;
      };
    };
  }>(pagesPatch, {
    method: "PATCH",
    path: `/api/v1/blog/pages/${PAGE_ID}`,
    params: { id: PAGE_ID },
    headers: authHeaders(),
    body
  });
}

type RedirectRow = {
  normalized_source_path: string;
  target: string;
  state: string;
  origin: string;
};

async function redirectRowsForTenant(): Promise<RedirectRow[]> {
  return (await getHandlerAdminSql()`
    SELECT normalized_source_path, target, state, origin
    FROM awcms_seo_redirects
    WHERE tenant_id = ${TENANT}
    ORDER BY created_at ASC
  `) as RedirectRow[];
}

const describeOrSkip = integrationEnabled ? describe : describe.skip;

describeOrSkip(
  "Issue #787 — PATCH /api/v1/blog/pages/{id} slug change drives ADR-0039 redirect capture",
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

    test("default policy ('propose'): a slug change proposes an INACTIVE redirect, and the page update itself succeeds", async () => {
      if (!handlerReady) return;

      const res = await patchSlug({ slug: NEW_SLUG });

      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe(NEW_SLUG);
      expect(res.body.data.redirectCapture).toEqual({
        outcome: "proposed",
        redirectId: expect.any(String)
      });

      const rows = await redirectRowsForTenant();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        normalized_source_path: OLD_PATH,
        target: NEW_PATH,
        state: "inactive",
        origin: "slug_change"
      });
    });

    test("policy 'create': the same slug change produces an ACTIVE redirect instead", async () => {
      if (!handlerReady) return;

      await getHandlerAdminSql()`
        INSERT INTO awcms_seo_redirect_settings (tenant_id, url_change_auto_policy)
        VALUES (${TENANT}, 'create')
      `;

      const res = await patchSlug({ slug: NEW_SLUG });

      expect(res.status).toBe(200);
      expect(res.body.data.redirectCapture?.outcome).toBe("created");

      const rows = await redirectRowsForTenant();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.state).toBe("active");
    });

    test("an unrelated field-only update produces NO redirect row", async () => {
      if (!handlerReady) return;

      const res = await patchSlug({ title: "Judul Halaman Diperbarui" });

      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe(OLD_SLUG);
      // Absent, not merely falsy — the field must not appear at all when no
      // slug change was submitted (the OpenAPI contract's own distinction).
      expect(res.body.data.redirectCapture).toBeUndefined();

      const rows = await redirectRowsForTenant();
      expect(rows).toHaveLength(0);
    });

    test("resubmitting the CURRENT slug is not a change — no redirect row (and the same guard is what makes a retry of the real change idempotent)", async () => {
      if (!handlerReady) return;

      const res = await patchSlug({ slug: OLD_SLUG });

      expect(res.status).toBe(200);
      expect(res.body.data.redirectCapture).toBeUndefined();

      const rows = await redirectRowsForTenant();
      expect(rows).toHaveLength(0);
    });

    test("a safety-gate rejection (SOURCE_CONFLICT) surfaces in the response and never blocks the page update", async () => {
      if (!handlerReady) return;

      // A pre-existing LIVE rule already governs the page's current path — the
      // exact conflict `checkRedirectSafety` exists to catch before a second
      // rule for the same source is ever written. The conflicting target is
      // resolved to a plain JS string FIRST — interpolating a partial value
      // into the middle of a quoted SQL literal inside a tagged template
      // parameterizes only the substituted fragment, not the literal text
      // around it, which is not what a "whole string" parameter needs here.
      const conflictTarget = `/blog/${TENANT_CODE}/pages/somewhere-else`;
      await getHandlerAdminSql()`
        INSERT INTO awcms_seo_redirects
          (tenant_id, source_path, normalized_source_path, target_type, target,
           status_code, state, created_by, updated_by)
        VALUES (
          ${TENANT}, ${OLD_PATH}, ${OLD_PATH}, 'relative_same_tenant',
          ${conflictTarget}, 301, 'active', ${AUTHOR}, ${AUTHOR}
        )
      `;

      const res = await patchSlug({ slug: NEW_SLUG });

      // The slug edit itself is NOT blocked by the redirect conflict — this is
      // additive tooling around the edit, not a precondition for it.
      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe(NEW_SLUG);
      expect(res.body.data.redirectCapture).toEqual({
        outcome: "rejected",
        code: "SOURCE_CONFLICT",
        message: expect.any(String)
      });

      // No second row was written — only the pre-existing conflicting rule.
      const rows = await redirectRowsForTenant();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.target).toBe(conflictTarget);
    });

    test("seo_distribution disabled for the tenant: the page update still succeeds, degrading to no capture", async () => {
      if (!handlerReady) return;

      await getHandlerAdminSql()`
        INSERT INTO awcms_modules (module_key, module_name)
        VALUES ('seo_distribution', 'SEO Distribution')
        ON CONFLICT (module_key) DO NOTHING
      `;
      await getHandlerAdminSql()`
        INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
        VALUES (${TENANT}, 'seo_distribution', false)
      `;

      const res = await patchSlug({ slug: NEW_SLUG });

      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe(NEW_SLUG);
      expect(res.body.data.redirectCapture).toEqual({
        outcome: "module_disabled"
      });

      const rows = await redirectRowsForTenant();
      expect(rows).toHaveLength(0);
    });
  }
);
