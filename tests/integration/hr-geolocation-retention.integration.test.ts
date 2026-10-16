/**
 * Retention, legal hold and subject data of the location-evidence verdicts
 * (Issue #970, ADR-0138 sections 7 and 6; required test 6). Run as the REAL
 * `awcms_worker` role through the generic data_lifecycle purge, and as the
 * least-privilege runtime role for the subject export, FORCE RLS on.
 *
 *   * the descriptor's 30 / 90 / 180 days: rows past the 90-day default are
 *     hard-deleted, younger rows and other tenants' rows are left alone, the
 *     attendance EVENT the verdict describes is untouched, and nothing is ever
 *     archived;
 *   * an ACTIVE legal hold blocks the purge; its release lets it through;
 *   * the four small tables that are not purged (geofences, notices,
 *     acknowledgements, settings) are counted through the sql/306 count-only
 *     function: no failed dry run, no known-unreadable entry, and the worker
 *     still cannot read their rows;
 *   * the subject export carries the employee's OWN verdicts (via the
 *     employment) and none of a colleague's, with no coordinate-like column;
 *     an erasure does not follow the join (retain_under_obligation).
 *
 * Gated on `DATABASE_URL` (harness section Gating).
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
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { listModules } from "../../src/modules";
import { eraseLocationEvidenceForEmployment } from "../../src/modules/hr-workforce/application/hr-location-evidence";
import {
  runDataLifecycleArchivePurge,
  summarizeArchivePurgeOutcome
} from "../../src/modules/data-lifecycle/application/archive-purge-job";
import {
  createLegalHold,
  fetchActiveLegalHoldsForPlanning,
  releaseLegalHold
} from "../../src/modules/data-lifecycle/application/legal-hold-service";
import {
  loadColumnTypes,
  readSubjectExport
} from "../../src/modules/data-lifecycle/application/subject-data-executor";
import { resolveSubject } from "../../src/modules/data-lifecycle/application/subject-request-service";
import {
  buildSubjectPlan,
  erasureTargets
} from "../../src/modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../src/modules/data-lifecycle/domain/subject-data-registry";
import { KNOWN_UNREADABLE_DELEGATED_TABLES } from "../../src/modules/data-lifecycle/domain/known-unreadable-delegated";
import type { ArchivePort } from "../../src/modules/data-lifecycle/domain/archive-port";

const TENANT_A = "a9700000-0000-4000-8000-00000000000a";
const TENANT_B = "a9700000-0000-4000-8000-00000000000b";
const DESCRIPTOR_KEY = "hr_workforce.attendance_location_evidence";

/** The descriptor is not archivable, so the engine must never ask to archive. */
const noArchive = {
  kind: "local_offline",
  write: async () => {
    throw new Error("location evidence must never be archived");
  }
} as unknown as ArchivePort;

type Person = { userId: string; profileId: string };

async function seedPerson(
  tenantId: string,
  tag: string,
  userId: string
): Promise<Person> {
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.test`}, 'hash')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
  `;

  return { userId, profileId: profile[0]!.id };
}

async function employ(
  tenantId: string,
  person: Person,
  employeeNo: string
): Promise<string> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const header = (await tx`
      INSERT INTO awcms_hr_employments
        (tenant_id, profile_id, tenant_user_id, employee_no, hired_on, created_by)
      VALUES (${tenantId}, ${person.profileId}, ${person.userId}, ${employeeNo},
              '2026-01-01', ${person.userId})
      RETURNING id
    `) as { id: string }[];

    return header[0]!.id;
  });
}

/**
 * One clock_in event and its verdict, `ageDays` old. Written as the superuser
 * with triggers and foreign keys off for ONE transaction (the verdict's own
 * invariants have their own tests): the row is a fixture for the purge and the
 * export, and `evaluated_at` must be the age under test.
 */
async function seedVerdict(
  tenantId: string,
  employmentId: string,
  ageDays: number,
  tag: string
): Promise<{ eventId: string; evidenceId: string }> {
  const eventId = crypto.randomUUID();
  const evidenceId = crypto.randomUUID();

  await getAdminSql().begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`
      INSERT INTO awcms_hr_attendance_events
        (id, tenant_id, employment_id, kind, occurred_at, source, client_event_key)
      VALUES (${eventId}, ${tenantId}, ${employmentId}, 'clock_in',
              now() - make_interval(days => ${ageDays}), 'self', ${`k-${tag}`})
    `;
    await tx`
      INSERT INTO awcms_hr_attendance_location_evidence
        (id, tenant_id, event_id, employment_id, verdict, distance_band,
         accuracy_band, geofence_id, rule_version, evaluated_at)
      VALUES (${evidenceId}, ${tenantId}, ${eventId}, ${employmentId}, 'outside',
              'lt_250m', 'lt_25m', ${crypto.randomUUID()}, 1,
              now() - make_interval(days => ${ageDays}))
    `;
  });

  return { eventId, evidenceId };
}

async function evidenceOf(tenantId: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT id FROM awcms_hr_attendance_location_evidence
    WHERE tenant_id = ${tenantId} ORDER BY id
  `) as { id: string }[];

  return rows.map((row) => row.id);
}

async function eventsOf(tenantId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_hr_attendance_events
    WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("location evidence: retention, legal hold, subject data (#970)", () => {
  let alice: Person;
  let bob: Person;
  let carol: Person;
  let aliceEmployment = "";
  let bobEmployment = "";
  let carolEmployment = "";

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT_A}, 'geo-ret-a', 'Geo A'), (${TENANT_B}, 'geo-ret-b', 'Geo B')
    `;
    alice = await seedPerson(
      TENANT_A,
      "alice",
      "a9700000-0000-4000-8000-000000000001"
    );
    bob = await seedPerson(
      TENANT_A,
      "bob",
      "a9700000-0000-4000-8000-000000000002"
    );
    carol = await seedPerson(
      TENANT_B,
      "carol",
      "b9700000-0000-4000-8000-000000000001"
    );
    aliceEmployment = await employ(TENANT_A, alice, "E-1");
    bobEmployment = await employ(TENANT_A, bob, "E-2");
    carolEmployment = await employ(TENANT_B, carol, "E-1");
  });

  test("the worker purges verdicts past the 90-day default, per tenant, keeps the event, and never archives", async () => {
    if (!workerRoleActivated) {
      console.warn("awcms_worker not provisioned - skipping");
      return;
    }

    const old200 = await seedVerdict(TENANT_A, aliceEmployment, 200, "o200");
    const old100 = await seedVerdict(TENANT_A, bobEmployment, 100, "o100");
    const kept80 = await seedVerdict(TENANT_A, aliceEmployment, 80, "k80");
    const kept5 = await seedVerdict(TENANT_A, bobEmployment, 5, "k5");
    const otherTenant = await seedVerdict(
      TENANT_B,
      carolEmployment,
      200,
      "b200"
    );

    expect(await evidenceOf(TENANT_A)).toHaveLength(4);

    // The worker may read and delete the verdicts, and nothing more.
    const worker = getWorkerRoleSql();
    const dryRun = await runDataLifecycleArchivePurge(
      worker,
      { dryRun: true, correlationId: "geo-retention-dry" },
      { archivePort: noArchive, tenants: [{ id: TENANT_A }] as never }
    );

    expect(dryRun.descriptorFailures).toEqual([]);
    expect(await evidenceOf(TENANT_A)).toHaveLength(4);

    const result = await runDataLifecycleArchivePurge(
      worker,
      { dryRun: false, correlationId: "geo-retention" },
      {
        archivePort: noArchive,
        tenants: [{ id: TENANT_A }, { id: TENANT_B }] as never
      }
    );

    expect(result.descriptorFailures).toEqual([]);
    expect(result.knownUnreadableDelegated).toEqual([]);
    expect(KNOWN_UNREADABLE_DELEGATED_TABLES).toEqual([]);
    expect(summarizeArchivePurgeOutcome(result).status).toBe("success");
    expect(await evidenceOf(TENANT_A)).toEqual(
      [kept80.evidenceId, kept5.evidenceId].sort()
    );
    expect(old200.evidenceId).not.toBe(kept80.evidenceId);
    expect(old100.evidenceId).not.toBe(kept5.evidenceId);
    // Tenant B's 200-day-old row was also past ITS default: each tenant on its own.
    expect(await evidenceOf(TENANT_B)).not.toContain(otherTenant.evidenceId);
    // The attendance events the verdicts described are untouched.
    expect(await eventsOf(TENANT_A)).toBe(4);
    expect(await eventsOf(TENANT_B)).toBe(1);
    // Never archived: no manifest was written.
    expect(
      (
        (await getAdminSql()`
          SELECT count(*)::int AS n FROM awcms_data_lifecycle_archive_manifests
          WHERE descriptor_key = ${DESCRIPTOR_KEY}`) as { n: number }[]
      )[0]!.n
    ).toBe(0);

    // The run is recorded for the descriptor.
    const runs = (await getAdminSql()`
      SELECT status FROM awcms_data_lifecycle_runs
      WHERE tenant_id = ${TENANT_A} AND descriptor_key = ${DESCRIPTOR_KEY}
        AND run_type <> 'dry_run'`) as { status: string }[];

    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((run) => run.status !== "failed")).toBe(true);
  });

  test("an active legal hold blocks the purge of the verdicts; releasing it lets the purge through", async () => {
    if (!workerRoleActivated) return;

    await seedVerdict(TENANT_A, aliceEmployment, 200, "held");
    await seedVerdict(TENANT_A, bobEmployment, 150, "held2");

    const runtime = getRuntimeSql();
    const created = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createLegalHold(tx, TENANT_A, alice.userId, {
        descriptorKey: DESCRIPTOR_KEY,
        scopeDescription: "Preserve attendance evidence for a dispute.",
        reason: "Dispute opened over a disputed clock-in.",
        authorityReference: "Case 2026-GEO-001",
        endsAt: null
      })
    );

    expect(created.ok).toBe(true);

    const purge = () =>
      runDataLifecycleArchivePurge(
        getWorkerRoleSql(),
        { dryRun: false, correlationId: "geo-hold" },
        { archivePort: noArchive, tenants: [{ id: TENANT_A }] as never }
      );

    await purge();
    expect(await evidenceOf(TENANT_A)).toHaveLength(2);

    await withTenantOrThrow(runtime, TENANT_A, async (tx) => {
      for (const hold of await fetchActiveLegalHoldsForPlanning(tx, TENANT_A)) {
        await releaseLegalHold(tx, TENANT_A, alice.userId, hold.id, {
          releaseReason: "Dispute settled."
        });
      }
    });

    await purge();
    expect(await evidenceOf(TENANT_A)).toHaveLength(0);
    expect(await eventsOf(TENANT_A)).toBe(2);
  });

  test("the four tables that are not purged are counted through the count-only function; their rows stay closed to the worker", async () => {
    if (!workerRoleActivated) return;

    // Old rows in every one of them (superuser, triggers off).
    const noticeId = crypto.randomUUID();
    const officeId = crypto.randomUUID();

    await getAdminSql().begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        INSERT INTO awcms_hr_geolocation_notices (id, tenant_id, version, texts, created_at)
        VALUES (${noticeId}, ${TENANT_A}, 1, '{"en":"x"}'::jsonb, now() - interval '7300 days')`;
      await tx`
        INSERT INTO awcms_hr_geofences
          (tenant_id, office_id, label, shape, center_latitude, center_longitude,
           radius_m, created_at)
        VALUES (${TENANT_A}, ${officeId}, 'HQ', 'circle', -6.17, 106.82, 100,
                now() - interval '7300 days')`;
      await tx`
        INSERT INTO awcms_hr_geolocation_settings (tenant_id, created_at)
        VALUES (${TENANT_A}, now() - interval '7300 days')`;
      await tx`
        INSERT INTO awcms_hr_geolocation_notice_acknowledgements
          (tenant_id, employment_id, notice_id, acknowledged_by, acknowledged_at)
        VALUES (${TENANT_A}, ${aliceEmployment}, ${noticeId}, ${alice.userId},
                now() - interval '7300 days')`;
    });

    const worker = getWorkerRoleSql();

    for (const table of [
      "awcms_hr_geofences",
      "awcms_hr_geolocation_notices",
      "awcms_hr_geolocation_settings",
      "awcms_hr_geolocation_notice_acknowledgements"
    ]) {
      await expect(
        (async () => {
          await worker.unsafe(`SELECT count(*) FROM ${table}`);
        })()
      ).rejects.toThrow(/permission denied/i);

      const counted = await withTenantOrThrow(worker, TENANT_A, async (tx) => {
        const rows = (await tx`
          SELECT awcms_hr_workforce_lifecycle_eligible_count(
            ${table}, ${TENANT_A}, now()) AS n`) as { n: number }[];

        return rows[0]!.n;
      });

      expect({ table, counted }).toEqual({ table, counted: 1 });
    }

    const result = await runDataLifecycleArchivePurge(
      worker,
      { dryRun: true, correlationId: "geo-counts" },
      { archivePort: noArchive, tenants: [{ id: TENANT_A }] as never }
    );

    expect(result.descriptorFailures).toEqual([]);
    expect(result.knownUnreadableDelegated).toEqual([]);

    const snapshots = (await getAdminSql()`
      SELECT descriptor_key, eligible_count FROM awcms_data_lifecycle_runs
      WHERE tenant_id = ${TENANT_A} AND status = 'completed'
        AND run_type = 'dry_run'
        AND descriptor_key IN ('hr_workforce.geofences',
          'hr_workforce.geolocation_notices', 'hr_workforce.geolocation_settings',
          'hr_workforce.geolocation_notice_acknowledgements')`) as {
      descriptor_key: string;
      eligible_count: number;
    }[];

    expect(snapshots.length).toBe(4);
    expect(snapshots.every((row) => row.eligible_count === 1)).toBe(true);
  });

  test("the subject export carries the employee's OWN verdicts and none of a colleague's; erasure does not follow the join", async () => {
    await seedVerdict(TENANT_A, aliceEmployment, 3, "a1");
    await seedVerdict(TENANT_A, aliceEmployment, 2, "a2");
    await seedVerdict(TENANT_A, bobEmployment, 1, "b1");
    await seedVerdict(TENANT_B, carolEmployment, 1, "c1");

    const descriptors = collectSubjectDataDescriptors(listModules());
    const exported = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT_A,
      async (tx) => {
        const resolution = await resolveSubject(tx, TENANT_A, alice.userId);
        if (!resolution.resolved) throw new Error("subject did not resolve");
        const plan = buildSubjectPlan(descriptors, {
          ...resolution.subject,
          tenantId: TENANT_A
        });
        const entry = plan.exportEntries.find((e) => e.key === DESCRIPTOR_KEY);

        expect(entry).toBeDefined();
        expect(entry!.via?.column).toBe("employment_id");
        expect(entry!.via?.parentMatches.map((m) => m.column)).toEqual([
          "profile_id"
        ]);
        // Erasure does NOT follow the join: the verdict ages out by retention.
        expect(
          erasureTargets(plan).some((target) => target.key === DESCRIPTOR_KEY)
        ).toBe(false);

        const columnTypes = await loadColumnTypes(
          tx,
          plan.exportEntries.map((e) => e.tableName)
        );

        return readSubjectExport(tx, TENANT_A, plan, columnTypes);
      }
    );
    const table = exported.find(
      (t) => t.tableName === "awcms_hr_attendance_location_evidence"
    );

    expect(table).toBeDefined();
    expect(table!.rows).toHaveLength(2);
    expect(
      new Set(table!.rows.map((row) => row.employment_id as string))
    ).toEqual(new Set([aliceEmployment]));
    // Every column is exported, and none of them could hold a position.
    expect(Object.keys(table!.rows[0]!).sort()).toEqual([
      "accuracy_band",
      "distance_band",
      "employment_id",
      "evaluated_at",
      "event_id",
      "geofence_id",
      "id",
      "rule_version",
      "tenant_id",
      "verdict"
    ]);
  });

  test("the worker reads only id, tenant and cursor of a verdict; the erasure function deletes one employment's verdicts and is audited", async () => {
    if (!workerRoleActivated) return;

    await seedVerdict(TENANT_A, aliceEmployment, 5, "e1");
    await seedVerdict(TENANT_A, aliceEmployment, 4, "e2");
    await seedVerdict(TENANT_A, bobEmployment, 3, "e3");

    const worker = getWorkerRoleSql();

    // L-4: a column-scoped SELECT. The verdict itself is closed to the worker.
    await expect(
      (async () => {
        await worker.unsafe(
          "SELECT verdict FROM awcms_hr_attendance_location_evidence"
        );
      })()
    ).rejects.toThrow(/permission denied/i);
    await expect(
      (async () => {
        await worker.unsafe(
          "SELECT employment_id FROM awcms_hr_attendance_location_evidence"
        );
      })()
    ).rejects.toThrow(/permission denied/i);
    const readable = await withTenantOrThrow(worker, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT id, tenant_id, evaluated_at
        FROM awcms_hr_attendance_location_evidence`) as unknown[];

      return rows.length;
    });

    expect(readable).toBe(3);

    // Immediate erasure of ONE employment, in ONE tenant, audited at critical.
    const erased = await withTenantOrThrow(worker, TENANT_A, (tx) =>
      eraseLocationEvidenceForEmployment(
        tx,
        TENANT_A,
        { actorTenantUserId: null, correlationId: "geo-erase" },
        aliceEmployment
      )
    );

    expect(erased).toBe(2);
    expect((await evidenceOf(TENANT_A)).length).toBe(1);
    expect(
      (
        (await getAdminSql()`
          SELECT severity, attributes FROM awcms_audit_events
          WHERE tenant_id = ${TENANT_A}
            AND action = 'hr_workforce.location_evidence.erased'`) as {
          severity: string;
          attributes: { erased: number };
        }[]
      ).map((row) => [row.severity, row.attributes.erased])
    ).toEqual([["critical", 2]]);
    // The events are untouched, and the request role cannot call it.
    expect(await eventsOf(TENANT_A)).toBe(3);
    await expect(
      withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
        await tx`SELECT awcms_hr_erase_location_evidence(${TENANT_A}, ${bobEmployment})`;
      })
    ).rejects.toThrow(/permission denied/i);
  });
});
