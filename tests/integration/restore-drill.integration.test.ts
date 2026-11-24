/**
 * The restore drill against a real PostgreSQL (Issue #968; docs/awcms/restore-drill.md).
 *
 * One full cycle -- synthetic seed, snapshot, writes AFTER the snapshot,
 * `pg_dump`, role provisioning, `pg_restore` into a SECOND database, verify --
 * and then the part that matters: the restored database is TAMPERED with, one
 * property at a time, and the matching check must go red. A check that stays
 * green when its property is broken (lost FORCE, a widened grant, a changed
 * cell, a missing allocation, a leaked post-snapshot write) is not a check.
 *
 * Every tamper is reverted and the verification is run again, so a failure is
 * attributable to the tamper and not to a restore that was already wrong.
 *
 * Needs `pg_dump`/`pg_restore` (>= the server major) on PATH; the CI image has
 * them. Gated on `DATABASE_URL` (harness section Gating).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  adminUrlForDatabase,
  appRoleUrlForDatabase,
  getAdminSql,
  getAppRoleSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  EPHEMERAL_DATABASE_NAME
} from "./harness";
import {
  parseConnection,
  quoteIdent,
  REQUIRED_CHECK_IDS,
  type DrillCheck,
  type Sql
} from "../../scripts/lib/restore-drill";
import {
  runCycle,
  type CycleResult
} from "../../scripts/lib/restore-drill-run";
import { seedDrillData } from "../../scripts/lib/restore-drill-seed";
import {
  verifyRestore,
  type RestoreWitness
} from "../../scripts/lib/restore-drill-verify";

const suite = integrationEnabled ? describe : describe.skip;
const TARGET_DATABASE = `awcms_drill_dst_it_${process.pid}`;

let cycle: CycleResult;
let rootSql: Sql;
let workDir: string;
const opened: Sql[] = [];

function failing(checks: DrillCheck[]): string[] {
  return checks.filter((check) => !check.ok).map((check) => check.id);
}

async function asReplica<T>(
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  // A superuser maintenance session, as the HR suites use it: the tamper must
  // reach rows the append-only triggers would refuse.
  return cycle.targetAdmin.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");

    return fn(tx);
  }) as Promise<T>;
}

type Tamper = {
  name: string;
  /** Check ids that MUST be red while the tamper is applied. */
  expectRed: string[];
  apply: () => Promise<void>;
  revert: () => Promise<void>;
};

async function relacl(table: string): Promise<string | null> {
  const rows = (await cycle.targetAdmin.unsafe(
    `SELECT relacl::text AS acl FROM pg_class WHERE oid = 'public.${table}'::regclass`
  )) as { acl: string | null }[];

  return rows[0]!.acl;
}

function setRelacl(table: string, acl: string | null): Promise<unknown> {
  return cycle.targetAdmin.unsafe(
    `UPDATE pg_class SET relacl = ${acl === null ? "NULL" : `'${acl.replaceAll("'", "''")}'::aclitem[]`}
     WHERE oid = 'public.${table}'::regclass`
  );
}

suite("restore drill: a dump restores, and every check can fail", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    workDir = await mkdtemp(path.join(tmpdir(), "awcms-drill-it-"));
    rootSql = new Bun.SQL(adminUrlForDatabase("postgres"), { max: 1 });
    opened.push(rootSql);

    await rootSql.unsafe(
      `DROP DATABASE IF EXISTS ${quoteIdent(TARGET_DATABASE)} WITH (FORCE)`
    );
    await rootSql.unsafe(`CREATE DATABASE ${quoteIdent(TARGET_DATABASE)}`);

    const admin = getAdminSql();
    const app = getAppRoleSql();
    const seeded = await seedDrillData(admin, app, {
      reservationsPerTenant: 8,
      employeesPerTenant: 2,
      attendanceDays: 2
    });
    const open = (url: string, max = 1) => {
      const sql = new Bun.SQL(url, { max });

      opened.push(sql);

      return sql;
    };

    cycle = await runCycle({
      source: parseConnection(adminUrlForDatabase(EPHEMERAL_DATABASE_NAME)),
      sourceRoot: rootSql,
      sourceAdmin: admin,
      sourceApp: app,
      snapshotConnection: open(adminUrlForDatabase(EPHEMERAL_DATABASE_NAME)),
      seeded,
      target: parseConnection(adminUrlForDatabase(TARGET_DATABASE)),
      targetRoot: rootSql,
      // Same cluster as the harness: the roles and their fixture passwords exist.
      activateTargetRoles: async () => undefined,
      openTargetAdmin: () => open(adminUrlForDatabase(TARGET_DATABASE)),
      openTargetApp: () => open(appRoleUrlForDatabase(TARGET_DATABASE), 2),
      dumpFile: path.join(workDir, "drill.dump")
    });
  }, 180_000);

  afterAll(async () => {
    for (const sql of opened) {
      await sql.close().catch(() => undefined);
    }

    const cleanup = new Bun.SQL(adminUrlForDatabase("postgres"), { max: 1 });

    await cleanup
      .unsafe(
        `DROP DATABASE IF EXISTS ${quoteIdent(TARGET_DATABASE)} WITH (FORCE)`
      )
      .catch(() => undefined);
    await cleanup.close().catch(() => undefined);
    await rm(workDir, { recursive: true, force: true });
    await teardownIntegrationDatabase();
  }, 60_000);

  test("the untouched restore passes every required check, as awcms_app", () => {
    const present = new Set(cycle.checks.map((check) => check.id));

    expect(REQUIRED_CHECK_IDS.filter((id) => !present.has(id))).toEqual([]);
    expect(cycle.checks.filter((check) => !check.ok)).toEqual([]);
    expect(cycle.witness.postSnapshotReservationIds.length).toBeGreaterThan(0);
    expect(cycle.dumpBytes).toBeGreaterThan(0);
  });

  test("the writes made after the snapshot are in the source but not in the restore", async () => {
    const ids = `{${cycle.witness.postSnapshotReservationIds.join(",")}}`;
    const inSource = (await getAdminSql().unsafe(
      "SELECT count(*)::int AS n FROM awcms_booking_reservations WHERE id = ANY($1::uuid[])",
      [ids]
    )) as { n: number }[];
    const inRestore = (await cycle.targetAdmin.unsafe(
      "SELECT count(*)::int AS n FROM awcms_booking_reservations WHERE id = ANY($1::uuid[])",
      [ids]
    )) as { n: number }[];

    expect(inSource[0]!.n).toBe(
      cycle.witness.postSnapshotReservationIds.length
    );
    expect(inRestore[0]!.n).toBe(0);
  });

  test("the restored runtime role is the real, unprivileged awcms_app", async () => {
    const rows = (await cycle.targetApp.unsafe(
      "SELECT current_user AS u, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged"
    )) as { u: string; privileged: boolean }[];

    expect(rows[0]).toEqual({ u: "awcms_app", privileged: false });
  });

  const tampers: (() => Promise<Tamper>)[] = [
    async () => ({
      name: "FORCE ROW LEVEL SECURITY removed from a tenant table",
      expectRed: ["rls_force_catalog", "rls_force_no_new_offenders"],
      apply: async () => {
        await cycle.targetAdmin.unsafe(
          "ALTER TABLE awcms_booking_reservations NO FORCE ROW LEVEL SECURITY"
        );
      },
      revert: async () => {
        await cycle.targetAdmin.unsafe(
          "ALTER TABLE awcms_booking_reservations FORCE ROW LEVEL SECURITY"
        );
      }
    }),
    async () => {
      const before = await relacl("awcms_hr_attendance_events");

      return {
        name: "awcms_app gains UPDATE on the append-only attendance log",
        expectRed: ["grants_relations", "append_only_grant_as_app"],
        apply: async () => {
          await cycle.targetAdmin.unsafe(
            "GRANT UPDATE ON awcms_hr_attendance_events TO awcms_app"
          );
        },
        revert: async () => {
          await setRelacl("awcms_hr_attendance_events", before);
        }
      };
    },
    async () => {
      const before = await relacl("awcms_booking_reservations");

      return {
        name: "awcms_app loses SELECT on reservations",
        expectRed: [
          "grants_relations",
          "rls_isolation_as_app",
          "booking_reconciliation_clean"
        ],
        apply: async () => {
          await cycle.targetAdmin.unsafe(
            "REVOKE SELECT ON awcms_booking_reservations FROM awcms_app"
          );
        },
        revert: async () => {
          await setRelacl("awcms_booking_reservations", before);
        }
      };
    },
    async () => ({
      name: "awcms_app becomes BYPASSRLS",
      expectRed: [
        "roles",
        "runtime_role_not_privileged",
        "rls_isolation_as_app"
      ],
      apply: async () => {
        await cycle.targetAdmin.unsafe("ALTER ROLE awcms_app BYPASSRLS");
      },
      revert: async () => {
        await cycle.targetAdmin.unsafe("ALTER ROLE awcms_app NOBYPASSRLS");
      }
    }),
    async () => {
      const policies = (await cycle.targetAdmin.unsafe(
        `SELECT p.polname AS name, pg_get_expr(p.polqual, p.polrelid) AS using_expr,
                pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
         FROM pg_policy p WHERE p.polrelid = 'public.awcms_booking_reservations'::regclass`
      )) as {
        name: string;
        using_expr: string | null;
        check_expr: string | null;
      }[];
      const policy = policies.find((row) => row.using_expr !== null)!;

      return {
        name: "a tenant policy widened to true",
        expectRed: ["policies", "rls_isolation_as_app"],
        apply: async () => {
          await cycle.targetAdmin.unsafe(
            `ALTER POLICY ${quoteIdent(policy.name)} ON awcms_booking_reservations USING (true)${policy.check_expr === null ? "" : " WITH CHECK (true)"}`
          );
        },
        revert: async () => {
          await cycle.targetAdmin.unsafe(
            `ALTER POLICY ${quoteIdent(policy.name)} ON awcms_booking_reservations USING (${policy.using_expr})${policy.check_expr === null ? "" : ` WITH CHECK (${policy.check_expr})`}`
          );
        }
      };
    },
    async () => {
      const [name, value] = Object.entries(cycle.witness.sequences).find(
        ([, v]) => v !== null && BigInt(v) > 1n
      )!;

      return {
        name: "a sequence rewound behind the witness",
        expectRed: ["sequences_not_behind"],
        apply: async () => {
          await cycle.targetAdmin.unsafe(`SELECT setval('public.${name}', 1)`);
        },
        revert: async () => {
          await cycle.targetAdmin.unsafe(
            `SELECT setval('public.${name}', ${value})`
          );
        }
      };
    },
    async () => ({
      name: "one cell changed (same row count)",
      expectRed: ["row_checksums"],
      apply: async () => {
        await cycle.targetAdmin.unsafe(
          "UPDATE awcms_tenants SET tenant_name = tenant_name || 'x' WHERE tenant_code = 'drill-a'"
        );
      },
      revert: async () => {
        await cycle.targetAdmin.unsafe(
          "UPDATE awcms_tenants SET tenant_name = left(tenant_name, -1) WHERE tenant_code = 'drill-a'"
        );
      }
    }),
    async () => ({
      name: "an attendance event is missing",
      expectRed: ["row_counts", "row_checksums", "rls_isolation_as_app"],
      apply: async () => {
        await asReplica(async (tx) => {
          await tx.unsafe(
            "CREATE TABLE drill_tamper_copy AS SELECT * FROM awcms_hr_attendance_events WHERE id = (SELECT id FROM awcms_hr_attendance_events ORDER BY id LIMIT 1)"
          );
          await tx.unsafe(
            "DELETE FROM awcms_hr_attendance_events WHERE id = (SELECT id FROM drill_tamper_copy)"
          );
        });
      },
      revert: async () => {
        await asReplica(async (tx) => {
          await tx.unsafe(
            "INSERT INTO awcms_hr_attendance_events SELECT * FROM drill_tamper_copy"
          );
          await tx.unsafe("DROP TABLE drill_tamper_copy");
        });
      }
    }),
    async () => ({
      name: "a live allocation is missing (reservation without its units)",
      expectRed: ["booking_reconciliation_clean", "row_counts"],
      apply: async () => {
        await asReplica(async (tx) => {
          await tx.unsafe(
            `CREATE TABLE drill_tamper_copy AS SELECT * FROM awcms_booking_resource_allocations
             WHERE released_at IS NULL AND id = (SELECT id FROM awcms_booking_resource_allocations WHERE released_at IS NULL ORDER BY id LIMIT 1)`
          );
          await tx.unsafe(
            "DELETE FROM awcms_booking_resource_allocations WHERE id = (SELECT id FROM drill_tamper_copy)"
          );
        });
      },
      revert: async () => {
        await asReplica(async (tx) => {
          await tx.unsafe(
            "INSERT INTO awcms_booking_resource_allocations SELECT * FROM drill_tamper_copy"
          );
          await tx.unsafe("DROP TABLE drill_tamper_copy");
        });
      }
    }),
    async () => {
      const fn = (await cycle.targetAdmin.unsafe(
        `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef
           AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
         ORDER BY p.oid LIMIT 1`
      )) as { sig: string }[];

      return {
        name: "a SECURITY DEFINER function turned SECURITY INVOKER",
        expectRed: ["functions_and_grants"],
        apply: async () => {
          await cycle.targetAdmin.unsafe(
            `ALTER FUNCTION ${fn[0]!.sig} SECURITY INVOKER`
          );
        },
        revert: async () => {
          await cycle.targetAdmin.unsafe(
            `ALTER FUNCTION ${fn[0]!.sig} SECURITY DEFINER`
          );
        }
      };
    },
    async () => {
      const trg = (await cycle.targetAdmin.unsafe(
        `SELECT t.tgrelid::regclass::text AS tbl, t.tgname AS name
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE NOT t.tgisinternal AND c.relname = 'awcms_hr_attendance_events' LIMIT 1`
      )) as { tbl: string; name: string }[];

      return {
        name: "an attendance trigger disabled",
        expectRed: ["triggers"],
        apply: async () => {
          await cycle.targetAdmin.unsafe(
            `ALTER TABLE ${trg[0]!.tbl} DISABLE TRIGGER ${quoteIdent(trg[0]!.name)}`
          );
        },
        revert: async () => {
          await cycle.targetAdmin.unsafe(
            `ALTER TABLE ${trg[0]!.tbl} ENABLE TRIGGER ${quoteIdent(trg[0]!.name)}`
          );
        }
      };
    },
    async () => ({
      name: "a column grant added for the worker role",
      expectRed: ["grants_columns"],
      apply: async () => {
        await cycle.targetAdmin.unsafe(
          "GRANT UPDATE (source) ON awcms_hr_attendance_events TO awcms_worker"
        );
      },
      revert: async () => {
        await cycle.targetAdmin.unsafe(
          "REVOKE UPDATE (source) ON awcms_hr_attendance_events FROM awcms_worker"
        );
        await cycle.targetAdmin.unsafe(
          `UPDATE pg_attribute SET attacl = NULL
           WHERE attrelid = 'public.awcms_hr_attendance_events'::regclass AND attname = 'source'`
        );
      }
    })
  ];

  for (const build of tampers) {
    test("tamper, then the matching check goes red and recovers", async () => {
      const tamper = await build();

      await tamper.apply();

      let red: string[];

      try {
        red = failing(
          await verifyRestore(cycle.targetAdmin, cycle.targetApp, cycle.witness)
        );
      } finally {
        await tamper.revert();
      }

      for (const id of tamper.expectRed) {
        expect(red, `${tamper.name}: ${id} stayed green`).toContain(id);
      }

      // Reverted: the restore is whole again, so the red above was the tamper's doing.
      expect(
        failing(
          await verifyRestore(cycle.targetAdmin, cycle.targetApp, cycle.witness)
        ),
        `${tamper.name}: not green after revert`
      ).toEqual([]);
    }, 90_000);
  }

  test("a leaked post-snapshot write, or a drill that wrote none, fails booking_point_in_time", async () => {
    const existing = (await cycle.targetAdmin.unsafe(
      "SELECT id FROM awcms_booking_reservations ORDER BY id LIMIT 1"
    )) as { id: string }[];
    const leaking: RestoreWitness = {
      ...cycle.witness,
      postSnapshotReservationIds: [existing[0]!.id]
    };
    const vacuous: RestoreWitness = {
      ...cycle.witness,
      postSnapshotReservationIds: []
    };

    expect(
      failing(await verifyRestore(cycle.targetAdmin, cycle.targetApp, leaking))
    ).toContain("booking_point_in_time");
    expect(
      failing(await verifyRestore(cycle.targetAdmin, cycle.targetApp, vacuous))
    ).toContain("booking_point_in_time");
  }, 60_000);
});
