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
 *   7. (ADR-0108) The erasure really erases: the person's NAME, their LOGIN
 *      ADDRESS and the address+name on the invitations they sent are gone
 *      afterwards, a subject holding TWO rows under a unique index does not
 *      abort the run on a 23505, and `skippedColumns` comes back EMPTY. Every
 *      one of those was false until ADR-0108 — the executor overwrote the
 *      export-exclusion list, which for the tables that hold a person's name
 *      was correctly empty, so an erasure reported success and wrote nothing.
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
  loadUniqueColumns,
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
  // TWO invitations sent by the subject, both still pending. The
  // `(tenant_id, login_identifier) WHERE status = 'pending'` unique index and
  // the global `token_hash` unique index are what made the old erasure abort on
  // its second row with a 23505 — after the request had been claimed.
  await admin`
    INSERT INTO awcms_invitations
      (tenant_id, login_identifier, display_name, token_hash, status,
       invited_by_tenant_user_id, expires_at)
    VALUES
      (${TENANT_A}, 'invitee-one@example.test', 'Invitee One', 'invite-hash-1',
       'pending', ${SUBJECT_USER}, now() + interval '7 days'),
      (${TENANT_A}, 'invitee-two@example.test', 'Invitee Two', 'invite-hash-2',
       'pending', ${SUBJECT_USER}, now() + interval '7 days')
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
      const tables = plan.entries.map((entry) => entry.tableName);
      const columnTypes = await loadColumnTypes(tx, tables);
      const uniqueColumns = await loadUniqueColumns(tx, tables);
      return runSubjectErasure(tx, TENANT_A, plan, columnTypes, uniqueColumns);
    });

    // `hard_delete` really removed the session.
    const sessions = (await admin`
      SELECT count(*)::int AS n FROM awcms_sessions WHERE identity_id = ${subjectIdentity}
    `) as { n: number }[];
    expect(sessions[0]!.n).toBe(0);

    // `anonymize` cleared exactly the declared column on the identity.
    const identity = (await admin`
      SELECT password_hash, login_identifier
      FROM awcms_identities WHERE id = ${subjectIdentity}
    `) as { password_hash: string; login_identifier: string }[];
    expect(identity[0]!.password_hash).toBe(ANONYMIZED_TEXT);

    // ...and the LOGIN ADDRESS, which is the person, is gone too. It is under a
    // unique index, so it cannot hold the shared sentinel — it holds a
    // per-row-unique one, and what matters here is only that the address the
    // person signed in with is no longer readable.
    expect(identity[0]!.login_identifier).not.toBe("subject@example.test");
    expect(identity[0]!.login_identifier.startsWith(ANONYMIZED_TEXT)).toBe(
      true
    );

    // The person's NAME. `awcms_profiles` is the table whose own descriptor
    // says `display_name`/`legal_name` are copies of personal detail that
    // anonymising the identity "leaves standing" — so this is the assertion
    // that the erasure did the thing its rationale describes, rather than
    // reporting `anonymize` and writing nothing.
    const profile = (await admin`
      SELECT display_name, legal_name FROM awcms_profiles WHERE id = ${subjectProfile}
    `) as { display_name: string; legal_name: string | null }[];
    expect(profile[0]!.display_name).toBe(ANONYMIZED_TEXT);

    // TWO rows in one table, both under unique indexes on the columns being
    // anonymised. Before ADR-0108 this aborted the whole erasure with a 23505
    // on the second row — the failure the per-row sentinel exists for — and
    // before that it never got as far as colliding, because only `token_hash`
    // was written and the invitee's address and name stayed put.
    const invitations = (await admin`
      SELECT login_identifier, display_name, token_hash
      FROM awcms_invitations
      WHERE tenant_id = ${TENANT_A}
      ORDER BY login_identifier
    `) as {
      login_identifier: string;
      display_name: string;
      token_hash: string;
    }[];

    expect(invitations).toHaveLength(2);
    for (const row of invitations) {
      expect(row.login_identifier.startsWith(ANONYMIZED_TEXT)).toBe(true);
      expect(row.display_name).toBe(ANONYMIZED_TEXT);
      expect(row.token_hash.startsWith(ANONYMIZED_TEXT)).toBe(true);
    }
    // Per-ROW unique, not merely prefixed — the point of the suffix.
    expect(invitations[0]!.login_identifier).not.toBe(
      invitations[1]!.login_identifier
    );

    // Nothing was reported as skipped. A skipped column is a column a
    // descriptor's author singled out as the personal one and the engine then
    // left in place; the list has always been returned and never asserted on,
    // which is how `awcms_visitor_sessions.ip_address` (an `inet`) and
    // `awcms_visit_events.geo` (a `jsonb`) stayed put through every erasure.
    expect(result.skippedColumns).toEqual([]);

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
      const tables = plan.entries.map((entry) => entry.tableName);
      const columnTypes = await loadColumnTypes(tx, tables);
      const uniqueColumns = await loadUniqueColumns(tx, tables);
      return runSubjectErasure(tx, TENANT_A, plan, columnTypes, uniqueColumns);
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
