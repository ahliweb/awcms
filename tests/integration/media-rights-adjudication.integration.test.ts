/**
 * Issue #794 — `PATCH /api/v1/media/objects/{id}` used to gate its WHOLE
 * rights-metadata form (`creditLine`/`sourceName`/`copyrightStatus`/
 * `rightsNotes`/`rightsVerificationStatus`) behind a single permission,
 * `media_library.media.update`. Since Issue #782/PR #791,
 * `rightsVerificationStatus === 'verified'` makes the credit fields cross into
 * the PUBLIC `GET /api/v1/media/objects` response — so whoever could type a
 * credit line could also self-attest it cleared for publication, with no
 * second reviewer.
 *
 * These tests prove the split through the REAL route handler, against a real
 * PostgreSQL: not the validator (`media-rights-policy.test.ts` already covers
 * that), and not a mocked `authorizeInTransaction` — the actual chokepoint,
 * the actual `awcms_role_permissions` grants, and the actual second
 * `authorizeInTransaction` call the handler makes for a combined request.
 *
 * MUTATION PROOFS this shape would catch:
 * - Deleting the handler's second `authorizeInTransaction` call → the
 *   "update-only holder is denied a combined request" test goes RED (a
 *   caller could ride `media.update` alone into an adjudication).
 * - Making the primary guard always pick `update` regardless of body shape →
 *   the "adjudicate_rights alone is sufficient for a status-only request"
 *   test goes RED.
 * - Swapping `touchesRoutineRightsField`'s field list for a subset → a
 *   request touching the DROPPED field would authorize on the wrong
 *   permission, caught by the "routine-only still needs only update" and
 *   "status-only still needs only adjudicate_rights" tests together.
 *
 * WORLD-2 (harness.ts) — the real route handler reaches for
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
import { PATCH as objectsPatch } from "../../src/pages/api/v1/media/objects/[id]";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";

const TENANT = "79479479-7947-4794-8794-794794794794";
const TENANT_CODE = "media-rights-794";
const MEDIA_OBJECT_ID = "79479479-0000-4794-8794-794794794001";

/** Three personas, one permission grant shape each. */
const EDITOR = {
  profileId: "79479479-0000-4794-8794-794794794100",
  tenantUserId: "79479479-0000-4794-8794-794794794101",
  identityId: "79479479-0000-4794-8794-794794794102",
  roleId: "79479479-0000-4794-8794-794794794103",
  loginIdentifier: "editor-794@example.test"
};
const REVIEWER = {
  profileId: "79479479-0000-4794-8794-794794794200",
  tenantUserId: "79479479-0000-4794-8794-794794794201",
  identityId: "79479479-0000-4794-8794-794794794202",
  roleId: "79479479-0000-4794-8794-794794794203",
  loginIdentifier: "reviewer-794@example.test"
};
const LEAD = {
  profileId: "79479479-0000-4794-8794-794794794300",
  tenantUserId: "79479479-0000-4794-8794-794794794301",
  identityId: "79479479-0000-4794-8794-794794794302",
  roleId: "79479479-0000-4794-8794-794794794303",
  loginIdentifier: "lead-794@example.test"
};

let handlerReady = false;
const sessionTokens = new Map<string, string>();

async function seedPersona(
  persona: {
    profileId: string;
    tenantUserId: string;
    identityId: string;
    roleId: string;
    loginIdentifier: string;
  },
  roleName: string,
  actions: readonly string[]
): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
    VALUES (${persona.profileId}, ${TENANT}, 'person', ${roleName})
  `;
  await sql`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${persona.identityId}, ${TENANT}, ${persona.profileId},
            ${persona.loginIdentifier}, 'not-a-real-hash', 'active')
  `;
  await sql`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${persona.tenantUserId}, ${TENANT}, ${persona.identityId}, 'active')
  `;
  await sql`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
    VALUES (${persona.roleId}, ${TENANT}, ${roleName}, ${roleName}, false)
  `;

  for (const action of actions) {
    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT ${TENANT}, ${persona.roleId}, p.id
      FROM awcms_permissions p
      WHERE p.module_key = 'media_library'
        AND p.activity_code = 'media'
        AND p.action = ${action}
    `;
  }

  // ADR-0078 — a role grant lands in `awcms_access_policies` via the one
  // writer, `grantRolePolicy`; the retired `awcms_access_assignments` table
  // (`sql/103`) is read-only history that `activeRoleGrants` no longer
  // consults, so inserting into it directly would seed a grant nothing reads.
  await grantRolePolicy(sql, TENANT, {
    tenantUserId: persona.tenantUserId,
    roleId: persona.roleId,
    grantedByTenantUserId: null
  });

  const token = generateSessionToken();
  sessionTokens.set(persona.tenantUserId, token);

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${persona.identityId}, ${hashSessionToken(token)},
            now() + interval '1 hour')
  `;
}

async function seed(): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, ${TENANT_CODE}, 'Media Rights 794', 'active')
  `;

  // `media.update` ONLY — the routine content-editor persona #794 is about.
  await seedPersona(EDITOR, "editor-794", ["update"]);
  // `media.adjudicate_rights` ONLY — the designated reviewer persona.
  await seedPersona(REVIEWER, "reviewer-794", ["adjudicate_rights"]);
  // Both — the lead who may do either.
  await seedPersona(LEAD, "lead-794", ["update", "adjudicate_rights"]);

  const objectKey = `news-media/${TENANT}/2026/09/${MEDIA_OBJECT_ID}.jpg`;
  await sql`
    INSERT INTO awcms_news_media_objects
      (id, tenant_id, bucket_name, object_key, public_url, mime_type, status,
       created_by_tenant_user_id)
    VALUES (
      ${MEDIA_OBJECT_ID}, ${TENANT}, 'test-bucket', ${objectKey},
      ${`https://media.example.test/${objectKey}`}, 'image/jpeg', 'verified',
      ${EDITOR.tenantUserId}
    )
  `;
}

function authHeaders(
  tenantUserId: string,
  idempotencyKey: string
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": TENANT,
    authorization: `Bearer ${sessionTokens.get(tenantUserId)}`,
    "idempotency-key": idempotencyKey
  };
}

async function patchRights(
  tenantUserId: string,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  return invoke<{ data?: unknown; error?: { code: string; message: string } }>(
    objectsPatch,
    {
      method: "PATCH",
      path: `/api/v1/media/objects/${MEDIA_OBJECT_ID}`,
      params: { id: MEDIA_OBJECT_ID },
      headers: authHeaders(tenantUserId, idempotencyKey),
      body
    }
  );
}

const describeOrSkip = integrationEnabled ? describe : describe.skip;

describeOrSkip(
  "Issue #794 — PATCH /api/v1/media/objects/{id} splits update from adjudicate_rights",
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
      sessionTokens.clear();
      await seed();
    });

    afterEach(async () => {
      if (handlerReady) await resetHandlerDatabase();
    });

    test("media.update alone can change routine fields — no regression for the common case", async () => {
      if (!handlerReady) return;

      const res = await patchRights(
        EDITOR.tenantUserId,
        { creditLine: "Foto: Editor" },
        "editor-routine-1"
      );

      expect(res.status).toBe(200);
    });

    test("media.update alone is DENIED when the body also includes rightsVerificationStatus", async () => {
      if (!handlerReady) return;

      const res = await patchRights(
        EDITOR.tenantUserId,
        { creditLine: "Foto: Editor", rightsVerificationStatus: "verified" },
        "editor-combined-1"
      );

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("ACCESS_DENIED");
    });

    test("media.update alone is DENIED for a rightsVerificationStatus-only request too", async () => {
      if (!handlerReady) return;

      const res = await patchRights(
        EDITOR.tenantUserId,
        { rightsVerificationStatus: "rejected" },
        "editor-status-only-1"
      );

      expect(res.status).toBe(403);
    });

    test("adjudicate_rights ALONE is sufficient for a rightsVerificationStatus-only request", async () => {
      if (!handlerReady) return;

      const res = await patchRights(
        REVIEWER.tenantUserId,
        { rightsVerificationStatus: "verified" },
        "reviewer-status-only-1"
      );

      expect(res.status).toBe(200);
    });

    test("adjudicate_rights ALONE is DENIED for a routine-field request (no media.update)", async () => {
      if (!handlerReady) return;

      const res = await patchRights(
        REVIEWER.tenantUserId,
        { creditLine: "Should not be allowed" },
        "reviewer-routine-1"
      );

      expect(res.status).toBe(403);
    });

    test("adjudicate_rights ALONE is DENIED for a combined request (no media.update)", async () => {
      if (!handlerReady) return;

      const res = await patchRights(
        REVIEWER.tenantUserId,
        {
          creditLine: "Should not be allowed either",
          rightsVerificationStatus: "verified"
        },
        "reviewer-combined-1"
      );

      expect(res.status).toBe(403);
    });

    test("holding BOTH permissions can do either — routine fields alone", async () => {
      if (!handlerReady) return;

      const res = await patchRights(
        LEAD.tenantUserId,
        { sourceName: "Wire agency" },
        "lead-routine-1"
      );

      expect(res.status).toBe(200);
    });

    test("holding BOTH permissions can do either — combined request", async () => {
      if (!handlerReady) return;

      const res = await patchRights(
        LEAD.tenantUserId,
        {
          creditLine: "Foto: Lead",
          rightsVerificationStatus: "verified"
        },
        "lead-combined-1"
      );

      expect(res.status).toBe(200);
    });

    test("a denied combined request writes NO rights change at all (both-or-nothing, not partial)", async () => {
      if (!handlerReady) return;

      await patchRights(
        EDITOR.tenantUserId,
        {
          creditLine: "Attempted credit",
          rightsVerificationStatus: "verified"
        },
        "editor-combined-partial-check"
      );

      const rows = (await getHandlerAdminSql()`
        SELECT credit_line, rights_verification_status
        FROM awcms_news_media_objects
        WHERE id = ${MEDIA_OBJECT_ID}
      `) as {
        credit_line: string | null;
        rights_verification_status: string;
      }[];

      expect(rows[0]?.credit_line).toBeNull();
      expect(rows[0]?.rights_verification_status).toBe("unverified");
    });
  }
);
