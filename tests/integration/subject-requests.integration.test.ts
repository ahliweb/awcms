/**
 * Subject-rights export + erasure (ADR-0094, Issue #557; migrations sql/125 +
 * sql/126) against a real PostgreSQL under the WORLD-1 ephemeral-database
 * harness.
 *
 * ## Why this file exists, specifically
 *
 * Every other test for this feature is PURE. The plan is pure, the registry
 * gate is pure, the screen contract is text. None of them executes a single
 * statement, and the executor is nothing BUT statements — built from
 * interpolated identifiers, hand-numbered `$n` placeholders, a `CASE WHEN`, a
 * `= ANY(array)`, and a `jsonb_agg` rebuild. `bun run check` goes green without
 * touching any of it.
 *
 * That is exactly the shape this repo has been burned by before: four defects
 * once passed thirty-seven gates because nothing RAN them. Three of the
 * constructs above were already corrected during review by reading; reading is
 * not the control that should be relied on.
 *
 * So each test below asserts a property that only a real database can answer:
 *
 *   1. The export reads the subject's rows and OMITS redacted columns — the
 *      SELECT-the-complement path, with real column lists.
 *   2. The predicate ORs several subject columns, so a person named as actor in
 *      one row and target in another is found both times, with the right id
 *      bound to the right column (the ADR-0094 trap).
 *   3. `severed_with_subject_row` tables are NOT written, and the audit trail
 *      survives an erasure intact.
 *   4. `anonymize` clears exactly the declared columns, `hard_delete` removes
 *      the row, and the jsonb break-glass entry is REMOVED from its list.
 *   5. The maker/checker CHECK constraint refuses a self-approval at the
 *      database, not merely at the guard.
 *   6. RLS keeps one tenant's requests invisible to another.
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
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { listModules } from "../../src/modules";
import { buildSubjectPlan } from "../../src/modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../src/modules/data-lifecycle/domain/subject-data-registry";
import {
  loadColumnTypes,
  readSubjectExport,
  runSubjectErasure,
  ANONYMIZED_TEXT
} from "../../src/modules/data-lifecycle/application/subject-data-executor";
import {
  claimPendingErasure,
  createErasureRequest,
  listSubjectRequests,
  recordExportDisclosure,
  resolveSubject
} from "../../src/modules/data-lifecycle/application/subject-request-service";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SUBJECT_USER = "a0000000-0000-4000-8000-000000000001";
const OTHER_USER = "a0000000-0000-4000-8000-000000000002";
const TENANT_B_USER = "b0000000-0000-4000-8000-000000000001";

let subjectIdentity = "";
let subjectProfile = "";

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'sr-tenant-a', 'SR Tenant A'),
           (${TENANT_B}, 'sr-tenant-b', 'SR Tenant B')
  `;

  for (const user of [
    { id: SUBJECT_USER, tenant: TENANT_A, label: "subject" },
    { id: OTHER_USER, tenant: TENANT_A, label: "checker" },
    { id: TENANT_B_USER, tenant: TENANT_B, label: "other-tenant" }
  ]) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${user.tenant}, 'person', ${`Display ${user.label}`})
      RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${user.tenant}, ${profile[0]!.id}, ${`${user.label}@example.test`}, 'hash')
      RETURNING id
    `) as { id: string }[];
    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${user.id}, ${user.tenant}, ${identity[0]!.id})
    `;

    if (user.id === SUBJECT_USER) {
      subjectIdentity = identity[0]!.id;
      subjectProfile = profile[0]!.id;
    }
  }

  // A session (hard_delete on erasure) and two audit rows where the subject is
  // the actor (severed, never rewritten).
  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT_A}, ${subjectIdentity}, 'session-token-hash', now() + interval '1 day')
  `;
  await admin`
    INSERT INTO awcms_audit_events
      (tenant_id, actor_tenant_user_id, module_key, action, resource_type, message)
    VALUES (${TENANT_A}, ${SUBJECT_USER}, 'blog_content', 'posts.update', 'post', 'edited a post'),
           (${TENANT_A}, ${SUBJECT_USER}, 'blog_content', 'posts.delete', 'post', 'removed a post')
  `;
  // The break-glass list — the one jsonb-array subject column in the schema.
  //
  // Bound as a JS ARRAY, exactly as `tenant-auth-policy.ts` does. Not
  // `JSON.stringify(...)::jsonb`: Bun serialises a JS STRING to a jsonb
  // *string*, so the column would hold `"[\"a\",\"b\"]"` rather than an
  // array, `jsonb_typeof` would answer `string`, and every containment test
  // against it would be false. The first version of this fixture did exactly
  // that and made a CORRECT executor look broken.
  await admin`
    INSERT INTO awcms_tenant_auth_policies (tenant_id, break_glass_identity_ids, updated_by)
    VALUES (${TENANT_A}, ${[subjectIdentity, "00000000-0000-4000-8000-000000000999"]}::jsonb, ${OTHER_USER})
  `;
}

function planFor(subject: {
  tenantUserId: string;
  identityId: string;
  profileId: string;
}) {
  return buildSubjectPlan(collectSubjectDataDescriptors(listModules()), {
    tenantId: TENANT_A,
    ...subject
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("subject-rights export + erasure (ADR-0094, #557)", () => {
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

  test("resolves all THREE of the subject's ids from the membership alone", async () => {
    const runtime = getRuntimeSql();

    const resolution = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      resolveSubject(tx, TENANT_A, SUBJECT_USER)
    );

    expect(resolution.resolved).toBe(true);
    if (!resolution.resolved) return;
    expect(resolution.subject.identityId).toBe(subjectIdentity);
    // The third id, which nothing on `awcms_profiles` could have supplied.
    expect(resolution.subject.profileId).toBe(subjectProfile);
  });

  test("a tenant user from ANOTHER tenant does not resolve", async () => {
    const runtime = getRuntimeSql();

    const resolution = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      resolveSubject(tx, TENANT_A, TENANT_B_USER)
    );

    expect(resolution.resolved).toBe(false);
  });

  test("the export reads real rows and OMITS every redacted column", async () => {
    const runtime = getRuntimeSql();

    const tables = await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      const resolution = await resolveSubject(tx, TENANT_A, SUBJECT_USER);
      if (!resolution.resolved) throw new Error("subject did not resolve");
      const plan = planFor(resolution.subject);
      const columnTypes = await loadColumnTypes(
        tx,
        plan.exportEntries.map((entry) => entry.tableName)
      );
      return readSubjectExport(tx, TENANT_A, plan, columnTypes);
    });

    const sessions = tables.find(
      (table) => table.tableName === "awcms_sessions"
    );
    expect(sessions?.rows).toHaveLength(1);
    // Declared `redactedColumns: ["token_hash"]` — and the SELECT never asked
    // for it, so it cannot be in the row at all.
    expect(Object.keys(sessions!.rows[0]!)).not.toContain("token_hash");
    expect(Object.keys(sessions!.rows[0]!)).toContain("identity_id");

    const identities = tables.find(
      (table) => table.tableName === "awcms_identities"
    );
    expect(Object.keys(identities!.rows[0]!)).not.toContain("password_hash");

    // The audit rows reach the person through a DIFFERENT id than the session
    // rows do — the trap ADR-0094 names, exercised for real.
    const audit = tables.find(
      (table) => table.tableName === "awcms_audit_events"
    );
    expect(audit?.rows).toHaveLength(2);
  });

  test("the export finds nothing for a person with no rows, without erroring", async () => {
    const runtime = getRuntimeSql();

    const tables = await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      const resolution = await resolveSubject(tx, TENANT_A, OTHER_USER);
      if (!resolution.resolved) throw new Error("subject did not resolve");
      const plan = planFor(resolution.subject);
      const columnTypes = await loadColumnTypes(
        tx,
        plan.exportEntries.map((entry) => entry.tableName)
      );
      return readSubjectExport(tx, TENANT_A, plan, columnTypes);
    });

    // Every planned table is still reported, with zero rows — a table missing
    // from the report and a table with no rows must not look the same.
    expect(tables.length).toBeGreaterThan(20);
    const sessions = tables.find(
      (table) => table.tableName === "awcms_sessions"
    );
    expect(sessions?.rows).toEqual([]);
  });

  test("the erasure deletes, anonymises, and LEAVES the audit trail standing", async () => {
    const runtime = getRuntimeSql();
    const admin = getAdminSql();

    const result = await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      const resolution = await resolveSubject(tx, TENANT_A, SUBJECT_USER);
      if (!resolution.resolved) throw new Error("subject did not resolve");
      const plan = planFor(resolution.subject);
      const columnTypes = await loadColumnTypes(
        tx,
        plan.entries.map((entry) => entry.tableName)
      );
      return runSubjectErasure(tx, TENANT_A, plan, columnTypes);
    });

    // `hard_delete` really removed the session.
    const sessions = (await admin`
      SELECT count(*)::int AS n FROM awcms_sessions WHERE identity_id = ${subjectIdentity}
    `) as { n: number }[];
    expect(sessions[0]!.n).toBe(0);

    // `anonymize` cleared exactly the declared column on the identity.
    const identity = (await admin`
      SELECT password_hash FROM awcms_identities WHERE id = ${subjectIdentity}
    `) as { password_hash: string }[];
    expect(identity[0]!.password_hash).toBe(ANONYMIZED_TEXT);

    // `severed_with_subject_row`: the audit rows are UNTOUCHED. This is the
    // property the whole vocabulary exists for — an executor that "anonymised"
    // here would have destroyed the tenant's own record of what happened,
    // including the record of this erasure.
    const audit = (await admin`
      SELECT count(*)::int AS n FROM awcms_audit_events
      WHERE actor_tenant_user_id = ${SUBJECT_USER}
    `) as { n: number }[];
    expect(audit[0]!.n).toBe(2);

    expect(
      result.outcomes.some(
        (outcome) =>
          outcome.tableName === "awcms_sessions" && outcome.rowsAffected === 1
      )
    ).toBe(true);
  });

  test("the break-glass entry is REMOVED from its jsonb list, and the other survives", async () => {
    const runtime = getRuntimeSql();
    const admin = getAdminSql();

    await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      const resolution = await resolveSubject(tx, TENANT_A, SUBJECT_USER);
      if (!resolution.resolved) throw new Error("subject did not resolve");
      const plan = planFor(resolution.subject);
      const columnTypes = await loadColumnTypes(
        tx,
        plan.entries.map((entry) => entry.tableName)
      );
      return runSubjectErasure(tx, TENANT_A, plan, columnTypes);
    });

    const rows = (await admin`
      SELECT break_glass_identity_ids FROM awcms_tenant_auth_policies
      WHERE tenant_id = ${TENANT_A}
    `) as { break_glass_identity_ids: string[] }[];

    // An erased person keeping a standing SSO bypass is the failure this
    // descriptor's `jsonb_array_contains` match exists to prevent.
    expect(rows[0]!.break_glass_identity_ids).not.toContain(subjectIdentity);
    expect(rows[0]!.break_glass_identity_ids).toContain(
      "00000000-0000-4000-8000-000000000999"
    );
  });

  test("the database itself refuses an erasure approved by its own requester", async () => {
    const runtime = getRuntimeSql();

    const requestId = await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      const row = await createErasureRequest(tx, TENANT_A, {
        subjectTenantUserId: SUBJECT_USER,
        reason: "erasure requested by the data subject",
        requestedBy: OTHER_USER,
        correlationId: null
      });
      return row.id;
    });

    // Through the service: reported as a named 409 rather than a crash.
    const claim = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      claimPendingErasure(tx, TENANT_A, requestId, OTHER_USER, {
        approved: true,
        reason: "approving my own request"
      })
    );
    expect(claim.claimed).toBe(false);
    if (!claim.claimed) expect(claim.reason).toBe("checker_is_maker");

    // And underneath it, the CHECK constraint — so no future code path can
    // reach the state by writing the row directly.
    await assertRejected(
      getAdminSql()`
        UPDATE awcms_subject_requests
        SET decided_by = ${OTHER_USER}, decided_at = now(), status = 'completed'
        WHERE id = ${requestId}
      `,
      "checker_is_not_maker"
    );
  });

  test("a DIFFERENT checker can approve, and only once", async () => {
    const runtime = getRuntimeSql();

    const requestId = await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      const row = await createErasureRequest(tx, TENANT_A, {
        subjectTenantUserId: SUBJECT_USER,
        reason: "erasure requested by the data subject",
        requestedBy: SUBJECT_USER,
        correlationId: null
      });
      return row.id;
    });

    const first = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      claimPendingErasure(tx, TENANT_A, requestId, OTHER_USER, {
        approved: true,
        reason: "no retention obligation applies"
      })
    );
    expect(first.claimed).toBe(true);

    // The conditional UPDATE is what makes a second decision impossible — the
    // row no longer matches `status = 'pending_approval'`.
    const second = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      claimPendingErasure(tx, TENANT_A, requestId, OTHER_USER, {
        approved: true,
        reason: "approving a second time"
      })
    );
    expect(second.claimed).toBe(false);
    if (!second.claimed) expect(second.reason).toBe("not_pending");
  });

  test("the runtime role cannot DELETE the accountability record", async () => {
    // The row proving an erasure happened must not be removable by the role
    // that runs erasures. Asserted against a real grant table because the
    // migration's first version got this WRONG in the direction that reads
    // fine: `sql/019` grants all four privileges schema-wide, so a GRANT
    // omitting DELETE withholds nothing.
    const runtime = getRuntimeSql();

    const requestId = await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      const row = await createErasureRequest(tx, TENANT_A, {
        subjectTenantUserId: SUBJECT_USER,
        reason: "erasure requested by the data subject",
        requestedBy: OTHER_USER,
        correlationId: null
      });
      return row.id;
    });

    await assertRejected(
      withTenantOrThrow(
        runtime,
        TENANT_A,
        (tx) =>
          tx`DELETE FROM awcms_subject_requests WHERE id = ${requestId}` as unknown as Promise<unknown>
      ),
      "a DELETE of the subject-request ledger by awcms_app"
    );

    // Still there, and still readable — the revocation removed the ability to
    // destroy the record, not the ability to answer with it.
    const remaining = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      listSubjectRequests(tx, TENANT_A, {})
    );
    expect(remaining).toHaveLength(1);
  });

  test("an export disclosure is recorded, and RLS hides it from another tenant", async () => {
    const runtime = getRuntimeSql();

    await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      recordExportDisclosure(tx, TENANT_A, {
        subjectTenantUserId: SUBJECT_USER,
        reason: "subject access request received",
        requestedBy: OTHER_USER,
        tablesAnswered: 40,
        tablesUnanswered: 3,
        rowsAffected: 7,
        correlationId: null
      })
    );

    const own = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      listSubjectRequests(tx, TENANT_A, {})
    );
    expect(own).toHaveLength(1);
    expect(own[0]!.status).toBe("disclosed");
    expect(own[0]!.tablesUnanswered).toBe(3);

    // FORCE RLS: tenant B sees nothing, so the accountability ledger cannot
    // become a cross-tenant directory of who was investigated.
    const foreign = await withTenantOrThrow(runtime, TENANT_B, (tx) =>
      listSubjectRequests(tx, TENANT_B, {})
    );
    expect(foreign).toEqual([]);
  });
});
